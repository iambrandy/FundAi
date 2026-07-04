import "dotenv/config";
import { runDailyIngestion } from "../jobs/ingestMarketData";
import { runScoringAndRecommendations } from "../jobs/scoreAndRecommend";

async function main() {
  console.log("[pipeline] Starting manual pipeline run...");
  
  console.log("[pipeline] Running daily ingestion...");
  const ingestionResult = await runDailyIngestion();
  console.log("[pipeline] Ingestion result:", ingestionResult);
  
  if (ingestionResult.processed === 0) {
    console.error("[pipeline] Ingestion processed zero stocks — aborting scoring.");
    process.exit(1);
  }
  
  console.log("[pipeline] Running scoring and recommendations...");
  const scoringResult = await runScoringAndRecommendations();
  console.log("[pipeline] Scoring result:", scoringResult);
  
  console.log("[pipeline] Manual pipeline completed successfully!");
}

main().catch((err) => {
  console.error("[pipeline] Pipeline execution failed:", err);
  process.exit(1);
});
