/**
 * Daily Market Data Ingestion Job
 * ================================
 * Runs once per trading day (scheduled via BullMQ repeatable job, see
 * scheduler.ts) after market close. For every active Stock in the universe:
 *   1. Pull the latest daily OHLCV bar and upsert into StockPrice.
 *   2. Pull the latest fundamental snapshot and upsert into StockFundamental
 *      (only if the report date is new — fundamentals update quarterly, not daily).
 *
 * Failure handling: one stock failing must never abort the whole run. Each
 * symbol is isolated in its own try/catch, failures are logged and counted,
 * and the job reports a summary rather than throwing on partial failure —
 * a full-universe outage from one bad ticker is exactly the kind of bug
 * that erodes trust in a financial platform.
 */

import { PrismaClient } from "@prisma/client";
import { getMarketDataProvider } from "../providers";

const prisma = new PrismaClient();

export async function runDailyIngestion(): Promise<{
  processed: number;
  failed: number;
  errors: { symbol: string; message: string }[];
}> {
  const provider = getMarketDataProvider();

  const healthy = await provider.healthCheck();
  if (!healthy) {
    throw new Error(`Market data provider "${provider.name}" failed health check — aborting run.`);
  }

  const stocks = await prisma.stock.findMany({ where: { isActive: true } });
  console.log(`[ingestion] Starting run for ${stocks.length} stocks via provider "${provider.name}"`);

  let processed = 0;
  const errors: { symbol: string; message: string }[] = [];

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // small lookback window covers weekends/holidays

  for (const stock of stocks) {
    try {
      const bars = await provider.getDailyBars(stock.symbol, yesterday, today);
      const latestBar = bars[bars.length - 1];

      if (latestBar) {
        await prisma.stockPrice.upsert({
          where: { stockId_date: { stockId: stock.id, date: new Date(latestBar.date) } },
          create: {
            stockId: stock.id,
            date: new Date(latestBar.date),
            open: latestBar.open,
            high: latestBar.high,
            low: latestBar.low,
            close: latestBar.close,
            volume: BigInt(latestBar.volume),
          },
          update: {
            open: latestBar.open,
            high: latestBar.high,
            low: latestBar.low,
            close: latestBar.close,
            volume: BigInt(latestBar.volume),
          },
        });
      }

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

      processed++;
    } catch (err) {
      errors.push({ symbol: stock.symbol, message: err instanceof Error ? err.message : String(err) });
      console.error(`[ingestion] Failed for ${stock.symbol}:`, err);
    }
  }

  console.log(`[ingestion] Done. Processed ${processed}/${stocks.length}, ${errors.length} failures.`);
  return { processed, failed: errors.length, errors };
}
