import { PrismaClient } from "@prisma/client";
import { runDailyIngestion } from "../apps/worker/src/jobs/ingestMarketData";
import { runScoringAndRecommendations } from "../apps/worker/src/jobs/scoreAndRecommend";

const prisma = new PrismaClient();

async function run() {
  console.log("Starting real-data ingestion and quant-engine scoring pipeline...");

  try {
    // 1. Ingest market data for seeded stocks
    const ingestResult = await runDailyIngestion();
    console.log("Ingestion Complete:", ingestResult);

    // 2. Setup an active Model Portfolio if one doesn't exist
    let modelPort = await prisma.modelPortfolio.findFirst({
      where: { name: "Adaptive Alpha Core (India)" }
    });

    if (!modelPort) {
      modelPort = await prisma.modelPortfolio.create({
        data: {
          name: "Adaptive Alpha Core (India)",
          description: "Regime-adaptive multi-factor model portfolio",
          status: "ACTIVE"
        }
      });
      console.log("Created active Model Portfolio in database:", modelPort.name);
    } else if (modelPort.status !== "ACTIVE") {
      await prisma.modelPortfolio.update({
        where: { id: modelPort.id },
        data: { status: "ACTIVE" }
      });
      console.log("Ensured Model Portfolio status is ACTIVE");
    }

    // 3. Setup a Demo Client and Portfolio linked to the Model Portfolio
    let client = await prisma.client.findFirst({
      where: { displayName: "Sandeep Rao (HNI Account)" }
    });

    if (!client) {
      client = await prisma.client.create({
        data: {
          displayName: "Sandeep Rao (HNI Account)",
          email: "sandeep@outlook.com",
          phone: "+919830094801",
          kycStatus: "VERIFIED"
        }
      });
      console.log("Created test advisor Client:", client.displayName);
    }

    let portfolio = await prisma.portfolio.findFirst({
      where: { clientId: client.id }
    });

    if (!portfolio) {
      portfolio = await prisma.portfolio.create({
        data: {
          clientId: client.id,
          name: "Equity Dynamic Alpha Focus",
          modelPortfolioId: modelPort.id,
          baseCurrency: "INR"
        }
      });
      console.log("Created test Client Portfolio linked to Model Portfolio:", portfolio.name);
      
      // Let's add some initial holdings to create weight drifts!
      const stocks = await prisma.stock.findMany({ take: 5 });
      for (const stock of stocks) {
        await prisma.holding.create({
          data: {
            portfolioId: portfolio.id,
            stockId: stock.id,
            quantity: 100,
            avgBuyPrice: 1000
          }
        });
      }
      console.log("Added initial holdings to create rebalance drift.");
    }

    // 4. Run factor scoring & rebalancing recommendations
    console.log("Running quant engine factor scoring and rebalance suggestions...");
    const scoringResult = await runScoringAndRecommendations();
    console.log("Scoring Complete:", scoringResult);

    console.log("Pipeline executed successfully! Database populated with real computed data.");
  } catch (err) {
    console.error("Pipeline run failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
