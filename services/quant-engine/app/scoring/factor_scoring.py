"""
Factor Scoring Engine
======================
Computes standardized factor scores (0-100) for a universe of stocks on a given date.

Methodology (industry-standard cross-sectional z-score approach, same family of
methods used by MSCI Barra / Fama-French style factor models):

1. Pull raw fundamental + price data for the whole universe on `as_of_date`.
2. For each factor, compute one or more raw sub-metrics.
3. Winsorize (clip outliers) then z-score each sub-metric CROSS-SECTIONALLY
   (i.e. relative to the rest of the universe on that date, not historically).
   This matters: a P/E of 15 means something different in FMCG vs banking,
   so we also optionally sector-neutralize (z-score within sector).
4. Combine sub-metric z-scores into a single factor z-score (equal-weighted by default).
5. Convert z-score -> 0-100 percentile-style score via normal CDF, so scores
   are stable and interpretable regardless of the underlying units.
6. Composite score = weighted blend of the four factors (weights configurable
   per strategy — e.g. a "Value" strategy weights value_score heavily).

IMPORTANT LIMITATIONS (be upfront with users about these):
- Garbage in, garbage out: this is only as good as the fundamental data feed.
- Factor investing has real, well-documented periods of underperformance
  (e.g. value underperformed growth for most of 2010-2020). Backtested
  outperformance is not a guarantee of future returns.
- This is a research/scoring tool, not investment advice. Every recommendation
  generated downstream must carry this framing explicitly.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from dataclasses import dataclass
from scipy.stats import norm
from typing import Optional

from app.scoring.low_volatility_factor import compute_low_volatility_metrics, score_low_volatility
from app.scoring.regime_detection import MarketRegime, detect_market_regime, get_regime_factor_weights, RegimeConfig


# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------

@dataclass
class FactorWeights:
    """Weights for combining sub-metrics into a factor score. Must sum to 1.0."""
    value: dict
    momentum: dict
    quality: dict
    growth: dict
    low_volatility: dict | None = None  # New factor

    @staticmethod
    def default() -> "FactorWeights":
        return FactorWeights(
            value={"pe_inverse": 0.5, "pb_inverse": 0.5},
            momentum={"return_6m": 0.5, "return_12m": 0.5},
            quality={"roe": 0.5, "debt_to_equity_inverse": 0.5},
            growth={"eps_growth_yoy": 0.5, "revenue_growth_yoy": 0.5},
            low_volatility={"realized_vol": 0.25, "downside_dev": 0.30, "beta": 0.20, "max_drawdown": 0.25},
        )


WINSORIZE_LOWER_PCTL = 0.01
WINSORIZE_UPPER_PCTL = 0.99


# ----------------------------------------------------------------------------
# Core stats helpers
# ----------------------------------------------------------------------------

def winsorize(series: pd.Series) -> pd.Series:
    """Clip extreme outliers so a handful of bad/weird data points don't
    dominate the cross-sectional z-score."""
    lower = series.quantile(WINSORIZE_LOWER_PCTL)
    upper = series.quantile(WINSORIZE_UPPER_PCTL)
    return series.clip(lower=lower, upper=upper)


def cross_sectional_zscore(series: pd.Series, group: pd.Series | None = None) -> pd.Series:
    """Z-score a metric relative to the rest of the universe (or within sector
    if `group` is provided, i.e. sector-neutral scoring)."""
    clean = winsorize(series.astype(float))
    if group is not None:
        return clean.groupby(group).transform(
            lambda x: (x - x.mean()) / x.std(ddof=0) if x.std(ddof=0) > 0 else 0.0
        )
    std = clean.std(ddof=0)
    if std == 0 or np.isnan(std):
        return pd.Series(0.0, index=series.index)
    return (clean - clean.mean()) / std


def zscore_to_0_100(z: pd.Series) -> pd.Series:
    """Map z-scores to an intuitive 0-100 scale via the normal CDF.
    z=0 -> 50, z=+2 -> ~97.7, z=-2 -> ~2.3."""
    return (norm.cdf(z) * 100).round(2)


# ----------------------------------------------------------------------------
# Main scoring function
# ----------------------------------------------------------------------------

def compute_factor_scores(
    universe_df: pd.DataFrame,
    weights: FactorWeights = None,
    sector_neutral: bool = True,
    price_history: Optional[pd.DataFrame] = None,
    index_prices: Optional[pd.Series] = None,
    regime: Optional[MarketRegime] = None,
    use_regime_weights: bool = True,
    regime_config: Optional[RegimeConfig] = None,
) -> pd.DataFrame:
    """
    universe_df must contain one row per stock, as of a single date, with columns:
        stock_id, sector,
        pe_ratio, pb_ratio, roe, debt_to_equity,
        eps_growth_yoy, revenue_growth_yoy,
        return_6m, return_12m   (price returns, as decimals e.g. 0.15 = 15%)

    NEW PARAMETERS:
        price_history: DataFrame with columns=stock_ids, index=dates, values=close prices
                      Required for low volatility factor computation
        index_prices: Series with index=dates, values=index close (for beta calculation)
        regime: Detected market regime (if None and use_regime_weights=True, will auto-detect)
        use_regime_weights: If True, adjust factor weights based on regime
        regime_config: Configuration for regime detection. If None, default config is used.

    Returns the same dataframe with added columns:
        value_score, momentum_score, quality_score, growth_score, low_volatility_score, composite_score
    (all 0-100)
    """
    weights = weights or FactorWeights.default()
    df = universe_df.copy()
    group = df["sector"] if sector_neutral and "sector" in df.columns else None

    # --- Value: cheaper is better, so invert P/E and P/B (lower ratio -> higher score) ---
    pe_inv = 1 / df["pe_ratio"].replace(0, np.nan)
    pb_inv = 1 / df["pb_ratio"].replace(0, np.nan)
    value_z = (
        weights.value["pe_inverse"] * cross_sectional_zscore(pe_inv, group)
        + weights.value["pb_inverse"] * cross_sectional_zscore(pb_inv, group)
    )

    # --- Momentum: recent price strength ---
    momentum_z = (
        weights.momentum["return_6m"] * cross_sectional_zscore(df["return_6m"], group)
        + weights.momentum["return_12m"] * cross_sectional_zscore(df["return_12m"], group)
    )

    # --- Quality: high ROE, low leverage ---
    debt_inv = 1 / (1 + df["debt_to_equity"].clip(lower=0))
    quality_z = (
        weights.quality["roe"] * cross_sectional_zscore(df["roe"], group)
        + weights.quality["debt_to_equity_inverse"] * cross_sectional_zscore(debt_inv, group)
    )

    # --- Growth: earnings & revenue trajectory ---
    growth_z = (
        weights.growth["eps_growth_yoy"] * cross_sectional_zscore(df["eps_growth_yoy"], group)
        + weights.growth["revenue_growth_yoy"] * cross_sectional_zscore(df["revenue_growth_yoy"], group)
    )

    df["value_score"] = zscore_to_0_100(value_z)
    df["momentum_score"] = zscore_to_0_100(momentum_z)
    df["quality_score"] = zscore_to_0_100(quality_z)
    df["growth_score"] = zscore_to_0_100(growth_z)

    # --- NEW: Low Volatility Factor ---
    if price_history is not None and len(price_history) > 0:
        # Compute low vol metrics
        low_vol_metrics = compute_low_volatility_metrics(
            price_history,
            index_prices=index_prices,
            window_days=252,
        )
        
        # Score them
        low_vol_raw = score_low_volatility(low_vol_metrics, weights=weights.low_volatility)
        
        # Merge back into main dataframe
        low_vol_metrics['low_vol_raw_score'] = low_vol_raw
        df = df.merge(
            low_vol_metrics[['stock_id', 'low_vol_raw_score']],
            on='stock_id',
            how='left'
        )
        
        # Z-score and convert to 0-100
        low_vol_z = cross_sectional_zscore(df['low_vol_raw_score'], group)
        df["low_volatility_score"] = zscore_to_0_100(low_vol_z)
    else:
        # If no price history, set low vol score to neutral 50
        df["low_volatility_score"] = 50.0

    # Ensure configuration snapshot exists
    cfg = regime_config or RegimeConfig()
    import json
    config_dict = {
        "bull_momentum_threshold": cfg.bull_momentum_threshold,
        "bear_momentum_threshold": cfg.bear_momentum_threshold,
        "high_vol_percentile": cfg.high_vol_percentile,
        "sma_fast_days": cfg.sma_fast_days,
        "sma_slow_days": cfg.sma_slow_days,
        "enable_smoothing": cfg.enable_smoothing,
        "smoothing_window": cfg.smoothing_window,
        "volume_lookback_fast": cfg.volume_lookback_fast,
        "volume_lookback_slow": cfg.volume_lookback_slow,
        "volume_confirm_bull": cfg.volume_confirm_bull,
        "volume_confirm_bear": cfg.volume_confirm_bear
    }
    df["regime_config_used"] = json.dumps(config_dict)

    # --- Composite Score: Regime-Aware Weighting ---
    if use_regime_weights and regime is not None:
        regime_weights = get_regime_factor_weights(regime)
        df["composite_score"] = (
            regime_weights.value * df["value_score"] +
            regime_weights.momentum * df["momentum_score"] +
            regime_weights.quality * df["quality_score"] +
            regime_weights.growth * df["growth_score"] +
            regime_weights.low_volatility * df["low_volatility_score"]
        )
        df["regime_used"] = regime.value
    elif use_regime_weights and regime is None and index_prices is not None:
        # Auto-detect regime from index prices
        try:
            # Convert index_prices Series to DataFrame with date + close columns
            index_df = pd.DataFrame({
                'date': index_prices.index,
                'close': index_prices.values
            }).reset_index(drop=True)
            
            detected_regime, regime_meta = detect_market_regime(index_df, config=cfg)
            regime_weights = get_regime_factor_weights(detected_regime)
            
            df["composite_score"] = (
                regime_weights.value * df["value_score"] +
                regime_weights.momentum * df["momentum_score"] +
                regime_weights.quality * df["quality_score"] +
                regime_weights.growth * df["growth_score"] +
                regime_weights.low_volatility * df["low_volatility_score"]
            )
            df["regime_used"] = detected_regime.value
        except Exception as e:
            # Fall back to equal weights if regime detection fails
            df["composite_score"] = (
                df["value_score"] + df["momentum_score"] + df["quality_score"] + 
                df["growth_score"] + df["low_volatility_score"]
            ) / 5
            df["regime_used"] = "EQUAL_WEIGHT_FALLBACK"
    else:
        # Equal-weighted blend (original behavior)
        df["composite_score"] = (
            df["value_score"] + df["momentum_score"] + df["quality_score"] + 
            df["growth_score"] + df["low_volatility_score"]
        ) / 5
        df["regime_used"] = "EQUAL_WEIGHT"

    return df


def generate_rationale(row: pd.Series) -> str:
    """Turn factor scores into a plain-English explanation for the recommendation.
    This is a deterministic template; swap in an LLM call for richer prose later,
    but keep the underlying numbers as the source of truth (never let the LLM
    invent figures)."""
    strengths = []
    weaknesses = []
    
    # Include all 5 factors now
    factor_labels = [
        ("valuation", "value_score"),
        ("price momentum", "momentum_score"),
        ("balance sheet quality", "quality_score"),
        ("earnings growth", "growth_score"),
        ("risk profile", "low_volatility_score"),
    ]
    
    for label, col in factor_labels:
        if col not in row:
            continue
        score = row[col]
        if score >= 70:
            strengths.append(label)
        elif score <= 30:
            weaknesses.append(label)

    parts = []
    if strengths:
        parts.append(f"scores strongly on {', '.join(strengths)}")
    if weaknesses:
        parts.append(f"is comparatively weak on {', '.join(weaknesses)}")
    if not parts:
        parts.append("shows balanced, average scores across all factors")

    # Add regime context if available
    regime_note = ""
    if "regime_used" in row and row["regime_used"] not in ["EQUAL_WEIGHT", "EQUAL_WEIGHT_FALLBACK"]:
        regime = row["regime_used"]
        regime_context = {
            "BULL": "Current bull market regime favors momentum and growth",
            "BEAR": "Current bear market regime favors quality and defensive positioning",
            "HIGH_VOLATILITY": "Current high volatility regime emphasizes stability and quality",
            "SIDEWAYS": "Current sideways market regime favors value and quality",
        }
        regime_note = f" {regime_context.get(regime, '')}."

    return (
        f"{row.get('symbol', 'This stock')} {' and '.join(parts)} "
        f"relative to its peers as of the scoring date "
        f"(composite score: {row['composite_score']:.1f}/100).{regime_note} "
        f"This is a quantitative screen, not investment advice — "
        f"review qualitative factors before acting."
    )
