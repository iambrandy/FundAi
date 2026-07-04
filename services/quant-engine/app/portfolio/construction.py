"""
Portfolio Construction Engine
==============================
Takes factor-scored stocks and builds an actual investable model portfolio,
with position and concentration limits — NOT just "top N scores, equal weight".

Why this matters: naive top-N selection ignores sector concentration risk
(e.g. all top scorers could be banking stocks) and single-stock risk. A real
portfolio needs constraints even at the "recommendation engine" stage, or the
backtests will look great and the live portfolio will blow up on a sector
drawdown.

Constraints implemented:
  - max_position_weight: no single stock > X% of portfolio
  - max_sector_weight: no single sector > Y% of portfolio
  - min_positions / max_positions: portfolio size bounds
  - score-weighted allocation within those constraints (higher score = more
    weight, not equal weight — but capped)
"""

from __future__ import annotations

import pandas as pd
from dataclasses import dataclass


@dataclass
class ConstructionConstraints:
    max_position_weight_pct: float = 8.0
    max_sector_weight_pct: float = 25.0
    min_positions: int = 15
    max_positions: int = 30
    min_composite_score: float = 55.0  # don't include mediocre-or-worse stocks


def construct_model_portfolio(
    scored_universe: pd.DataFrame,
    constraints: ConstructionConstraints = None,
) -> pd.DataFrame:
    """
    scored_universe: output of compute_factor_scores(), must have
        stock_id, symbol, sector, composite_score

    Returns a dataframe: stock_id, symbol, sector, composite_score, target_weight_pct
    summing to 100.0 (or close, after rounding).
    """
    c = constraints or ConstructionConstraints()

    candidates = scored_universe[
        scored_universe["composite_score"] >= c.min_composite_score
    ].sort_values("composite_score", ascending=False)

    if len(candidates) < c.min_positions:
        raise ValueError(
            f"Only {len(candidates)} stocks clear the min_composite_score threshold "
            f"({c.min_composite_score}); need at least {c.min_positions}. "
            f"Lower the threshold or widen the universe."
        )

    selected = candidates.head(c.max_positions).copy()

    # Score-proportional initial weights (raw score as weight basis, so higher
    # conviction names get more capital, within caps applied next)
    selected["raw_weight"] = selected["composite_score"] / selected["composite_score"].sum()

    # --- Iteratively enforce position cap, redistributing excess to uncapped names ---
    weights = selected.set_index("stock_id")["raw_weight"].copy()
    max_w = c.max_position_weight_pct / 100
    for _ in range(50):  # converges fast; hard cap on iterations for safety
        over = weights[weights > max_w]
        if over.empty:
            break
        excess = (over - max_w).sum()
        weights[over.index] = max_w
        under_mask = weights < max_w
        if under_mask.sum() == 0:
            break
        weights[under_mask] += excess * (weights[under_mask] / weights[under_mask].sum())

    selected["target_weight_pct"] = (weights.reindex(selected["stock_id"]).values * 100).round(2)

    # --- Enforce sector cap (trim overweight sectors, redistribute pro-rata to others) ---
    selected = _enforce_sector_cap(selected, c.max_sector_weight_pct)

    # Renormalize to exactly 100 after rounding drift
    drift = 100.0 - selected["target_weight_pct"].sum()
    if abs(drift) > 0.01:
        selected.loc[selected.index[0], "target_weight_pct"] += round(drift, 2)

    return selected[["stock_id", "symbol", "sector", "composite_score", "target_weight_pct"]].reset_index(drop=True)


def _enforce_sector_cap(df: pd.DataFrame, max_sector_pct: float) -> pd.DataFrame:
    df = df.copy()
    for _ in range(50):
        sector_totals = df.groupby("sector")["target_weight_pct"].sum()
        breaches = sector_totals[sector_totals > max_sector_pct]
        if breaches.empty:
            break
        for sector, total in breaches.items():
            scale = max_sector_pct / total
            mask = df["sector"] == sector
            excess = df.loc[mask, "target_weight_pct"].sum() * (1 - scale)
            df.loc[mask, "target_weight_pct"] *= scale
            # redistribute excess to all other names, pro-rata
            other_mask = ~mask
            if other_mask.sum() > 0:
                other_total = df.loc[other_mask, "target_weight_pct"].sum()
                if other_total > 0:
                    df.loc[other_mask, "target_weight_pct"] += (
                        excess * df.loc[other_mask, "target_weight_pct"] / other_total
                    )
    return df


def diff_against_current_holdings(
    model_portfolio: pd.DataFrame,
    current_holdings: pd.DataFrame,
    portfolio_value: float,
    prices: dict,
    drift_threshold_pct: float = 1.5,
) -> pd.DataFrame:
    """
    Compares a client's current holdings against the target model portfolio
    and produces the trade list needed to rebalance — this is what feeds
    into Recommendation rows. Only flags trades where drift exceeds
    `drift_threshold_pct` to avoid generating noisy, tiny rebalance suggestions.

    current_holdings: stock_id, quantity
    prices: {stock_id: current_price}
    """
    current = current_holdings.copy()
    current["current_value"] = current.apply(lambda r: r["quantity"] * prices.get(r["stock_id"], 0), axis=1)
    current["current_weight_pct"] = (current["current_value"] / portfolio_value * 100).round(2)

    merged = model_portfolio.merge(
        current[["stock_id", "current_weight_pct", "quantity"]],
        on="stock_id", how="outer"
    ).fillna({"target_weight_pct": 0, "current_weight_pct": 0, "quantity": 0})

    merged["weight_drift_pct"] = merged["target_weight_pct"] - merged["current_weight_pct"]
    actionable = merged[merged["weight_drift_pct"].abs() >= drift_threshold_pct].copy()

    actionable["action"] = actionable["weight_drift_pct"].apply(lambda x: "BUY" if x > 0 else "SELL")
    actionable["suggested_value_change"] = (actionable["weight_drift_pct"].abs() / 100) * portfolio_value
    actionable["suggested_quantity"] = actionable.apply(
        lambda r: r["suggested_value_change"] / prices.get(r["stock_id"], 1)
        if prices.get(r["stock_id"], 0) > 0 else 0,
        axis=1,
    )

    return actionable.sort_values("weight_drift_pct", key=abs, ascending=False)
