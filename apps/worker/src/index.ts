import { scheduleDailyPipeline } from "./scheduler";

async function main() {
  await scheduleDailyPipeline();
  console.log("[worker] Ready and listening for jobs.");
}

main().catch((err) => {
  console.error("[worker] Fatal startup error:", err);
  process.exit(1);
});
