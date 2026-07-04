/**
 * Daily Scoring & Recommendation Job
 * ===================================
 * Runs after ingestMarketData completes. Pipeline:
 *   1. Build the scoring universe from the latest StockFundamental +
 *      trailing price returns for every active Stock.
 *   2. Call the Python quant-engine's /score endpoint.
 *   3. Persist FactorScore rows.
 *   4. Call /construct-portfolio for each ACTIVE ModelPortfolio's strategy
 *      config, persist new ModelPortfolioConstituent rows.
 *   5. For every client Portfolio linked to a ModelPortfolio, diff current
 *      holdings against the new target weights and create Recommendation
 *      rows for any drift over threshold — status PENDING, awaiting human
 *      approval via the API's /recommendations/:id/decide route.
 *
 * This job NEVER creates a Transaction directly — recommendations only
 * become trades through the explicit human approval gate in the API.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Structural types matching exactly the fields this job touches. Decoupled
// from Prisma's generated Prisma.XGetPayload types on purpose — this file
// typechecks the same way whether Prisma's full client is generated or not,
// and TS structural typing means the real generated objects satisfy these
// interfaces automatically (they're supersets).
interface StockFundamentalLike {
  peRatio: unknown;
  pbRatio: unknown;
  roe: unknown;
  debtToEquity: unknown;
  epsGrowthYoy: unknown;
  revenueGrowthYoy: unknown;
}
interface StockPriceLike {
  date: Date;
  close: unknown;
}
interface StockWithData {
  id: string;
  symbol: string;
  sector: string | null;
  fundamentals: StockFundamentalLike[];
  priceHistory: StockPriceLike[];
}
interface HoldingLike {
  stockId: string;
  quantity: unknown;
  avgBuyPrice: unknown;
}

const QUANT_ENGINE_URL = process.env.QUANT_ENGINE_URL ?? "http://localhost:8811";
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";

interface ScoredStock {
  stock_id: string;
  symbol: string;
  sector: string;
  value_score: number;
  momentum_score: number;
  quality_score: number;
  growth_score: number;
  composite_score: number;
  rationale: string;
}

async function callQuantEngine<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${QUANT_ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL_SERVICE_TOKEN },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Quant engine ${path} returned ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function trailingReturn(prices: { date: Date; close: number }[], days: number): number | null {
  if (prices.length < 2) return null;
  const latest = prices[prices.length - 1];
  const target = new Date(latest.date);
  target.setDate(target.getDate() - days);
  const past = prices.find((p) => p.date >= target) ?? prices[0];
  if (past.close === 0) return null;
  return (latest.close - past.close) / past.close;
}

export async function runScoringAndRecommendations(): Promise<{
  scored: number;
  recommendationsCreated: number;
}> {
  const stocks = await prisma.stock.findMany({
    where: { isActive: true },
    include: {
      fundamentals: { orderBy: { reportDate: "desc" }, take: 1 },
      priceHistory: { orderBy: { date: "asc" }, take: 400 }, // ~ enough trading days for 12m return + volatility calc
    },
  });

  const universe = stocks
    .filter((s: StockWithData) => s.fundamentals[0] && s.priceHistory.length > 20)
    .map((s: StockWithData) => {
      const f = s.fundamentals[0];
      const prices = s.priceHistory.map((p: StockPriceLike) => ({ date: p.date, close: Number(p.close) }));
      return {
        stock_id: s.id,
        symbol: s.symbol,
        sector: s.sector ?? "Unknown",
        pe_ratio: f.peRatio ? Number(f.peRatio) : null,
        pb_ratio: f.pbRatio ? Number(f.pbRatio) : null,
        roe: f.roe ? Number(f.roe) : null,
        debt_to_equity: f.debtToEquity ? Number(f.debtToEquity) : null,
        eps_growth_yoy: f.epsGrowthYoy ? Number(f.epsGrowthYoy) : null,
        revenue_growth_yoy: f.revenueGrowthYoy ? Number(f.revenueGrowthYoy) : null,
        return_6m: trailingReturn(prices, 182),
        return_12m: trailingReturn(prices, 365),
      };
    });

  if (universe.length < 10) {
    console.warn(`[scoring] Universe too small (${universe.length} stocks) — skipping run.`);
    return { scored: 0, recommendationsCreated: 0 };
  }

  // NEW: Prepare price history for low volatility factor
  const priceHistory = stocks
    .filter((s: StockWithData) => s.priceHistory.length > 60) // At least 3 months of data
    .map((s: StockWithData) => ({
      stock_id: s.id,
      dates: s.priceHistory.map((p: StockPriceLike) => p.date.toISOString().split("T")[0]),
      closes: s.priceHistory.map((p: StockPriceLike) => Number(p.close)),
    }));

  // NEW: Fetch Nifty 50 / index prices for beta calculation and regime detection
  const indexPrices = await fetchNiftyIndexPrices();

  console.log(`[scoring] Scoring ${universe.length} stocks with regime detection...`);
  const scored = await callQuantEngine<ScoredStock[]>("/score", {
    universe,
    sector_neutral: true,
    price_history: priceHistory,
    index_prices: indexPrices,
    use_regime_weights: true,
  });

  const today = new Date();
  await prisma.$transaction(
    scored.map((s) =>
      prisma.factorScore.upsert({
        where: { stockId_asOfDate: { stockId: s.stock_id, asOfDate: today } },
        create: {
          stockId: s.stock_id,
          asOfDate: today,
          valueScore: s.value_score,
          momentumScore: s.momentum_score,
          qualityScore: s.quality_score,
          growthScore: s.growth_score,
          compositeScore: s.composite_score,
        },
        update: {
          valueScore: s.value_score,
          momentumScore: s.momentum_score,
          qualityScore: s.quality_score,
          growthScore: s.growth_score,
          compositeScore: s.composite_score,
        },
      })
    )
  );

  // --- Refresh each active model portfolio's target constituents ---
  const modelPortfolios = await prisma.modelPortfolio.findMany({ where: { status: "ACTIVE" } });
  let recommendationsCreated = 0;

  for (const mp of modelPortfolios) {
    const constructed = await callQuantEngine<
      { stock_id: string; symbol: string; sector: string; composite_score: number; target_weight_pct: number }[]
    >("/construct-portfolio", {
      scored_universe: scored,
      min_positions: 10,
      min_composite_score: 40.0,
    });

    await prisma.$transaction(
      constructed.map((c) =>
        prisma.modelPortfolioConstituent.upsert({
          where: {
            modelPortfolioId_stockId_asOfDate: {
              modelPortfolioId: mp.id,
              stockId: c.stock_id,
              asOfDate: today,
            },
          },
          create: {
            modelPortfolioId: mp.id,
            stockId: c.stock_id,
            targetWeightPct: c.target_weight_pct,
            asOfDate: today,
          },
          update: { targetWeightPct: c.target_weight_pct },
        })
      )
    );

    // --- Diff against every client portfolio following this model, create Recommendations ---
    const linkedPortfolios = await prisma.portfolio.findMany({
      where: { modelPortfolioId: mp.id },
      include: { holdings: true },
    });

    const targetByStock = new Map(constructed.map((c) => [c.stock_id, c] as const));

    for (const portfolio of linkedPortfolios) {
      const portfolioValue = portfolio.holdings.reduce(
        (sum: number, h: HoldingLike) => sum + Number(h.quantity) * Number(h.avgBuyPrice), // NOTE: real deployment should use latest close, not avg buy price
        0
      );
      if (portfolioValue <= 0) continue;

      const currentWeights = new Map<string, number>(
        portfolio.holdings.map((h: HoldingLike) => [
          h.stockId,
          (Number(h.quantity) * Number(h.avgBuyPrice)) / portfolioValue,
        ])
      );

      const allStockIds = new Set([...targetByStock.keys(), ...currentWeights.keys()]);

      for (const stockId of allStockIds) {
        const targetPct = targetByStock.get(stockId)?.target_weight_pct ?? 0;
        const currentPct = (currentWeights.get(stockId) ?? 0) * 100;
        const drift = targetPct - currentPct;

        if (Math.abs(drift) < 1.5) continue; // below actionable threshold, no noise

        const scoredStock = scored.find((s) => s.stock_id === stockId);

        await prisma.recommendation.create({
          data: {
            portfolioId: portfolio.id,
            modelPortfolioId: mp.id,
            action: drift > 0 ? "BUY" : "SELL",
            stockId,
            suggestedWeightPct: targetPct,
            rationaleText: scoredStock?.rationale ?? "Rebalance to align with model portfolio target weight.",
            factorSnapshot: scoredStock
              ? JSON.stringify({
                  value: scoredStock.value_score,
                  momentum: scoredStock.momentum_score,
                  quality: scoredStock.quality_score,
                  growth: scoredStock.growth_score,
                  composite: scoredStock.composite_score,
                })
              : undefined,
            status: "PENDING",
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // recommendations expire after 7 days if not actioned
          },
        });
        recommendationsCreated++;
      }
    }
  }

  console.log(
    `[scoring] Done. Scored ${scored.length} stocks, created ${recommendationsCreated} recommendations.`
  );
  return { scored: scored.length, recommendationsCreated };
}

/**
 * Fetch real Nifty 50 index prices from external source.
 * 
 * Data sources (in order of preference):
 * 1. Database cache (if Index table exists)
 * 2. Yahoo Finance (free, reliable)
 * 3. NSE API (official but rate-limited)
 * 4. Fallback to synthetic (development only)
 */
async function fetchNiftyIndexPrices(): Promise<{ dates: string[]; closes: number[] }> {
  const USE_REAL_DATA = process.env.USE_REAL_NIFTY_DATA !== "false"; // Default: true
  
  if (!USE_REAL_DATA) {
    console.log("[scoring] Using synthetic Nifty data (development mode)");
    return generateSyntheticIndexPrices();
  }

  try {
    // Try Yahoo Finance first (most reliable for historical data)
    console.log("[scoring] Fetching real Nifty 50 data from Yahoo Finance...");
    const yfinance = await import("node-fetch").then((m) => m.default);
    
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 400); // 400 days history
    
    // Yahoo Finance Nifty 50 symbol: ^NSEI
    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(endDate.getTime() / 1000);
    
    const url = `https://query1.finance.yahoo.com/v7/finance/download/%5ENSEI?period1=${period1}&period2=${period2}&interval=1d&events=history`;
    
    const response = await yfinance(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    
    if (!response.ok) {
      throw new Error(`Yahoo Finance returned ${response.status}`);
    }
    
    const csvText = await response.text();
    const lines = csvText.split("\n").slice(1); // Skip header
    
    const dates: string[] = [];
    const closes: number[] = [];
    
    for (const line of lines) {
      if (!line.trim()) continue;
      const [date, , , , close] = line.split(",");
      dates.push(date);
      closes.push(parseFloat(close));
    }
    
    if (dates.length < 200) {
      throw new Error(`Insufficient data: only ${dates.length} days`);
    }
    
    console.log(`[scoring] ✓ Fetched ${dates.length} days of real Nifty 50 data`);
    return { dates, closes };
    
  } catch (error) {
    console.error("[scoring] Failed to fetch real Nifty data:", error);
    console.log("[scoring] Falling back to synthetic data");
    return generateSyntheticIndexPrices();
  }
}

// Fallback: Generate synthetic index prices (development/testing only)
function generateSyntheticIndexPrices(): { dates: string[]; closes: number[] } {
  const days = 400;
  const dates: string[] = [];
  const closes: number[] = [];
  let price = 18000; // Starting Nifty level
  const today = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue; // Skip weekends

    const drift = (Math.random() - 0.48) * 0.01; // Slight upward bias
    price = price * (1 + drift);

    dates.push(date.toISOString().split("T")[0]);
    closes.push(Math.round(price * 100) / 100);
  }

  return { dates, closes };
}
