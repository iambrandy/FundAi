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
    enable_smoothing: bool = True  # Enable rolling majority vote filter to reduce regime switching noise
    smoothing_window: int = 5  # Trailing window size for smoothing mode
    volume_lookback_fast: int = 20  # Fast lookback for volume confirmation
    volume_lookback_slow: int = 100  # Slow lookback for volume confirmation
    volume_confirm_bull: float = 0.9  # starting heuristic: minimum volume ratio (20d SMA / 100d SMA) to confirm BULL trend
    volume_confirm_bear: float = 1.0  # starting heuristic: minimum volume ratio to confirm high-volume BEAR panic/distribution


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


def get_geopolitical_macro_context(date_val) -> str:
    """
    Returns rule-based historical and upcoming macro event overlays in Indian markets
    to add geopolitical context to the technical indicators.
    """
    try:
        dt = pd.to_datetime(date_val)
    except Exception:
        return "Standard policy cycle. Local equity trends driven by corporate earnings and global capital flows."
        
    year = dt.year
    month = dt.month
    day = dt.day
    
    # Check Union Budget dates (e.g. Feb 1 every year, or special mid-year budgets like July 2024 post-election)
    if month == 2 and day <= 7:
        return f"Union Budget Announcement window (Feb 1, {year}). Expect heightened policy focus and public spending revisions."
    if year == 2024 and month == 7 and 20 <= day <= 27:
        return "Post-Election Union Budget Presentation (July 23, 2024). Major capital gains tax and asset class adjustments."
        
    # Check General Election windows (e.g. Apr-Jun 2024)
    if year == 2024 and ((month == 4 and day >= 15) or month == 5 or (month == 6 and day <= 10)):
        return "Indian General Elections 2024. Elevated political risk and policy continuity speculation leading to structural volatility."
        
    # RBI MPC (Monetary Policy Committee) regular meeting windows (approx. early/mid of Feb, Apr, Jun, Aug, Oct, Dec)
    if month in [2, 4, 6, 8, 10, 12] and 3 <= day <= 10:
        return f"RBI Monetary Policy Committee (MPC) rate review week. Interest rate stance and domestic inflation guidance updates."
        
    # Default message indicating standard policy environment
    return "Standard policy cycle. Local equity trends driven by corporate earnings and global capital flows."


def detect_market_regime(
    index_prices: pd.DataFrame,
    config: RegimeConfig = None,
) -> tuple[MarketRegime, dict]:
    """
    Detect current market regime based on index price action and volume confirmation.
    
    Args:
        index_prices: DataFrame with columns ['date', 'close'], sorted by date
                     Should contain at least 250 trading days of history.
                     Note that index volume data when available acts as a proxy of 
                     aggregated general market participation rather than a direct exchange trade signal.
        config: Regime classification configuration
    
    Returns:
        (regime, metadata) tuple with detected regime and supporting metrics
    """
    cfg = config or RegimeConfig()
    
    if len(index_prices) < cfg.sma_slow_days:
        raise ValueError(
            f"Need at least {cfg.sma_slow_days} days of index data, got {len(index_prices)}"
        )
    
    df = index_prices.copy().sort_values('date')
    df['close'] = df['close'].astype(float)
    
    # --- Signal 1: Price momentum (6M return) ---
    df['momentum_6m'] = df['close'].pct_change(126)
    # Fill starting rows with return relative to start of series
    first_price = df['close'].iloc[0]
    df.loc[df['momentum_6m'].isna(), 'momentum_6m'] = (df['close'] / first_price) - 1
    
    # --- Signal 2: SMA trend ---
    df['sma_50'] = df['close'].rolling(cfg.sma_fast_days, min_periods=1).mean()
    df['sma_200'] = df['close'].rolling(cfg.sma_slow_days, min_periods=1).mean()
    df['price_above_sma_200'] = df['close'] > df['sma_200']
    df['golden_cross'] = df['sma_50'] > df['sma_200']
    
    # --- Signal 3: Realized volatility (20-day) ---
    df['return'] = df['close'].pct_change()
    df['realized_vol_20d'] = df['return'].rolling(20).std() * np.sqrt(252)
    
    # Rolling percentile calculation
    vols = df['realized_vol_20d'].fillna(0).values
    vol_percentiles = []
    for idx in range(len(vols)):
        history = vols[:idx+1]
        cur = vols[idx]
        if len(history) <= 1:
            vol_percentiles.append(0.0)
        else:
            vol_percentiles.append((history < cur).sum() / len(history))
    df['vol_percentile'] = vol_percentiles
    df['is_high_vol'] = df['vol_percentile'] > cfg.high_vol_percentile
    
    # --- Signal 4: Volume confirmation (Optional participation indicator) ---
    df['volume_ratio'] = 1.0
    if 'volume' in df.columns:
        # Interpolate / fill gaps to avoid zero-volume data quality landmines
        cleaned_vol = df['volume'].astype(float).replace(0.0, np.nan).ffill().fillna(0.0)
        df['vol_sma_fast'] = cleaned_vol.rolling(cfg.volume_lookback_fast, min_periods=1).mean()
        df['vol_sma_slow'] = cleaned_vol.rolling(cfg.volume_lookback_slow, min_periods=1).mean()
        df['volume_ratio'] = df['vol_sma_fast'] / df['vol_sma_slow'].replace(0, np.nan)
        df['volume_ratio'] = df['volume_ratio'].fillna(1.0)
    
    # --- Classification logic function ---
    def classify_row(r):
        if r['is_high_vol']:
            return MarketRegime.HIGH_VOLATILITY
        if r['momentum_6m'] > cfg.bull_momentum_threshold and r['golden_cross'] and r['price_above_sma_200'] and r['volume_ratio'] >= cfg.volume_confirm_bull:
            return MarketRegime.BULL
        if r['momentum_6m'] < cfg.bear_momentum_threshold and not r['golden_cross'] and r['volume_ratio'] >= cfg.volume_confirm_bear:
            return MarketRegime.BEAR
        return MarketRegime.SIDEWAYS
    
    df['raw_regime'] = df.apply(classify_row, axis=1)
    
    # --- Hysteresis / Transition smoothing filter ---
    if cfg.enable_smoothing:
        smoothed = []
        raw_values = df['raw_regime'].values
        for idx in range(len(raw_values)):
            start_idx = max(0, idx - cfg.smoothing_window + 1)
            subset = list(raw_values[start_idx:idx+1])
            most_common = max(set(subset), key=subset.count)
            smoothed.append(most_common)
        df['regime'] = smoothed
    else:
        df['regime'] = df['raw_regime']
        
    final_regime = df['regime'].iloc[-1]
    
    # --- Package results ---
    metadata = {
        "momentum_6m": float(df['momentum_6m'].iloc[-1]),
        "price_above_sma_200": bool(df['price_above_sma_200'].iloc[-1]),
        "golden_cross": bool(df['golden_cross'].iloc[-1]),
        "current_volatility": float(df['realized_vol_20d'].iloc[-1]) if not pd.isna(df['realized_vol_20d'].iloc[-1]) else 0.0,
        "vol_percentile": float(df['vol_percentile'].iloc[-1]),
        "is_high_vol": bool(df['is_high_vol'].iloc[-1]),
        "volume_ratio": float(df['volume_ratio'].iloc[-1]),
        "raw_regime": str(df['raw_regime'].iloc[-1].value),
        "macro_context": get_geopolitical_macro_context(df['date'].iloc[-1]),
    }
    
    return final_regime, metadata


def get_regime_factor_weights(regime: MarketRegime) -> RegimeFactorWeights:
    """Get optimized factor weights for given regime"""
    return REGIME_WEIGHTS[regime]


def backtest_regime_detection(
    index_prices: pd.DataFrame,
    window_days: int = 252,
    config: RegimeConfig = None,
) -> pd.DataFrame:
    """
    Backtest regime detection on historical data.
    Useful for validating regime classifier before production use.
    
    Returns DataFrame with columns: date, regime, raw_regime, momentum_6m, volatility, vol_percentile, volume_ratio
    """
    results = []
    cfg = config or RegimeConfig()
    
    for i in range(window_days, len(index_prices)):
        window = index_prices.iloc[max(0, i - window_days):i + 1]
        try:
            regime, meta = detect_market_regime(window, config=cfg)
            results.append({
                'date': window['date'].iloc[-1],
                'regime': regime.value,
                'raw_regime': meta['raw_regime'],
                'momentum_6m': meta['momentum_6m'],
                'volatility': meta['current_volatility'],
                'vol_percentile': meta['vol_percentile'],
                'volume_ratio': meta['volume_ratio'],
            })
        except Exception as e:
            # Skip windows with insufficient data
            continue
    
    return pd.DataFrame(results)
