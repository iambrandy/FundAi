/**
 * Synthetic provider — deterministic fake data for local dev, CI, and this
 * sandbox where no real market data vendor is reachable. Never use in
 * production; the job scheduler picks the provider via MARKET_DATA_PROVIDER
 * env var, and this one should only ever be selected as "synthetic".
 */

import { MarketDataProvider, OhlcvBar, FundamentalSnapshot } from "./MarketDataProvider";

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function hashSymbol(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export class SyntheticProvider implements MarketDataProvider {
  readonly name = "synthetic";

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
    return { ok: true, latencyMs: 0, error: null };
  }

  async getDailyBars(symbol: string, from: string, to: string): Promise<OhlcvBar[]> {
    const rand = seededRandom(hashSymbol(symbol));
    const start = new Date(from);
    const end = new Date(to);
    const bars: OhlcvBar[] = [];
    let price = 100 + (hashSymbol(symbol) % 500);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day === 0 || day === 6) continue; // skip weekends — NSE doesn't trade them

      const drift = (rand() - 0.48) * 0.02;
      const open = price;
      const close = price * (1 + drift);
      const high = Math.max(open, close) * (1 + rand() * 0.005);
      const low = Math.min(open, close) * (1 - rand() * 0.005);
      const volume = Math.floor(50000 + rand() * 500000);

      bars.push({
        date: d.toISOString().slice(0, 10),
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
        volume,
      });
      price = close;
    }
    return bars;
  }

  async getFundamentals(symbol: string): Promise<FundamentalSnapshot> {
    const rand = seededRandom(hashSymbol(symbol) + 1);
    return {
      reportDate: new Date().toISOString().slice(0, 10),
      peRatio: round2(8 + rand() * 50),
      pbRatio: round2(0.5 + rand() * 12),
      roe: round2(2 + rand() * 32),
      debtToEquity: round2(rand() * 2.5),
      epsGrowthYoy: round2(-15 + rand() * 60),
      revenueGrowthYoy: round2(-8 + rand() * 45),
      dividendYield: round2(rand() * 4),
      marketCap: Math.floor(1e10 + rand() * 5e12),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
