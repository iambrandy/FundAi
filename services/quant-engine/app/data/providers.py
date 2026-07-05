"""
Market Data Providers (Python)
================================
Abstract base class + two concrete implementations.

Usage:
    from app.data.providers import get_provider
    provider = get_provider()                    # reads MARKET_DATA_PROVIDER env var
    bars = provider.get_daily_bars("^NSEI", "2023-01-01", "2026-01-01")
    health = provider.health_check()

Providers:
    YFinanceProvider  — yfinance-backed, retry/backoff, data quality validation,
                        raw response cached to disk. Use in production.
    SyntheticProvider — deterministic seed-based fake data. Use in dev/CI.
                        Never deleted; always available by setting
                        MARKET_DATA_PROVIDER=synthetic.
"""

from __future__ import annotations

import logging
import os
import time
import json
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Abstract interface
# ---------------------------------------------------------------------------

class MarketDataProvider(ABC):
    """
    Interface every data source must implement.
    Jobs never call vendor SDKs directly — only this interface — so swapping
    providers is a config change, not a code change.
    """

    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def get_daily_bars(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        """
        Return OHLCV bars between start and end (inclusive).

        Returns:
            DataFrame with columns: date, open, high, low, close, volume
            Rows where high < low, close is null, or volume < 0 are rejected.
        """
        ...

    @abstractmethod
    def get_fundamentals(self, symbol: str) -> Optional[dict]:
        """
        Return the latest fundamental snapshot for a symbol, or None if unavailable.

        Keys: report_date, pe_ratio, pb_ratio, roe, debt_to_equity,
              eps_growth_yoy, revenue_growth_yoy, dividend_yield, market_cap
        """
        ...

    @abstractmethod
    def health_check(self) -> dict:
        """
        Lightweight connectivity check. Returns:
            {"ok": bool, "latency_ms": float, "error": str | None}

        On failure: logs at ERROR level with full structured context.
        Never raises — always returns a dict.
        """
        ...


# ---------------------------------------------------------------------------
# Data quality validation (shared)
# ---------------------------------------------------------------------------

def _validate_bars(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    """
    Reject rows with data quality problems that real feeds produce regularly.
    Logs every rejection so a systematic feed problem is visible.
    """
    original_len = len(df)
    bad_high_low = df["high"] < df["low"]
    bad_close = df["close"].isna()
    bad_volume = df["volume"] < 0

    bad_mask = bad_high_low | bad_close | bad_volume
    if bad_mask.any():
        n_bad = bad_mask.sum()
        logger.warning(
            "[data_quality] Rejected %d/%d bars for %s: "
            "high<low=%d, null_close=%d, negative_volume=%d",
            n_bad, original_len, symbol,
            bad_high_low.sum(), bad_close.sum(), bad_volume.sum(),
        )
        df = df[~bad_mask].copy()

    return df


# ---------------------------------------------------------------------------
# YFinance provider
# ---------------------------------------------------------------------------

_CACHE_DIR = Path(os.environ.get("MARKET_DATA_CACHE_DIR", "./cache/market_data"))
_CACHE_TTL_SECONDS = 4 * 3600  # 4 hours


def _cache_path(symbol: str, start: str, end: str) -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    safe_sym = symbol.replace("^", "IDX_").replace(".", "_")
    return _CACHE_DIR / f"{safe_sym}_{start}_{end}_raw.json"


def _load_cache(symbol: str, start: str, end: str) -> Optional[pd.DataFrame]:
    path = _cache_path(symbol, start, end)
    if not path.exists():
        return None
    age = time.time() - path.stat().st_mtime
    if age > _CACHE_TTL_SECONDS:
        return None
    try:
        raw = json.loads(path.read_text())
        df = pd.DataFrame(raw)
        df["date"] = pd.to_datetime(df["date"]).dt.date
        return df
    except Exception as e:
        logger.warning("[cache] Failed to load cache for %s: %s", symbol, e)
        return None


def _save_cache(df: pd.DataFrame, symbol: str, start: str, end: str) -> None:
    path = _cache_path(symbol, start, end)
    try:
        # Serialise raw response before any transformation
        serialisable = df.copy()
        serialisable["date"] = serialisable["date"].astype(str)
        path.write_text(json.dumps(serialisable.to_dict(orient="records")))
    except Exception as e:
        logger.warning("[cache] Failed to write cache for %s: %s", symbol, e)


class YFinanceProvider(MarketDataProvider):
    """
    yfinance-backed market data provider.
    - 3 retries with exponential backoff (2s, 4s, 8s)
    - Data quality validation on every fetch
    - Raw response cached to disk before transformation
    """

    @property
    def name(self) -> str:
        return "yfinance"

    def _fetch_with_retry(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        try:
            import yfinance as yf
        except ImportError:
            raise ImportError("yfinance not installed. Run: pip install yfinance")

        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            try:
                ticker = yf.Ticker(symbol)
                raw = ticker.history(start=start, end=end)
                if raw.empty:
                    raise ValueError(f"Empty response for {symbol}")
                return raw
            except Exception as e:
                wait = 2 ** attempt  # 2, 4, 8 seconds
                if attempt < max_attempts:
                    logger.warning(
                        "[yfinance] Attempt %d/%d failed for %s: %s. Retrying in %ds.",
                        attempt, max_attempts, symbol, e, wait,
                    )
                    time.sleep(wait)
                else:
                    raise

    def get_daily_bars(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        cached = _load_cache(symbol, start, end)
        if cached is not None:
            logger.debug("[yfinance] Cache hit for %s", symbol)
            return _validate_bars(cached, symbol)

        raw = self._fetch_with_retry(symbol, start, end)

        # Normalise columns
        df = raw.reset_index()
        df.columns = [c.lower() for c in df.columns]
        date_col = "date" if "date" in df.columns else df.columns[0]
        df = df.rename(columns={date_col: "date"})
        df["date"] = pd.to_datetime(df["date"]).dt.date
        df = df[["date", "open", "high", "low", "close", "volume"]].copy()

        # Cache the raw (pre-validation) response so a validation bug
        # doesn't require re-fetching from the vendor
        _save_cache(df, symbol, start, end)

        return _validate_bars(df, symbol)

    def get_fundamentals(self, symbol: str) -> Optional[dict]:
        try:
            import yfinance as yf
        except ImportError:
            raise ImportError("yfinance not installed.")

        try:
            info = yf.Ticker(symbol).info
            return {
                "report_date": datetime.now().strftime("%Y-%m-%d"),
                "pe_ratio": info.get("trailingPE"),
                "pb_ratio": info.get("priceToBook"),
                "roe": info.get("returnOnEquity"),
                "debt_to_equity": info.get("debtToEquity"),
                "eps_growth_yoy": info.get("earningsGrowth"),
                "revenue_growth_yoy": info.get("revenueGrowth"),
                "dividend_yield": info.get("dividendYield"),
                "market_cap": info.get("marketCap"),
            }
        except Exception as e:
            logger.warning("[yfinance] get_fundamentals failed for %s: %s", symbol, e)
            return None

    def health_check(self) -> dict:
        """
        Fetch a single Nifty 50 quote as a connectivity probe.
        Logs structured error on failure so a silent data outage is visible.
        """
        t0 = time.perf_counter()
        try:
            import yfinance as yf
            ticker = yf.Ticker("^NSEI")
            hist = ticker.history(period="1d")
            latency_ms = (time.perf_counter() - t0) * 1000
            if hist.empty:
                raise ValueError("Empty response from ^NSEI health probe")
            logger.info("[data_health] YFinanceProvider OK (%.0fms)", latency_ms)
            return {"ok": True, "latency_ms": latency_ms, "error": None}
        except Exception as e:
            latency_ms = (time.perf_counter() - t0) * 1000
            logger.error(
                "[data_health] YFinanceProvider FAILED",
                extra={
                    "provider": "yfinance",
                    "error": str(e),
                    "latency_ms": latency_ms,
                    "symbol_tested": "^NSEI",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            return {"ok": False, "latency_ms": latency_ms, "error": str(e)}


# ---------------------------------------------------------------------------
# Synthetic provider (dev / CI — never removed)
# ---------------------------------------------------------------------------

class SyntheticProvider(MarketDataProvider):
    """
    Deterministic fake data for local dev and CI.
    Never use in production. Selected by MARKET_DATA_PROVIDER=synthetic.
    """

    @property
    def name(self) -> str:
        return "synthetic"

    def get_daily_bars(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        seed = abs(hash(symbol)) % (2**31)
        rng = np.random.default_rng(seed)
        start_dt = datetime.strptime(start, "%Y-%m-%d")
        end_dt = datetime.strptime(end, "%Y-%m-%d")

        rows = []
        price = 100.0 + (seed % 500)
        d = start_dt
        while d <= end_dt:
            if d.weekday() < 5:  # skip weekends
                drift = rng.normal(0.0002, 0.015)
                open_ = price
                close = price * (1 + drift)
                high = max(open_, close) * (1 + abs(rng.normal(0, 0.003)))
                low = min(open_, close) * (1 - abs(rng.normal(0, 0.003)))
                volume = int(50_000 + rng.uniform(0, 500_000))
                rows.append({
                    "date": d.date(),
                    "open": round(open_, 2),
                    "high": round(high, 2),
                    "low": round(low, 2),
                    "close": round(close, 2),
                    "volume": volume,
                })
                price = close
            d += timedelta(days=1)

        return pd.DataFrame(rows)

    def get_fundamentals(self, symbol: str) -> Optional[dict]:
        seed = abs(hash(symbol + "_f")) % (2**31)
        rng = np.random.default_rng(seed)
        return {
            "report_date": datetime.now().strftime("%Y-%m-%d"),
            "pe_ratio": round(float(8 + rng.uniform(0, 42)), 2),
            "pb_ratio": round(float(0.5 + rng.uniform(0, 11.5)), 2),
            "roe": round(float(2 + rng.uniform(0, 33)), 2),
            "debt_to_equity": round(float(rng.uniform(0, 2.5)), 2),
            "eps_growth_yoy": round(float(-15 + rng.uniform(0, 55)), 2),
            "revenue_growth_yoy": round(float(-8 + rng.uniform(0, 43)), 2),
            "dividend_yield": round(float(rng.uniform(0, 4)), 2),
            "market_cap": int(1e10 + rng.uniform(0, 5e12)),
        }

    def health_check(self) -> dict:
        return {"ok": True, "latency_ms": 0.0, "error": None}


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_provider() -> MarketDataProvider:
    """
    Returns the active provider selected by MARKET_DATA_PROVIDER env var.
    Defaults to 'yfinance'. Set to 'synthetic' for dev/CI.
    """
    kind = os.environ.get("MARKET_DATA_PROVIDER", "yfinance")
    if kind == "yfinance":
        return YFinanceProvider()
    if kind == "synthetic":
        return SyntheticProvider()
    raise ValueError(
        f"Unknown MARKET_DATA_PROVIDER '{kind}'. "
        "Valid options: 'yfinance', 'synthetic'."
    )
