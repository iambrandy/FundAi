"""
Low Volatility Factor
=====================
Captures the "low volatility anomaly" — empirically, lower-risk stocks
have historically delivered higher risk-adjusted returns than high-beta stocks.

This is counterintuitive (contradicts CAPM) but robust across markets and
time periods. Multiple explanations:
- Leverage constraints force investors into high-beta stocks
- Lottery preference (retail loves volatile stocks)
- Agency problems (fund managers prefer exciting stocks for marketing)

Methodology:
- Realized volatility (standard deviation of returns)
- Downside deviation (semi-variance, only negative returns)
- Beta to market index (Nifty 50)
- Maximum drawdown over lookback period

Lower volatility = Higher score (defensive positioning)
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from typing import Optional


def compute_realized_volatility(
    prices: pd.Series,
    window_days: int = 252,
    annualize: bool = True,
) -> float:
    """
    Standard deviation of daily returns.
    
    Args:
        prices: Series of daily close prices, sorted chronologically
        window_days: Lookback window (252 = 1 year of trading days)
        annualize: If True, multiply by sqrt(252) to annualize
    
    Returns:
        Realized volatility as decimal (e.g., 0.25 = 25% annual vol)
    """
    if len(prices) < 2:
        return np.nan
    
    returns = prices.pct_change().dropna()
    recent_returns = returns.iloc[-window_days:] if len(returns) > window_days else returns
    
    if len(recent_returns) < 20:  # Minimum data requirement
        return np.nan
    
    vol = recent_returns.std(ddof=1)
    
    if annualize:
        vol *= np.sqrt(252)
    
    return vol


def compute_downside_deviation(
    prices: pd.Series,
    window_days: int = 252,
    mar: float = 0.0,  # Minimum acceptable return (0 = focus on negative returns)
    annualize: bool = True,
) -> float:
    """
    Semi-variance: volatility of returns below a threshold (MAR).
    Penalizes downside risk more than upside volatility.
    
    Used by sophisticated investors (Sortino ratio uses this).
    """
    if len(prices) < 2:
        return np.nan
    
    returns = prices.pct_change().dropna()
    recent_returns = returns.iloc[-window_days:] if len(returns) > window_days else returns
    
    if len(recent_returns) < 20:
        return np.nan
    
    # Only consider returns below MAR (typically 0)
    downside_returns = recent_returns[recent_returns < mar]
    
    if len(downside_returns) == 0:
        return 0.0  # No downside at all = best case
    
    downside_dev = np.sqrt((downside_returns ** 2).mean())
    
    if annualize:
        downside_dev *= np.sqrt(252)
    
    return downside_dev


def compute_beta_to_index(
    stock_prices: pd.Series,
    index_prices: pd.Series,
    window_days: int = 252,
) -> float:
    """
    Beta = Cov(stock, index) / Var(index)
    
    Beta < 1 = defensive (moves less than market)
    Beta > 1 = aggressive (amplifies market moves)
    
    Low vol factor prefers beta < 1 stocks.
    """
    if len(stock_prices) < 2 or len(index_prices) < 2:
        return np.nan
    
    # Align dates
    df = pd.DataFrame({
        'stock': stock_prices,
        'index': index_prices,
    }).dropna()
    
    if len(df) < 60:  # Need at least 3 months of data
        return np.nan
    
    df = df.iloc[-window_days:] if len(df) > window_days else df
    
    stock_returns = df['stock'].pct_change().dropna()
    index_returns = df['index'].pct_change().dropna()
    
    # Align after pct_change (removes one row)
    aligned = pd.DataFrame({
        'stock': stock_returns,
        'index': index_returns,
    }).dropna()
    
    if len(aligned) < 60:
        return np.nan
    
    covariance = aligned['stock'].cov(aligned['index'])
    index_variance = aligned['index'].var(ddof=1)
    
    if index_variance == 0 or np.isnan(index_variance):
        return np.nan
    
    return covariance / index_variance


def compute_max_drawdown(
    prices: pd.Series,
    window_days: int = 252,
) -> float:
    """
    Maximum peak-to-trough decline over the lookback period.
    
    Returns positive number (e.g., 0.25 = 25% max drawdown).
    Lower drawdown = more defensive = higher low vol score.
    """
    if len(prices) < 2:
        return np.nan
    
    recent_prices = prices.iloc[-window_days:] if len(prices) > window_days else prices
    
    if len(recent_prices) < 20:
        return np.nan
    
    running_max = recent_prices.expanding().max()
    drawdown = (recent_prices - running_max) / running_max
    max_dd = drawdown.min()
    
    return abs(max_dd)  # Return as positive number


def compute_low_volatility_metrics(
    stock_prices: pd.DataFrame,
    index_prices: Optional[pd.Series] = None,
    window_days: int = 252,
) -> pd.DataFrame:
    """
    Compute all low volatility sub-metrics for a universe of stocks.
    
    Args:
        stock_prices: DataFrame with columns = stock_ids, index = dates, values = close prices
        index_prices: Series with index = dates, values = index close (e.g., Nifty 50)
                     If None, beta will be NaN
        window_days: Lookback period (252 = 1 year)
    
    Returns:
        DataFrame with columns: stock_id, realized_vol, downside_dev, beta, max_drawdown
    """
    results = []
    
    for stock_id in stock_prices.columns:
        stock_series = stock_prices[stock_id].dropna()
        
        realized_vol = compute_realized_volatility(stock_series, window_days)
        downside_dev = compute_downside_deviation(stock_series, window_days)
        max_dd = compute_max_drawdown(stock_series, window_days)
        
        beta = np.nan
        if index_prices is not None:
            beta = compute_beta_to_index(stock_series, index_prices, window_days)
        
        results.append({
            'stock_id': stock_id,
            'realized_vol': realized_vol,
            'downside_dev': downside_dev,
            'beta': beta,
            'max_drawdown': max_dd,
        })
    
    return pd.DataFrame(results)


def score_low_volatility(
    metrics_df: pd.DataFrame,
    weights: dict = None,
) -> pd.Series:
    """
    Combine low volatility sub-metrics into a single score.
    
    Lower volatility/beta/drawdown → Higher score (we invert them)
    
    Args:
        metrics_df: Output from compute_low_volatility_metrics
        weights: Dict with keys: realized_vol, downside_dev, beta, max_drawdown
                Default: equal weight 0.25 each
    
    Returns:
        Series of raw low volatility scores (pre-normalization)
    """
    if weights is None:
        weights = {
            'realized_vol': 0.25,
            'downside_dev': 0.30,  # Slightly overweight downside (most important)
            'beta': 0.20,
            'max_drawdown': 0.25,
        }
    
    df = metrics_df.copy()
    
    # Invert metrics so lower risk = higher score
    # Use 1/(1+x) transformation to avoid infinity at zero
    df['realized_vol_inv'] = 1 / (1 + df['realized_vol'].fillna(df['realized_vol'].median()))
    df['downside_dev_inv'] = 1 / (1 + df['downside_dev'].fillna(df['downside_dev'].median()))
    df['beta_inv'] = 1 / (1 + df['beta'].fillna(1.0).clip(lower=0))  # Clip negative betas to 0
    df['max_drawdown_inv'] = 1 / (1 + df['max_drawdown'].fillna(df['max_drawdown'].median()))
    
    # Weighted combination
    score = (
        weights['realized_vol'] * df['realized_vol_inv'] +
        weights['downside_dev'] * df['downside_dev_inv'] +
        weights['beta'] * df['beta_inv'] +
        weights['max_drawdown'] * df['max_drawdown_inv']
    )
    
    return score
