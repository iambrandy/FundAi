"""
Data Provider Tests
====================
Tests for both YFinanceProvider and SyntheticProvider.
Run with:
    python -m pytest tests/test_data_providers.py -v --tb=short
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import pandas as pd
import numpy as np
from unittest.mock import patch, MagicMock

from app.data.providers import (
    SyntheticProvider,
    YFinanceProvider,
    _validate_bars,
)


# ---------------------------------------------------------------------------
# SyntheticProvider tests
# ---------------------------------------------------------------------------

def test_synthetic_provider_returns_valid_bars():
    """SyntheticProvider must return a well-formed DataFrame for any symbol."""
    provider = SyntheticProvider()
    df = provider.get_daily_bars("RELIANCE.NS", "2024-01-01", "2024-03-31")

    assert isinstance(df, pd.DataFrame), "Expected a DataFrame"
    assert len(df) > 0, "Expected at least one bar"
    required_cols = {"date", "open", "high", "low", "close", "volume"}
    assert required_cols.issubset(df.columns), f"Missing columns: {required_cols - set(df.columns)}"

    # No nulls in price columns
    assert df["close"].notna().all(), "Null close prices"
    assert df["open"].notna().all(), "Null open prices"

    # Structural integrity: high >= low always
    assert (df["high"] >= df["low"]).all(), "high < low found in synthetic data"

    # Volumes non-negative
    assert (df["volume"] >= 0).all(), "Negative volumes in synthetic data"


def test_synthetic_provider_is_deterministic():
    """Same symbol + dates must produce identical results across calls."""
    provider = SyntheticProvider()
    df1 = provider.get_daily_bars("TCS.NS", "2024-06-01", "2024-06-30")
    df2 = provider.get_daily_bars("TCS.NS", "2024-06-01", "2024-06-30")
    pd.testing.assert_frame_equal(df1, df2)


def test_synthetic_provider_fundamentals_returns_dict():
    """get_fundamentals must return a dict with required keys."""
    provider = SyntheticProvider()
    result = provider.get_fundamentals("INFY.NS")
    assert isinstance(result, dict)
    for key in ("pe_ratio", "pb_ratio", "roe", "debt_to_equity", "market_cap"):
        assert key in result, f"Missing key: {key}"


def test_synthetic_health_check_returns_structured_dict():
    """SyntheticProvider.health_check() must return {ok, latency_ms, error}."""
    provider = SyntheticProvider()
    result = provider.health_check()
    assert isinstance(result, dict), "Expected dict from health_check()"
    assert "ok" in result, "Missing 'ok' key"
    assert "latency_ms" in result, "Missing 'latency_ms' key"
    assert "error" in result, "Missing 'error' key"
    assert result["ok"] is True, "SyntheticProvider should always be healthy"
    assert result["error"] is None, "SyntheticProvider should never have an error"


# ---------------------------------------------------------------------------
# Data quality validation tests (shared logic)
# ---------------------------------------------------------------------------

def test_data_quality_rejects_high_less_than_low():
    """Rows where high < low must be dropped, not passed through."""
    good_row = {"date": "2024-01-02", "open": 100.0, "high": 105.0, "low": 98.0,
                "close": 103.0, "volume": 100_000}
    bad_row  = {"date": "2024-01-03", "open": 100.0, "high": 95.0,  "low": 98.0,
                "close": 96.0,  "volume": 50_000}  # high < low

    df = pd.DataFrame([good_row, bad_row])
    validated = _validate_bars(df, "TEST")

    assert len(validated) == 1, f"Expected 1 row after filtering, got {len(validated)}"
    assert validated.iloc[0]["date"] == "2024-01-02"


def test_data_quality_rejects_null_close():
    """Rows with null close must be rejected."""
    rows = [
        {"date": "2024-01-02", "open": 100.0, "high": 105.0, "low": 98.0,
         "close": 103.0, "volume": 100_000},
        {"date": "2024-01-03", "open": 102.0, "high": 107.0, "low": 101.0,
         "close": None,  "volume": 80_000},  # null close
    ]
    df = pd.DataFrame(rows)
    validated = _validate_bars(df, "TEST")
    assert len(validated) == 1
    assert validated.iloc[0]["date"] == "2024-01-02"


def test_data_quality_rejects_negative_volume():
    """Rows with negative volume must be rejected."""
    rows = [
        {"date": "2024-01-02", "open": 100.0, "high": 105.0, "low": 98.0,
         "close": 103.0, "volume": 100_000},
        {"date": "2024-01-03", "open": 102.0, "high": 107.0, "low": 101.0,
         "close": 104.0, "volume": -1},  # negative volume
    ]
    df = pd.DataFrame(rows)
    validated = _validate_bars(df, "TEST")
    assert len(validated) == 1


def test_data_quality_passes_clean_data():
    """Clean data must pass through unchanged."""
    rows = [
        {"date": "2024-01-02", "open": 100.0, "high": 105.0, "low": 98.0,
         "close": 103.0, "volume": 100_000},
        {"date": "2024-01-03", "open": 103.0, "high": 108.0, "low": 102.0,
         "close": 106.0, "volume": 90_000},
    ]
    df = pd.DataFrame(rows)
    validated = _validate_bars(df, "TEST")
    assert len(validated) == 2


# ---------------------------------------------------------------------------
# YFinanceProvider health_check structure test
# ---------------------------------------------------------------------------

def test_yfinance_health_check_returns_structured_dict_on_failure():
    """
    Even on failure, health_check() must return {ok, latency_ms, error}
    and never raise. Verified by simulating a network error.
    """
    provider = YFinanceProvider()

    with patch.object(provider, "_fetch_with_retry", side_effect=Exception("Network unreachable")):
        # health_check() calls yfinance directly via ticker.history, not _fetch_with_retry
        # so we mock yfinance at the import level
        mock_ticker = MagicMock()
        mock_ticker.history.side_effect = Exception("Network unreachable")

        with patch("yfinance.Ticker", return_value=mock_ticker):
            result = provider.health_check()

    assert isinstance(result, dict), "health_check() must always return a dict"
    assert "ok" in result
    assert "latency_ms" in result
    assert "error" in result
    assert result["ok"] is False, "Expected ok=False on network failure"
    assert result["error"] is not None, "Expected error message on failure"
    assert isinstance(result["latency_ms"], float), "latency_ms must be a float"
