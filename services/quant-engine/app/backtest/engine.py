"""
Backtesting Engine
===================
Simulates a model portfolio's historical performance under periodic rebalancing,
and computes the standard risk/return metrics fund managers actually report.

Design notes:
- Rebalances on a fixed schedule (default monthly) using factor scores that
  were ACTUALLY available as of that date — never leak future data into past
  decisions (no lookahead bias). Caller must supply point-in-time scored
  universes per rebalance date.
- Includes transaction cost drag, because ignoring costs is the #1 way
  backtests lie.
- Computes CAGR, volatility, Sharpe ratio, max drawdown, and XIRR-style
  metrics — the numbers that go into BacktestResult in the DB schema.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from dataclasses import dataclass


@dataclass
class BacktestConfig:
    initial_capital: float = 1_000_000.0
    transaction_cost_bps: float = 20.0  # 0.20% per trade, realistic for Indian equity incl. brokerage+STT+slippage
    risk_free_rate_annual: float = 0.065  # ~ Indian T-bill / repo rate ballpark; override with live data


def run_backtest(
    rebalance_dates: list[pd.Timestamp],
    target_weights_by_date: dict,   # {date: DataFrame[stock_id, target_weight_pct]}
    price_panel: pd.DataFrame,      # index=date, columns=stock_id, values=close price
    config: BacktestConfig = None,
) -> dict:
    """
    Returns a dict with:
        nav_series: pd.Series indexed by date
        metrics: dict of CAGR, volatility, sharpe, max_drawdown
        trade_log: list of rebalance events with turnover and cost
    """
    cfg = config or BacktestConfig()
    all_dates = price_panel.index.sort_values()
    nav = pd.Series(index=all_dates, dtype=float)

    cash = cfg.initial_capital
    holdings_qty = {}  # stock_id -> qty
    trade_log = []

    rebalance_set = set(rebalance_dates)

    for date in all_dates:
        prices_today = price_panel.loc[date]

        if date in rebalance_set and date in target_weights_by_date:
            portfolio_value = cash + sum(
                qty * prices_today.get(sid, 0) for sid, qty in holdings_qty.items()
            )
            targets = target_weights_by_date[date]
            turnover = 0.0
            new_holdings = {}

            for _, row in targets.iterrows():
                sid = row["stock_id"]
                price = prices_today.get(sid, np.nan)
                if pd.isna(price) or price <= 0:
                    continue  # delisted / no data that day — skip, don't crash the backtest
                target_value = portfolio_value * (row["target_weight_pct"] / 100)
                target_qty = target_value / price
                prev_qty = holdings_qty.get(sid, 0)
                turnover += abs(target_qty - prev_qty) * price
                new_holdings[sid] = target_qty

            cost = turnover * (cfg.transaction_cost_bps / 10_000)
            spent = sum(
                (new_holdings.get(sid, 0) - holdings_qty.get(sid, 0)) * prices_today.get(sid, 0)
                for sid in set(list(new_holdings.keys()) + list(holdings_qty.keys()))
            )
            cash = cash - spent - cost
            holdings_qty = new_holdings

            trade_log.append({
                "date": date, "turnover": turnover, "cost": cost,
                "portfolio_value_pre_rebalance": portfolio_value,
            })

        nav[date] = cash + sum(
            qty * prices_today.get(sid, 0) for sid, qty in holdings_qty.items()
        )

    metrics = _compute_metrics(nav, cfg.risk_free_rate_annual)
    return {"nav_series": nav, "metrics": metrics, "trade_log": trade_log}


def _compute_metrics(nav: pd.Series, risk_free_rate_annual: float) -> dict:
    nav = nav.dropna()
    if len(nav) < 2:
        return {"error": "insufficient data"}

    daily_returns = nav.pct_change().dropna()
    n_days = len(nav)
    years = n_days / 252.0

    total_return = nav.iloc[-1] / nav.iloc[0] - 1
    cagr = (nav.iloc[-1] / nav.iloc[0]) ** (1 / years) - 1 if years > 0 else np.nan

    volatility_annual = daily_returns.std(ddof=0) * np.sqrt(252)

    rf_daily = (1 + risk_free_rate_annual) ** (1 / 252) - 1
    excess_returns = daily_returns - rf_daily
    sharpe = (
        (excess_returns.mean() / excess_returns.std(ddof=0)) * np.sqrt(252)
        if excess_returns.std(ddof=0) > 0 else np.nan
    )

    running_max = nav.cummax()
    drawdown = (nav - running_max) / running_max
    max_drawdown = drawdown.min()

    return {
        "total_return_pct": round(total_return * 100, 2),
        "cagr_pct": round(cagr * 100, 2) if not np.isnan(cagr) else None,
        "volatility_annual_pct": round(volatility_annual * 100, 2),
        "sharpe_ratio": round(sharpe, 2) if not np.isnan(sharpe) else None,
        "max_drawdown_pct": round(max_drawdown * 100, 2),
        "period_years": round(years, 2),
    }
