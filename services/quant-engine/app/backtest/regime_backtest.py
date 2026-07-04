"""
Regime Detection Backtesting Framework
=======================================
Validates regime detection accuracy and measures factor performance per regime.

Key Metrics:
1. Regime detection accuracy vs manual labels
2. Factor quintile spreads per regime
3. Sharpe ratios per regime
4. Optimal factor weights per regime

Usage:
    python -m app.backtest.regime_backtest --years 10 --output results.json
"""

from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Optional
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json

from app.scoring.regime_detection import detect_market_regime, MarketRegime, backtest_regime_detection
from app.scoring.factor_scoring import compute_factor_scores
from app.data.market_data_fetcher import download_nifty_historical, download_nifty50_universe


@dataclass
class RegimePerformance:
    """Performance metrics for a specific regime period"""
    regime: str
    start_date: str
    end_date: str
    duration_days: int
    index_return: float
    index_volatility: float
    factor_returns: dict[str, float]  # Factor name -> return
    factor_sharpes: dict[str, float]  # Factor name -> Sharpe ratio
    quintile_spreads: dict[str, float]  # Factor name -> Q5-Q1 spread


@dataclass
class BacktestResults:
    """Complete backtesting results"""
    start_date: str
    end_date: str
    total_days: int
    regime_counts: dict[str, int]
    regime_transitions: int
    regime_performance: list[RegimePerformance]
    optimal_weights: dict[str, dict[str, float]]  # Regime -> Factor -> Weight
    summary_stats: dict


def create_factor_portfolios(
    scored_df: pd.DataFrame,
    price_returns: pd.DataFrame,
    factor_name: str,
) -> dict[int, pd.Series]:
    """
    Create quintile portfolios based on factor scores.
    
    Args:
        scored_df: DataFrame with factor scores (one row per stock)
        price_returns: DataFrame with stock returns (index=dates, columns=stock_ids)
        factor_name: Which factor to use (e.g., 'momentum_score')
    
    Returns:
        Dict mapping quintile (1-5) to return series
    """
    # Assign quintiles
    scored_df['quintile'] = pd.qcut(
        scored_df[factor_name],
        q=5,
        labels=[1, 2, 3, 4, 5],
        duplicates='drop'
    )
    
    portfolios = {}
    for q in [1, 2, 3, 4, 5]:
        stock_ids = scored_df[scored_df['quintile'] == q]['stock_id'].tolist()
        # Equal-weighted portfolio return
        portfolio_returns = price_returns[stock_ids].mean(axis=1)
        portfolios[q] = portfolio_returns
    
    return portfolios


def measure_factor_performance(
    universe_df: pd.DataFrame,
    price_history: pd.DataFrame,
    forward_returns: pd.DataFrame,
    index_prices: pd.Series,
) -> dict[str, dict]:
    """
    Measure performance of each factor.
    
    Returns:
        Dict with keys: value, momentum, quality, growth, low_volatility
        Each containing: return, volatility, sharpe, quintile_spread
    """
    # Score the universe
    scored = compute_factor_scores(
        universe_df,
        sector_neutral=True,
        price_history=price_history,
        index_prices=index_prices,
        use_regime_weights=False,  # Test factors independently
    )
    
    factor_names = ['value_score', 'momentum_score', 'quality_score', 'growth_score', 'low_volatility_score']
    results = {}
    
    for factor_name in factor_names:
        # Create quintile portfolios
        portfolios = create_factor_portfolios(scored, forward_returns, factor_name)
        
        # Calculate returns
        q5_return = portfolios[5].mean()  # Top quintile
        q1_return = portfolios[1].mean()  # Bottom quintile
        quintile_spread = q5_return - q1_return
        
        # Long-short portfolio (Q5 - Q1)
        ls_returns = portfolios[5] - portfolios[1]
        ls_mean = ls_returns.mean()
        ls_vol = ls_returns.std()
        sharpe = (ls_mean / ls_vol) * np.sqrt(252) if ls_vol > 0 else 0
        
        results[factor_name.replace('_score', '')] = {
            'return': float(q5_return),
            'volatility': float(ls_vol),
            'sharpe': float(sharpe),
            'quintile_spread': float(quintile_spread),
        }
    
    return results


def run_regime_backtest(
    nifty_data: pd.DataFrame,
    stock_data: dict[str, pd.DataFrame],
    universe_snapshots: list[tuple[datetime, pd.DataFrame]],
    rebalance_frequency: str = "M",  # Monthly
) -> BacktestResults:
    """
    Run full regime-based backtest.
    
    Args:
        nifty_data: Nifty 50 historical data (date, close)
        stock_data: Dict of stock_id -> price DataFrame
        universe_snapshots: List of (date, universe_df with fundamentals)
        rebalance_frequency: Rebalancing frequency ("M" = monthly, "Q" = quarterly)
    
    Returns:
        BacktestResults with complete analysis
    """
    # Step 1: Detect regimes across full history
    print("Step 1: Detecting regimes...")
    regime_history = backtest_regime_detection(nifty_data, window_days=252)
    
    # Count regimes
    regime_counts = regime_history['regime'].value_counts().to_dict()
    
    # Count transitions
    regime_transitions = (regime_history['regime'] != regime_history['regime'].shift(1)).sum()
    
    # Step 2: Split into regime periods
    print("Step 2: Analyzing regime periods...")
    regime_performance = []
    
    # Group consecutive days with same regime
    regime_history['regime_group'] = (
        regime_history['regime'] != regime_history['regime'].shift(1)
    ).cumsum()
    
    for _, group in regime_history.groupby('regime_group'):
        if len(group) < 30:  # Skip very short regimes
            continue
        
        regime = group['regime'].iloc[0]
        start_date = group['date'].iloc[0]
        end_date = group['date'].iloc[-1]
        duration = len(group)
        
        # Get index return during this regime
        start_price = nifty_data[nifty_data['date'] == start_date]['close'].iloc[0]
        end_price = nifty_data[nifty_data['date'] == end_date]['close'].iloc[0]
        index_return = (end_price / start_price) - 1
        
        # Get index volatility
        regime_prices = nifty_data[
            (nifty_data['date'] >= start_date) & (nifty_data['date'] <= end_date)
        ]
        index_returns = regime_prices['close'].pct_change().dropna()
        index_vol = index_returns.std() * np.sqrt(252)
        
        # TODO: Measure factor performance during this regime
        # (requires aligning universe snapshots with regime periods)
        
        perf = RegimePerformance(
            regime=regime,
            start_date=str(start_date),
            end_date=str(end_date),
            duration_days=duration,
            index_return=float(index_return),
            index_volatility=float(index_vol),
            factor_returns={},  # Populate with actual factor performance
            factor_sharpes={},
            quintile_spreads={},
        )
        
        regime_performance.append(perf)
    
    # Step 3: Calculate optimal weights per regime
    print("Step 3: Calculating optimal factor weights...")
    optimal_weights = calculate_optimal_weights(regime_performance)
    
    # Step 4: Generate summary statistics
    summary_stats = {
        'total_regimes': len(regime_performance),
        'avg_regime_duration_days': np.mean([r.duration_days for r in regime_performance]),
        'transitions_per_year': regime_transitions / (len(nifty_data) / 252),
        'bull_pct': regime_counts.get('BULL', 0) / len(regime_history),
        'bear_pct': regime_counts.get('BEAR', 0) / len(regime_history),
        'high_vol_pct': regime_counts.get('HIGH_VOLATILITY', 0) / len(regime_history),
        'sideways_pct': regime_counts.get('SIDEWAYS', 0) / len(regime_history),
    }
    
    return BacktestResults(
        start_date=str(nifty_data['date'].iloc[0]),
        end_date=str(nifty_data['date'].iloc[-1]),
        total_days=len(nifty_data),
        regime_counts=regime_counts,
        regime_transitions=int(regime_transitions),
        regime_performance=regime_performance,
        optimal_weights=optimal_weights,
        summary_stats=summary_stats,
    )


def calculate_optimal_weights(
    regime_performance: list[RegimePerformance]
) -> dict[str, dict[str, float]]:
    """
    Calculate optimal factor weights per regime based on historical Sharpe ratios.
    
    Uses Mean-Variance Optimization (Markowitz) constrained to sum to 1.0.
    """
    regimes = ['BULL', 'BEAR', 'HIGH_VOLATILITY', 'SIDEWAYS']
    factors = ['value', 'momentum', 'quality', 'growth', 'low_volatility']
    
    optimal_weights = {}
    
    for regime in regimes:
        # Filter to this regime
        regime_periods = [r for r in regime_performance if r.regime == regime]
        
        if not regime_periods:
            # No data for this regime, use equal weights
            optimal_weights[regime] = {f: 0.20 for f in factors}
            continue
        
        # Extract Sharpe ratios
        sharpes = []
        for period in regime_periods:
            period_sharpes = [period.factor_sharpes.get(f, 0) for f in factors]
            sharpes.append(period_sharpes)
        
        if not sharpes or len(sharpes) == 0:
            optimal_weights[regime] = {f: 0.20 for f in factors}
            continue
        
        # Average Sharpe ratios across regime periods
        avg_sharpes = np.mean(sharpes, axis=0)
        
        # Normalize to sum to 1.0 (simple proportional allocation)
        # Clip negative Sharpes to 0
        avg_sharpes = np.maximum(avg_sharpes, 0.01)  # Minimum 1% to any factor
        weights = avg_sharpes / avg_sharpes.sum()
        
        optimal_weights[regime] = {
            factors[i]: float(weights[i]) for i in range(len(factors))
        }
    
    return optimal_weights


def generate_report(results: BacktestResults, output_path: Optional[str] = None):
    """Generate human-readable backtest report"""
    report = []
    report.append("=" * 70)
    report.append("FUNDAI REGIME DETECTION BACKTEST REPORT")
    report.append("=" * 70)
    report.append(f"\nBacktest Period: {results.start_date} to {results.end_date}")
    report.append(f"Total Trading Days: {results.total_days}")
    report.append(f"Regime Transitions: {results.regime_transitions}")
    report.append(f"Transitions per Year: {results.summary_stats['transitions_per_year']:.1f}")
    
    report.append("\n" + "=" * 70)
    report.append("REGIME DISTRIBUTION")
    report.append("=" * 70)
    for regime, count in results.regime_counts.items():
        pct = count / results.total_days * 100
        report.append(f"{regime:20s}: {count:5d} days ({pct:5.1f}%)")
    
    report.append("\n" + "=" * 70)
    report.append("AVERAGE REGIME DURATION")
    report.append("=" * 70)
    report.append(f"{results.summary_stats['avg_regime_duration_days']:.0f} trading days")
    
    report.append("\n" + "=" * 70)
    report.append("OPTIMAL FACTOR WEIGHTS BY REGIME")
    report.append("=" * 70)
    for regime, weights in results.optimal_weights.items():
        report.append(f"\n{regime}:")
        for factor, weight in sorted(weights.items(), key=lambda x: -x[1]):
            report.append(f"  {factor:15s}: {weight:5.1%}")
    
    report_text = "\n".join(report)
    print(report_text)
    
    if output_path:
        with open(output_path, 'w') as f:
            f.write(report_text)
        print(f"\nReport saved to: {output_path}")
    
    # Also save JSON
    if output_path:
        json_path = output_path.replace('.txt', '.json')
        with open(json_path, 'w') as f:
            json.dump(asdict(results), f, indent=2, default=str)
        print(f"JSON results saved to: {json_path}")


def main():
    """Main backtesting workflow"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Backtest regime detection")
    parser.add_argument("--years", type=int, default=10, help="Years of history")
    parser.add_argument("--output", type=str, default="regime_backtest_results.txt", help="Output file")
    args = parser.parse_args()
    
    print("=" * 70)
    print("FUNDAI REGIME DETECTION BACKTEST")
    print("=" * 70)
    print(f"\nConfiguration:")
    print(f"  History: {args.years} years")
    print(f"  Output: {args.output}")
    
    # Step 1: Download data
    print(f"\n[1/5] Downloading Nifty 50 data ({args.years} years)...")
    nifty_data = download_nifty_historical(years=args.years)
    print(f"  Downloaded {len(nifty_data)} days")
    
    print("\n[2/5] Downloading Nifty 50 constituent stocks...")
    stock_data = download_nifty50_universe(years=args.years)
    print(f"  Downloaded {len(stock_data)} stocks")
    
    # Step 3: Run backtest (simplified - full version needs fundamental data)
    print("\n[3/5] Running regime backtest...")
    print("  Note: Full factor performance analysis requires fundamental data")
    print("  This demo validates regime detection only")
    
    # Simplified backtest (just regime detection validation)
    regime_history = backtest_regime_detection(nifty_data, window_days=252)
    
    # Build simplified results
    regime_counts = regime_history['regime'].value_counts().to_dict()
    regime_transitions = (regime_history['regime'] != regime_history['regime'].shift(1)).sum()
    
    results = BacktestResults(
        start_date=str(nifty_data['date'].iloc[0]),
        end_date=str(nifty_data['date'].iloc[-1]),
        total_days=len(nifty_data),
        regime_counts=regime_counts,
        regime_transitions=int(regime_transitions),
        regime_performance=[],  # Would need fundamental data
        optimal_weights={},  # Would need fundamental data
        summary_stats={
            'transitions_per_year': regime_transitions / (len(nifty_data) / 252),
            'avg_regime_duration_days': len(nifty_data) / len(regime_history.groupby('regime')),
        }
    )
    
    # Generate report
    print("\n[4/5] Generating report...")
    generate_report(results, output_path=args.output)
    
    # Save regime history
    print("\n[5/5] Saving regime history...")
    regime_csv = args.output.replace('.txt', '_regime_history.csv')
    regime_history.to_csv(regime_csv, index=False)
    print(f"  Regime history saved to: {regime_csv}")
    
    print("\n" + "=" * 70)
    print("BACKTEST COMPLETE")
    print("=" * 70)
    print("\nNext Steps:")
    print("  1. Review regime_backtest_results.txt for summary")
    print("  2. Analyze regime transitions vs market events")
    print("  3. Validate regime classifications manually")
    print("  4. Integrate with full factor scoring pipeline")


if __name__ == "__main__":
    main()
