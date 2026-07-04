import { PrismaClient } from "@prisma/client";
import { getMarketDataProvider } from "../apps/worker/src/providers/index";

const prisma = new PrismaClient();

async function run() {
  console.log("Starting historical price and fundamental seeding (400 days lookback)...");

  try {
    const provider = getMarketDataProvider();
    const stocks = await prisma.stock.findMany({ where: { isActive: true } });
    console.log(`Found ${stocks.length} active stocks. Ingesting historical pricing...`);

    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - 400); // 400 days lookback

    const fromStr = startDate.toISOString().slice(0, 10);
    const toStr = today.toISOString().slice(0, 10);

    let count = 0;
    for (const stock of stocks) {
      console.log(`Ingesting ${stock.symbol} (${count + 1}/${stocks.length})...`);
      
      // 1. Get daily bars
      const bars = await provider.getDailyBars(stock.symbol, fromStr, toStr);
      console.log(`  Received ${bars.length} daily price bars.`);

      // 2. Insert bars in bulk/transactions
      const priceCreations = bars.map(bar => ({
        stockId: stock.id,
        date: new Date(bar.date),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: BigInt(bar.volume)
      }));

      // Delete existing to avoid conflicts during seed
      await prisma.stockPrice.deleteMany({
        where: { stockId: stock.id }
      });

      await prisma.stockPrice.createMany({
        data: priceCreations
      });

      // 3. Ingest fundamentals
      const fundamentals = await provider.getFundamentals(stock.symbol);
      if (fundamentals) {
        await prisma.stockFundamental.upsert({
          where: {
            stockId_reportDate: { stockId: stock.id, reportDate: new Date(fundamentals.reportDate) },
          },
          create: {
            stockId: stock.id,
            reportDate: new Date(fundamentals.reportDate),
            peRatio: fundamentals.peRatio,
            pbRatio: fundamentals.pbRatio,
            roe: fundamentals.roe,
            debtToEquity: fundamentals.debtToEquity,
            epsGrowthYoy: fundamentals.epsGrowthYoy,
            revenueGrowthYoy: fundamentals.revenueGrowthYoy,
            dividendYield: fundamentals.dividendYield,
            marketCap: fundamentals.marketCap,
          },
          update: {
            peRatio: fundamentals.peRatio,
            pbRatio: fundamentals.pbRatio,
            roe: fundamentals.roe,
            debtToEquity: fundamentals.debtToEquity,
            epsGrowthYoy: fundamentals.epsGrowthYoy,
            revenueGrowthYoy: fundamentals.revenueGrowthYoy,
            dividendYield: fundamentals.dividendYield,
            marketCap: fundamentals.marketCap,
          },
        });
      }

      count++;
    }

    console.log("Historical seeding completed successfully!");
  } catch (err) {
    console.error("Historical seeding failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
