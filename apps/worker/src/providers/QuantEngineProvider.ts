import { MarketDataProvider, OhlcvBar, FundamentalSnapshot } from "./MarketDataProvider";
import fetch from "node-fetch";

export class QuantEngineProvider implements MarketDataProvider {
  readonly name = "quant-engine";
  
  private readonly baseUrl = process.env.QUANT_ENGINE_URL ?? "http://localhost:8811";
  private readonly token = process.env.INTERNAL_SERVICE_TOKEN ?? "";

  private async callQuantEngine<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": this.token,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Quant engine ${path} returned ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getDailyBars(symbol: string, from: string, to: string): Promise<OhlcvBar[]> {
    // Add .NS suffix if not present (NSE stocks on Yahoo Finance)
    const yfsymbol = (symbol.startsWith("^") || symbol.endsWith(".NS")) ? symbol : `${symbol}.NS`;
    
    interface DailyBarJson {
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }

    const data = await this.callQuantEngine<DailyBarJson[]>("/get-daily-bars", {
      symbol: yfsymbol,
      start_date: from,
      end_date: to,
    });

    return data.map((b) => ({
      date: b.date,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
    }));
  }

  async getFundamentals(symbol: string): Promise<FundamentalSnapshot | null> {
    const yfsymbol = (symbol.startsWith("^") || symbol.endsWith(".NS")) ? symbol : `${symbol}.NS`;

    interface FundamentalJson {
      report_date: string;
      pe_ratio: number | null;
      pb_ratio: number | null;
      roe: number | null;
      debt_to_equity: number | null;
      eps_growth_yoy: number | null;
      revenue_growth_yoy: number | null;
      dividend_yield: number | null;
      market_cap: number | null;
    }

    try {
      const data = await this.callQuantEngine<FundamentalJson | null>("/get-fundamentals", {
        symbol: yfsymbol,
      });

      if (!data) return null;

      // Yahoo Finance returns ROE, growth, and dividend yield as fractions (e.g. 0.15 for 15%).
      // We multiply by 100 to convert them to percentages to keep DB formats consistent.
      return {
        reportDate: data.report_date,
        peRatio: data.pe_ratio !== null ? Number(data.pe_ratio) : null,
        pbRatio: data.pb_ratio !== null ? Number(data.pb_ratio) : null,
        roe: data.roe !== null ? Number(data.roe) * 100 : null,
        debtToEquity: data.debt_to_equity !== null ? Number(data.debt_to_equity) : null,
        epsGrowthYoy: data.eps_growth_yoy !== null ? Number(data.eps_growth_yoy) * 100 : null,
        revenueGrowthYoy: data.revenue_growth_yoy !== null ? Number(data.revenue_growth_yoy) * 100 : null,
        dividendYield: data.dividend_yield !== null ? Number(data.dividend_yield) * 100 : null,
        marketCap: data.market_cap !== null ? Number(data.market_cap) : null,
      };
    } catch (err) {
      console.warn(`[QuantEngineProvider] Failed to fetch fundamentals for ${symbol}:`, err);
      return null;
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/data-health`, {
        headers: {
          "x-internal-token": this.token,
        },
      });
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        throw new Error(`Data health check endpoint returned ${res.status}`);
      }
      const data: any = await res.json();
      return {
        ok: data.ok,
        latencyMs: latencyMs,
        error: data.error,
      };
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err.message || String(err),
      };
    }
  }
}
