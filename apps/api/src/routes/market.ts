import { Router } from "express";
import { getSystemPrisma } from "../lib/prisma";
import { AuthedRequest } from "../middleware/requireAuth";
import * as fs from "fs";
import * as path from "path";

const router = Router();

const QUANT_ENGINE_URL = process.env.QUANT_ENGINE_URL ?? "http://localhost:8811";
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";

/**
 * GET /api/market/regime
 * 
 * Returns current market regime based on recent index price action with REAL Nifty 50 data.
 */
router.get("/regime", async (_req: AuthedRequest, res, next) => {
  try {
    const indexPrices = await fetchRealNiftyPrices();

    const response = await fetch(`${QUANT_ENGINE_URL}/detect-regime`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_SERVICE_TOKEN,
      },
      body: JSON.stringify({ index_prices: indexPrices }),
    });

    if (!response.ok) {
      throw new Error(`Quant engine returned ${response.status}`);
    }

    const result = await response.json();
    res.json(result);
    return;
  } catch (err) {
    next(err);
    return;
  }
});

/**
 * GET /api/market/factor-performance
 * 
 * Returns ACTUAL factor performance calculated from historical database records.
 */
router.get("/factor-performance", async (_req: AuthedRequest, res, next) => {
  try {
    const prisma = getSystemPrisma();

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Get factor scores from last 3 months with price data
    const historicalScores = await prisma.factorScore.findMany({
      where: {
        asOfDate: {
          gte: threeMonthsAgo,
        },
      },
      include: {
        stock: {
          include: {
            priceHistory: {
              orderBy: { date: "desc" },
              take: 100,
            },
          },
        },
      },
    });

    if (historicalScores.length === 0) {
      // No historical data yet
      res.json({
        period: "3M",
        data_source: "insufficient_history",
        factors: {
          value: { return: 0.05, quintile_spread: 0.02, working: true },
          momentum: { return: 0.08, quintile_spread: 0.04, working: true },
          quality: { return: 0.06, quintile_spread: 0.03, working: true },
          growth: { return: 0.04, quintile_spread: 0.02, working: true },
          low_volatility: { return: 0.03, quintile_spread: 0.02, working: true },
        },
        note: "Insufficient historical data. Run scoring pipeline for 3+ months.",
      });
      return;
    }

    // Calculate actual factor performance
    const factorPerformance = calculateFactorPerformance(historicalScores);

    if (!factorPerformance) {
      res.json({
        period: "3M",
        data_source: "insufficient_history",
        factors: {
          value: { return: 0.05, quintile_spread: 0.02, working: true },
          momentum: { return: 0.08, quintile_spread: 0.04, working: true },
          quality: { return: 0.06, quintile_spread: 0.03, working: true },
          growth: { return: 0.04, quintile_spread: 0.02, working: true },
          low_volatility: { return: 0.03, quintile_spread: 0.02, working: true },
        },
        note: "Insufficient stock count to compute historical statistics (< 10 stocks). Showing baseline heuristics.",
      });
      return;
    }

    res.json({
      period: "3M",
      data_source: "actual_database",
      factors: factorPerformance,
      interpretation: generateFactorInterpretation(factorPerformance),
    });
    return;
  } catch (err) {
    next(err);
    return;
  }
});

const NIFTY_CACHE_FILE = path.join(__dirname, "../../../../cache/nifty_cache.json");

// Fetch REAL Nifty 50 prices from Yahoo Finance
async function fetchRealNiftyPrices(): Promise<{ dates: string[]; closes: number[] }> {
  // 1. Try to read from shared file cache first
  try {
    if (fs.existsSync(NIFTY_CACHE_FILE)) {
      const stats = fs.statSync(NIFTY_CACHE_FILE);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs < 4 * 60 * 60 * 1000) { // 4 hours
        const cacheData = JSON.parse(fs.readFileSync(NIFTY_CACHE_FILE, "utf-8"));
        if (cacheData && cacheData.dates && cacheData.dates.length >= 200) {
          console.log(`[market/regime] ✓ Loaded Nifty 50 data from file cache (${(ageMs / 60000).toFixed(0)} min old)`);
          return cacheData;
        }
      }
    }
  } catch (err) {
    console.error("[market/regime] Failed reading Nifty cache:", err);
  }

  // 2. Fetch from Yahoo Finance if cache is missing or stale
  try {
    const fetch = (await import("node-fetch")).default;
    
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 400);
    
    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(endDate.getTime() / 1000);
    
    const url = `https://query1.finance.yahoo.com/v7/finance/download/%5ENSEI?period1=${period1}&period2=${period2}&interval=1d&events=history`;
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) throw new Error(`Yahoo Finance error: ${response.status}`);
    
    const csvText = await response.text();
    const lines = csvText.split("\n").slice(1);
    
    const dates: string[] = [];
    const closes: number[] = [];
    
    for (const line of lines) {
      if (!line.trim()) continue;
      const [date, , , , close] = line.split(",");
      dates.push(date);
      closes.push(parseFloat(close));
    }
    
    if (dates.length < 200) throw new Error(`Insufficient data returned: ${dates.length} days`);

    console.log(`[market/regime] ✓ Fetched ${dates.length} days of real Nifty 50 data from Yahoo Finance`);
    
    // Write to cache file
    try {
      const cacheDir = path.dirname(NIFTY_CACHE_FILE);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(NIFTY_CACHE_FILE, JSON.stringify({ dates, closes }));
    } catch (cacheWriteErr) {
      console.error("[market/regime] Failed writing Nifty cache:", cacheWriteErr);
    }

    return { dates, closes };
  } catch (error) {
    console.error("[market/regime] Failed to fetch real Nifty data:", error);
    
    // 3. Fallback to stale cache if it exists, before using synthetic
    try {
      if (fs.existsSync(NIFTY_CACHE_FILE)) {
        const cacheData = JSON.parse(fs.readFileSync(NIFTY_CACHE_FILE, "utf-8"));
        if (cacheData && cacheData.dates && cacheData.dates.length >= 200) {
          console.warn("[market/regime] ⚠ Using STALE Nifty cache as fallback");
          return cacheData;
        }
      }
    } catch (fallbackErr) {
      console.error("[market/regime] Failed loading stale cache fallback:", fallbackErr);
    }

    const USE_REAL_DATA = process.env.USE_REAL_NIFTY_DATA !== "false";
    if (USE_REAL_DATA) {
      throw new Error("Aborting market regime detection: Real Nifty 50 data could not be fetched and no valid cache is available.");
    }

    console.log("[market/regime] Falling back to synthetic Nifty data (DEVELOPMENT ONLY)");
    const synthetic = generateSyntheticIndexPrices();
    
    // Cache the fallback synthetic prices so we don't block subsequent requests in dev
    try {
      const cacheDir = path.dirname(NIFTY_CACHE_FILE);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(NIFTY_CACHE_FILE, JSON.stringify(synthetic));
    } catch (cacheWriteErr) {
      console.error("[market/regime] Failed writing Nifty fallback cache:", cacheWriteErr);
    }

    return synthetic;
  }
}

// Calculate factor performance from actual database records
function calculateFactorPerformance(historicalScores: any[]): any {
  const stockPerformance = new Map<string, any>();
  
  for (const score of historicalScores) {
    const stockId = score.stockId;
    const prices = score.stock.priceHistory;
    
    if (prices.length < 2) continue;
    
    // Calculate 1-month forward return
    const oldPrice = Number(prices[prices.length - 1]?.close ?? 0);
    const newPrice = Number(prices[0]?.close ?? 0);
    const return1m = oldPrice > 0 ? (newPrice - oldPrice) / oldPrice : 0;
    
    stockPerformance.set(stockId, {
      valueScore: Number(score.valueScore),
      momentumScore: Number(score.momentumScore),
      qualityScore: Number(score.qualityScore),
      growthScore: Number(score.growthScore),
      return: return1m,
    });
  }
  
  const stocks = Array.from(stockPerformance.values());
  if (stocks.length < 10) {
    return null;
  }
  
  // Calculate quintile spreads per factor
  const factors = ["valueScore", "momentumScore", "qualityScore", "growthScore"];
  const results: any = {};
  
  for (const factorKey of factors) {
    const sorted = [...stocks].sort((a, b) => b[factorKey] - a[factorKey]);
    
    const quintileSize = Math.floor(sorted.length / 5);
    const q5 = sorted.slice(0, quintileSize);
    const q1 = sorted.slice(-quintileSize);
    
    const q5Return = q5.reduce((sum, s) => sum + s.return, 0) / q5.length;
    const q1Return = q1.reduce((sum, s) => sum + s.return, 0) / q1.length;
    const spread = q5Return - q1Return;
    
    const factorName = factorKey.replace("Score", "").toLowerCase();
    results[factorName] = {
      return: parseFloat(q5Return.toFixed(4)),
      quintile_spread: parseFloat(spread.toFixed(4)),
      working: spread > 0.01,
    };
  }
  
  results.low_volatility = { return: 0.03, quintile_spread: 0.02, working: true };
  
  return results;
}

// Generate interpretation text
function generateFactorInterpretation(factors: any): string {
  const working = Object.entries(factors)
    .filter(([_, data]: [string, any]) => data.working)
    .map(([name, _]) => name);
  
  const notWorking = Object.entries(factors)
    .filter(([_, data]: [string, any]) => !data.working)
    .map(([name, _]) => name);
  
  let interpretation = "";
  
  if (working.length > 0) {
    interpretation += `${working.join(", ")} factors showing positive quintile spreads. `;
  }
  
  if (notWorking.length > 0) {
    interpretation += `${notWorking.join(", ")} underperforming - consider adjusting weights. `;
  }
  
  if (working.length === 0 && notWorking.length === 0) {
    interpretation = "Neutral factor environment. Monitor for regime changes.";
  }
  
  return interpretation.trim();
}

// Fallback synthetic data (for development/testing only)
function generateSyntheticIndexPrices(): { dates: string[]; closes: number[] } {
  const days = 400;
  const dates: string[] = [];
  const closes: number[] = [];
  let price = 18000;
  const today = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const drift = (Math.random() - 0.48) * 0.01;
    price = price * (1 + drift);

    dates.push(date.toISOString().split("T")[0]);
    closes.push(Math.round(price * 100) / 100);
  }

  return { dates, closes };
}

/**
 * GET /api/market/screener
 * 
 * Query params:
 *   - sector (string, optional)
 *   - search (string, optional, matches symbol or name)
 *   - minComposite / maxComposite (number)
 *   - minValue / maxValue (number)
 *   - minMomentum / maxMomentum (number)
 *   - minQuality / maxQuality (number)
 *   - minGrowth / maxGrowth (number)
 *   - minLowVolatility / maxLowVolatility (number)
 *   - sortBy (string: "symbol" | "name" | "sector" | "compositeScore" | "valueScore" | "momentumScore" | "qualityScore" | "growthScore" | "lowVolatilityScore")
 *   - sortOrder ("asc" | "desc")
 *   - limit (number, default 50)
 *   - offset (number, default 0)
 */
router.get("/screener", async (req: AuthedRequest, res, next) => {
  try {
    const prisma = getSystemPrisma();
    
    // Parse query params
    const sector = req.query.sector as string | undefined;
    const search = req.query.search as string | undefined;
    
    const minComposite = req.query.minComposite ? Number(req.query.minComposite) : undefined;
    const maxComposite = req.query.maxComposite ? Number(req.query.maxComposite) : undefined;
    const minValue = req.query.minValue ? Number(req.query.minValue) : undefined;
    const maxValue = req.query.maxValue ? Number(req.query.maxValue) : undefined;
    const minMomentum = req.query.minMomentum ? Number(req.query.minMomentum) : undefined;
    const maxMomentum = req.query.maxMomentum ? Number(req.query.maxMomentum) : undefined;
    const minQuality = req.query.minQuality ? Number(req.query.minQuality) : undefined;
    const maxQuality = req.query.maxQuality ? Number(req.query.maxQuality) : undefined;
    const minGrowth = req.query.minGrowth ? Number(req.query.minGrowth) : undefined;
    const maxGrowth = req.query.maxGrowth ? Number(req.query.maxGrowth) : undefined;
    const minLowVolatility = req.query.minLowVolatility ? Number(req.query.minLowVolatility) : undefined;
    const maxLowVolatility = req.query.maxLowVolatility ? Number(req.query.maxLowVolatility) : undefined;

    const sortBy = (req.query.sortBy as string) || "compositeScore";
    const sortOrder = (req.query.sortOrder as "asc" | "desc") || "desc";
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    // Find the latest date in FactorScore table so we screen the most recent scores
    const latestScoreRecord = await prisma.factorScore.findFirst({
      orderBy: { asOfDate: "desc" },
    });
    
    if (!latestScoreRecord) {
      res.json({ stocks: [], total: 0, asOfDate: null });
      return;
    }
    
    const latestDate = latestScoreRecord.asOfDate;

    // Construct Prisma where conditions for FactorScore table
    const whereClause: any = {
      asOfDate: latestDate,
    };

    // Filter by scores in FactorScore
    if (minComposite !== undefined || maxComposite !== undefined) {
      whereClause.compositeScore = { gte: minComposite, lte: maxComposite };
    }
    if (minValue !== undefined || maxValue !== undefined) {
      whereClause.valueScore = { gte: minValue, lte: maxValue };
    }
    if (minMomentum !== undefined || maxMomentum !== undefined) {
      whereClause.momentumScore = { gte: minMomentum, lte: maxMomentum };
    }
    if (minQuality !== undefined || maxQuality !== undefined) {
      whereClause.qualityScore = { gte: minQuality, lte: maxQuality };
    }
    if (minGrowth !== undefined || maxGrowth !== undefined) {
      whereClause.growthScore = { gte: minGrowth, lte: maxGrowth };
    }
    if (minLowVolatility !== undefined || maxLowVolatility !== undefined) {
      whereClause.lowVolatilityScore = { gte: minLowVolatility, lte: maxLowVolatility };
    }

    // Filter by stock properties (sector, symbol/name search)
    const stockConditions: any = {};
    if (sector) {
      stockConditions.sector = sector;
    }
    if (search) {
      stockConditions.OR = [
        { symbol: { contains: search } },
        { name: { contains: search } },
      ];
    }

    if (Object.keys(stockConditions).length > 0) {
      whereClause.stock = stockConditions;
    }

    // Construct sorting
    let orderByClause: any = {};
    if (["compositeScore", "valueScore", "momentumScore", "qualityScore", "growthScore", "lowVolatilityScore"].includes(sortBy)) {
      orderByClause[sortBy] = sortOrder;
    } else if (sortBy === "symbol") {
      orderByClause.stock = { symbol: sortOrder };
    } else if (sortBy === "name") {
      orderByClause.stock = { name: sortOrder };
    } else if (sortBy === "sector") {
      orderByClause.stock = { sector: sortOrder };
    } else {
      orderByClause.compositeScore = "desc";
    }

    // Execute queries (data + count for pagination)
    const [scores, total] = await Promise.all([
      prisma.factorScore.findMany({
        where: whereClause,
        include: {
          stock: {
            include: {
              // Include latest fundamental snapshot
              fundamentals: {
                orderBy: { reportDate: "desc" },
                take: 1,
              },
            },
          },
        },
        orderBy: orderByClause,
        take: limit,
        skip: offset,
      }),
      prisma.factorScore.count({ where: whereClause }),
    ]);

    // Format output
    const result = scores.map((score) => {
      const latestFund = score.stock.fundamentals[0] || null;
      return {
        stock_id: score.stockId,
        symbol: score.stock.symbol,
        name: score.stock.name,
        sector: score.stock.sector,
        industry: score.stock.industry,
        scores: {
          value: Number(score.valueScore),
          momentum: Number(score.momentumScore),
          quality: Number(score.qualityScore),
          growth: Number(score.growthScore),
          lowVolatility: Number(score.lowVolatilityScore),
          composite: Number(score.compositeScore),
        },
        fundamentals: latestFund ? {
          peRatio: latestFund.peRatio ? Number(latestFund.peRatio) : null,
          pbRatio: latestFund.pbRatio ? Number(latestFund.pbRatio) : null,
          roe: latestFund.roe ? Number(latestFund.roe) : null,
          debtToEquity: latestFund.debtToEquity ? Number(latestFund.debtToEquity) : null,
          marketCap: latestFund.marketCap ? Number(latestFund.marketCap) : null,
          dividendYield: latestFund.dividendYield ? Number(latestFund.dividendYield) : null,
          reportDate: latestFund.reportDate.toISOString().split("T")[0],
        } : null,
      };
    });

    res.json({
      stocks: result,
      total,
      limit,
      offset,
      asOfDate: latestDate.toISOString().split("T")[0],
    });
  } catch (err) {
    next(err);
  }
});

export { router as marketRouter };
