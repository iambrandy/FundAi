/**
 * Worker Scheduler
 * =================
 * Registers the daily pipeline as a repeatable BullMQ job:
 *   ingestMarketData -> scoreAndRecommend
 * Scheduled for after NSE close (15:30 IST) on weekdays. Uses BullMQ's
 * repeat.pattern (cron) rather than a naive setInterval so schedules
 * survive worker restarts and don't drift.
 */

import { Queue, Worker, Job } from "bullmq";
import { runDailyIngestion } from "./jobs/ingestMarketData";
import { runScoringAndRecommendations } from "./jobs/scoreAndRecommend";

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export const pipelineQueue = new Queue("daily-pipeline", { connection });

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
  { connection, concurrency: 1 } // sequential by design — scoring must never run against a partial ingestion
);

pipelineWorker.on("completed", (job) => {
  console.log(`[worker] Pipeline job ${job.id} completed:`, job.returnvalue);
});

pipelineWorker.on("failed", (job, err) => {
  console.error(`[worker] Pipeline job ${job?.id} failed:`, err);
  // TODO: wire to alerting (e.g. Slack webhook) — a failed nightly pipeline
  // means stale recommendations go out to real advisors/clients next morning.
});
