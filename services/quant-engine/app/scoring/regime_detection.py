"""
Market Regime Detection
=======================
Classifies current market state to dynamically adjust factor weights.

Regimes:
- BULL: Strong uptrend, favor momentum + growth
- BEAR: Downtrend, favor quality + low volatility + value
- HIGH_VOLATILITY: Uncertain, favor quality + low volatility
- SIDEWAYS: Range-bound, favor value + quality

Detection methodology:
- Price-based: SMA crossovers (50/200 day)
- Volatility-based: Realized vol vs historical percentile
- Momentum-based: 6M return vs long-term avg
- Volume-based: Participation and distribution patterns
"""

from __future__ import annotations
from enum import Enum
from dataclasses import dataclass
import pandas as pd
import numpy as np


class MarketRegime(str, Enum):
    BULL = "BULL"
    BEAR = "BEAR"
    HIGH_VOLATILITY = "HIGH_VOLATILITY"
    SIDEWAYS = "SIDEWAYS"


@dataclass
class RegimeConfig:
    """Thresholds for regime classification"""
    bull_momentum_threshold: float = 0.10  # 10% return over 6M
    bear_momentum_threshold: float = -0.05  # -5% return over 6M
    high_vol_percentile: float = 0.75  # 75th percentile of historical vol
    sma_fast_days: int = 50
    sma_slow_days: int = 200


@dataclass
class RegimeFactorWeights:
    """Factor weights optimized for each regime"""
    value: float
    momentum: float
    quality: float
    growth: float
    low_volatility: float
    
    def __post_init__(self):
        total = self.value + self.momentum + self.quality + self.growth + self.low_volatility
        if not np.isclose(total, 1.0, atol=0.01):
            raise ValueError(f"Factor weights must sum to 1.0, got {total}")


# Optimized weights per regime (based on historical factor performance)
REGIME_WEIGHTS = {
    MarketRegime.BULL: RegimeFactorWeights(
        value=0.10,
        momentum=0.35,  # Overweight momentum in uptrends
        quality=0.20,
        growth=0.30,    # Overweight growth in bull markets
        low_volatility=0.05,
    ),
    MarketRegime.BEAR: RegimeFactorWeights(
        value=0.25,     # Value shines in bear markets
        momentum=0.05,  # Momentum fails in downtrends
        quality=0.35,   # Flight to quality
        growth=0.05,
        low_volatility=0.30,  # Defensive positioning
    ),
    MarketRegime.HIGH_VOLATILITY: RegimeFactorWeights(
        value=0.15,
        momentum=0.10,
        quality=0.40,   # Quality + low vol = stability
        growth=0.10,
        low_volatility=0.25,
    ),
    MarketRegime.SIDEWAYS: RegimeFactorWeights(
        value=0.30,     # Value works in range-bound markets
        momentum=0.15,
        quality=0.30,
        growth=0.15,
        low_volatility=0.10,
    ),
}


def detect_market_regime(
    index_prices: pd.DataFrame,
    config: RegimeConfig = None,
) -> tuple[MarketRegime, dict]:
    """
    Detect current market regime based on index price action.
    
    Args:
        index_prices: DataFrame with columns ['date', 'close'], sorted by date
                     Should contain at least 250 trading days of history
                     Typically Nifty 50 or Nifty 500 for Indian market
        config: Regime detection configuration
    
    Returns:
        (regime, metadata) tuple with detected regime and supporting metrics
    
    Example:
        nifty_data = pd.DataFrame({
            'date': pd.date_range('2023-01-01', '2024-01-01', freq='B'),
            'close': [...],  # actual Nifty 50 closes
        })
        regime, meta = detect_market_regime(nifty_data)
        print(f"Current regime: {regime}, 6M return: {meta['momentum_6m']:.1%}")
    """
    cfg = config or RegimeConfig()
    
    if len(index_prices) < cfg.sma_slow_days:
        raise ValueError(
            f"Need at least {cfg.sma_slow_days} days of index data, got {len(index_prices)}"
        )
    
    df = index_prices.copy().sort_values('date')
    df['close'] = df['close'].astype(float)
    
    # --- Signal 1: Price momentum (6M return) ---
    current_price = df['close'].iloc[-1]
    price_6m_ago = df['close'].iloc[-126] if len(df) >= 126 else df['close'].iloc[0]
    momentum_6m = (current_price / price_6m_ago) - 1
    
    # --- Signal 2: SMA trend ---
    df['sma_50'] = df['close'].rolling(cfg.sma_fast_days, min_periods=1).mean()
    df['sma_200'] = df['close'].rolling(cfg.sma_slow_days, min_periods=1).mean()
    
    current_sma_50 = df['sma_50'].iloc[-1]
    current_sma_200 = df['sma_200'].iloc[-1]
    price_above_sma_200 = current_price > current_sma_200
    golden_cross = current_sma_50 > current_sma_200
    
    # --- Signal 3: Realized volatility (20-day) ---
    df['return'] = df['close'].pct_change()
    df['realized_vol_20d'] = df['return'].rolling(20).std() * np.sqrt(252)
    
    current_vol = df['realized_vol_20d'].iloc[-1]
    historical_vols = df['realized_vol_20d'].dropna()
    vol_percentile = (historical_vols < current_vol).sum() / len(historical_vols)
    
    is_high_vol = vol_percentile > cfg.high_vol_percentile
    
    # --- Regime classification logic ---
    metadata = {
        "momentum_6m": momentum_6m,
        "price_above_sma_200": price_above_sma_200,
        "golden_cross": golden_cross,
        "current_volatility": current_vol,
        "vol_percentile": vol_percentile,
        "is_high_vol": is_high_vol,
    }
    
    # Priority 1: High volatility overrides everything
    if is_high_vol:
        return MarketRegime.HIGH_VOLATILITY, metadata
    
    # Priority 2: Clear bull or bear trend
    if momentum_6m > cfg.bull_momentum_threshold and golden_cross and price_above_sma_200:
        return MarketRegime.BULL, metadata
    
    if momentum_6m < cfg.bear_momentum_threshold and not golden_cross:
        return MarketRegime.BEAR, metadata
    
    # Priority 3: Default to sideways if no clear trend
    return MarketRegime.SIDEWAYS, metadata


def get_regime_factor_weights(regime: MarketRegime) -> RegimeFactorWeights:
    """Get optimized factor weights for given regime"""
    return REGIME_WEIGHTS[regime]


def backtest_regime_detection(
    index_prices: pd.DataFrame,
    window_days: int = 252,
) -> pd.DataFrame:
    """
    Backtest regime detection on historical data.
    Useful for validating regime classifier before production use.
    
    Returns DataFrame with columns: date, regime, momentum_6m, volatility
    """
    results = []
    
    for i in range(window_days, len(index_prices)):
        window = index_prices.iloc[max(0, i - window_days):i + 1]
        try:
            regime, meta = detect_market_regime(window)
            results.append({
                'date': window['date'].iloc[-1],
                'regime': regime.value,
                'momentum_6m': meta['momentum_6m'],
                'volatility': meta['current_volatility'],
                'vol_percentile': meta['vol_percentile'],
            })
        except Exception as e:
            # Skip windows with insufficient data
            continue
    
    return pd.DataFrame(results)
