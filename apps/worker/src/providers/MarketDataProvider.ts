/**
 * Market Data Provider Interface
 * ================================
 * Every real vendor (Kite Connect, Alpha Vantage, NSE data partners, etc.)
 * implements this interface. Jobs never call a vendor SDK directly — they
 * only ever talk to `MarketDataProvider`, so swapping providers, or running
 * multiple in parallel with fallback, is a config change, not a rewrite.
 *
 * IMPORTANT: rate limits differ wildly by vendor and by pricing tier. Real
 * implementations MUST implement their own backoff/retry and respect the
 * vendor's documented rate limit — this file only defines the contract.
 */

export interface OhlcvBar {
  date: string; // ISO date, YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FundamentalSnapshot {
  reportDate: string;
  peRatio: number | null;
  pbRatio: number | null;
  roe: number | null;
  debtToEquity: number | null;
  epsGrowthYoy: number | null;
  revenueGrowthYoy: number | null;
  dividendYield: number | null;
  marketCap: number | null;
}

export interface MarketDataProvider {
  readonly name: string;

  /** Daily OHLCV between two dates (inclusive), for a single symbol. */
  getDailyBars(symbol: string, from: string, to: string): Promise<OhlcvBar[]>;

  /** Latest available fundamental snapshot for a symbol. */
  getFundamentals(symbol: string): Promise<FundamentalSnapshot | null>;

  /** Cheap way to check the provider is reachable/authenticated before a full run. */
  healthCheck(): Promise<boolean>;
}
