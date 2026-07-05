/**
 * Worker Scheduler
 * =================
 * Registers two repeatable BullMQ jobs:
 *
 *   1. daily-pipeline: ingestMarketData -> scoreAndRecommend
 *      Runs Mon-Fri at 16:30 IST (after NSE close).
 *
 *   2. macro-refresh: refreshMacroEvents
 *      Runs weekly, Sunday 18:00 IST (before Monday market open).
 *      Seeds the macro event store and alerts on staleness.
 *
 * BullMQ repeat.pattern (cron) ensures schedules survive restarts
 * and don't drift compared to a naive setInterval.
 */

import { Queue, Worker, Job } from "bullmq";
import { runDailyIngestion } from "./jobs/ingestMarketData";
import { runScoringAndRecommendations } from "./jobs/scoreAndRecommend";
import { runMacroEventsRefresh } from "./jobs/refreshMacroEvents";

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

// ---------------------------------------------------------------------------
// Queue 1: Daily pipeline
// ---------------------------------------------------------------------------

export const pipelineQueue = new Queue("daily-pipeline", { connection, skipVersionCheck: true });

export async function scheduleDailyPipeline() {
  await pipelineQueue.add(
    "run-daily-pipeline",
    {},
    {
      repeat: { pattern: "30 16 * * 1-5", tz: "Asia/Kolkata" }, // 16:30 IST, weekdays — after close + settlement buffer
      jobId: "daily-pipeline-recurring",
    }
  );
  console.log("[scheduler] Daily pipeline scheduled for 16:30 IST, Mon-Fri");
}

export const pipelineWorker = new Worker(
  "daily-pipeline",
  async (job: Job) => {
    console.log(`[worker] Starting daily pipeline run (job ${job.id})`);

    const ingestionResult = await runDailyIngestion();
    await job.updateProgress(50);

    if (ingestionResult.processed === 0) {
      throw new Error("Ingestion processed zero stocks — aborting before scoring to avoid stale/empty scores.");
    }

    const scoringResult = await runScoringAndRecommendations();
    await job.updateProgress(100);

    return { ingestionResult, scoringResult };
  },
  { connection, concurrency: 1, skipVersionCheck: true } // sequential by design — scoring must never run against a partial ingestion
);

pipelineWorker.on("completed", (job) => {
  console.log(`[worker] Pipeline job ${job.id} completed:`, job.returnvalue);
});

pipelineWorker.on("failed", (job, err) => {
  console.error(`[worker] Pipeline job ${job?.id} failed:`, err);
  // TODO: wire to alerting (e.g. Slack webhook) — a failed nightly pipeline
  // means stale recommendations go out to real advisors/clients next morning.
});

// ---------------------------------------------------------------------------
// Queue 2: Weekly macro events refresh
// ---------------------------------------------------------------------------

export const macroRefreshQueue = new Queue("macro-refresh", { connection, skipVersionCheck: true });

export async function scheduleMacroRefresh() {
  await macroRefreshQueue.add(
    "run-macro-refresh",
    {},
    {
      repeat: { pattern: "0 18 * * 0", tz: "Asia/Kolkata" }, // 18:00 IST, Sunday — before Monday market open
      jobId: "macro-refresh-recurring",
    }
  );
  console.log("[scheduler] Macro events refresh scheduled for 18:00 IST, Sunday");
}

export const macroRefreshWorker = new Worker(
  "macro-refresh",
  async (job: Job) => {
    console.log(`[worker] Starting macro events refresh (job ${job.id})`);
    const result = await runMacroEventsRefresh();
    return result;
  },
  { connection, concurrency: 1, skipVersionCheck: true }
);

macroRefreshWorker.on("completed", (job) => {
  console.log(`[worker] Macro refresh job ${job.id} completed:`, job.returnvalue);
});

macroRefreshWorker.on("failed", (job, err) => {
  console.error(`[worker] Macro refresh job ${job?.id} failed:`, err);
});

