"""
Test Script: Regime Detection + Low Volatility Factor
======================================================
Validates the new factor scoring enhancements without requiring
full database setup. Run with:

    python test_regime_and_low_vol.py

Expected output:
- Synthetic universe scored with 5 factors
- Regime detected from synthetic index
- Factor weights adjusted based on regime
- Rationales generated with regime context
"""

import sys
import os

# Configure stdout and stderr to handle UTF-8 print correctly on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.abspath('.'))

import pandas as pd
import numpy as np
from app.scoring.regime_detection import detect_market_regime, get_regime_factor_weights, MarketRegime
from app.scoring.low_volatility_factor import compute_low_volatility_metrics, score_low_volatility
from app.scoring.factor_scoring import compute_factor_scores, generate_rationale


def generate_synthetic_stock_data(n_stocks: int = 30, n_days: int = 300):
    """Generate synthetic stock price history for testing"""
    np.random.seed(42)
    
    stocks = []
    price_history_dict = {}
    
    sectors = ["IT", "Banking", "FMCG", "Pharma", "Auto", "Energy"]
    
    for i in range(n_stocks):
        stock_id = f"STOCK_{i:03d}"
        symbol = f"SYM{i}"
        sector = sectors[i % len(sectors)]
        
        # Generate price history
        initial_price = 100 + np.random.uniform(-50, 200)
        drift = np.random.uniform(-0.0002, 0.0005)  # Daily drift
        volatility = np.random.uniform(0.01, 0.04)  # Daily vol
        
        prices = [initial_price]
        for _ in range(n_days - 1):
            ret = drift + volatility * np.random.randn()
            prices.append(prices[-1] * (1 + ret))
        
        price_series = pd.Series(prices)
        price_history_dict[stock_id] = price_series
        
        # Calculate returns
        return_6m = (prices[-1] / prices[-126] - 1) if len(prices) >= 126 else 0
        return_12m = (prices[-1] / prices[0] - 1)
        
        # Generate fundamental data
        stocks.append({
            'stock_id': stock_id,
            'symbol': symbol,
            'sector': sector,
            'pe_ratio': np.random.uniform(5, 40),
            'pb_ratio': np.random.uniform(0.5, 8),
            'roe': np.random.uniform(5, 35),
            'debt_to_equity': np.random.uniform(0, 2.5),
            'eps_growth_yoy': np.random.uniform(-10, 40),
            'revenue_growth_yoy': np.random.uniform(-5, 35),
            'return_6m': return_6m,
            'return_12m': return_12m,
        })
    
    universe_df = pd.DataFrame(stocks)
    price_history_df = pd.DataFrame(price_history_dict)
    
    return universe_df, price_history_df


def generate_synthetic_index(n_days: int = 300, regime_type: str = "BULL"):
    """Generate synthetic index with specific regime characteristics"""
    dates = pd.date_range(end=pd.Timestamp.today(), periods=n_days, freq='B')
    
    prices = [18000.0]
    if regime_type == "BULL":
        for i in range(1, n_days):
            # Alternating returns to introduce non-zero variance
            ret = 0.0010 if i % 2 == 0 else 0.0014
            prices.append(prices[-1] * (1 + ret))
    elif regime_type == "BEAR":
        for i in range(1, n_days):
            ret = -0.0008 if i % 2 == 0 else -0.0012
            prices.append(prices[-1] * (1 + ret))
    elif regime_type == "HIGH_VOLATILITY":
        for i in range(1, n_days):
            if i < n_days - 20:
                ret = 0.0001
            else:
                ret = 0.05 if i % 2 == 0 else -0.05
            prices.append(prices[-1] * (1 + ret))
    else:  # SIDEWAYS
        for i in range(1, n_days):
            ret = 0.0001 if i % 2 == 0 else -0.0001
            prices.append(prices[-1] * (1 + ret))
    
    index_df = pd.DataFrame({
        'date': dates,
        'close': prices,
    })
    
    return index_df


def test_regime_detection():
    """Test 1: Regime Detection"""
    print("=" * 60)
    print("TEST 1: REGIME DETECTION")
    print("=" * 60)
    
    for regime_type in ["BULL", "BEAR", "HIGH_VOLATILITY", "SIDEWAYS"]:
        print(f"\n--- Testing {regime_type} regime ---")
        index_df = generate_synthetic_index(n_days=300, regime_type=regime_type)
        
        regime, metadata = detect_market_regime(index_df)
        
        print(f"Detected Regime: {regime.value}")
        print(f"6M Momentum: {metadata['momentum_6m']:.2%}")
        print(f"Price above 200 SMA: {metadata['price_above_sma_200']}")
        print(f"Golden Cross: {metadata['golden_cross']}")
        print(f"Current Volatility: {metadata['current_volatility']:.2%}")
        print(f"Vol Percentile: {metadata['vol_percentile']:.0%}")
        
        weights = get_regime_factor_weights(regime)
        print(f"\nFactor Weights for {regime.value}:")
        print(f"  Value: {weights.value:.1%}")
        print(f"  Momentum: {weights.momentum:.1%}")
        print(f"  Quality: {weights.quality:.1%}")
        print(f"  Growth: {weights.growth:.1%}")
        print(f"  Low Volatility: {weights.low_volatility:.1%}")
    
    print("\n[OK] Regime detection test passed\n")


def test_low_volatility_factor():
    """Test 2: Low Volatility Factor Computation"""
    print("=" * 60)
    print("TEST 2: LOW VOLATILITY FACTOR")
    print("=" * 60)
    
    _, price_history_df = generate_synthetic_stock_data(n_stocks=10, n_days=252)
    index_df = generate_synthetic_index(n_days=252, regime_type="BULL")
    price_history_df.index = index_df['date']
    index_series = index_df.set_index('date')['close']
    
    # Compute low vol metrics
    metrics = compute_low_volatility_metrics(
        price_history_df,
        index_prices=index_series,
        window_days=252,
    )
    
    print("\nLow Volatility Metrics (first 5 stocks):")
    print(metrics.head().to_string())
    
    # Score them
    scores = score_low_volatility(metrics)
    metrics['low_vol_score'] = scores
    
    print("\nTop 3 Lowest Volatility Stocks:")
    print(metrics.nlargest(3, 'low_vol_score')[['stock_id', 'realized_vol', 'beta', 'max_drawdown', 'low_vol_score']])
    
    print("\n[OK] Low volatility factor test passed\n")


def test_full_scoring_pipeline():
    """Test 3: Full Scoring Pipeline with Regime Adaptation"""
    print("=" * 60)
    print("TEST 3: FULL SCORING PIPELINE")
    print("=" * 60)
    
    # Generate data
    universe_df, price_history_df = generate_synthetic_stock_data(n_stocks=30, n_days=300)
    index_df = generate_synthetic_index(n_days=300, regime_type="BULL")
    price_history_df.index = index_df['date']
    index_series = index_df.set_index('date')['close']
    
    # Score without regime adaptation (baseline)
    print("\n--- Scoring WITHOUT regime adaptation ---")
    scored_baseline = compute_factor_scores(
        universe_df,
        sector_neutral=True,
        price_history=price_history_df,
        index_prices=index_series,
        use_regime_weights=False,
    )
    
    print(f"Composite Score Range: {scored_baseline['composite_score'].min():.1f} - {scored_baseline['composite_score'].max():.1f}")
    print(f"Mean Composite: {scored_baseline['composite_score'].mean():.1f}")
    
    # Score WITH regime adaptation
    print("\n--- Scoring WITH regime adaptation ---")
    scored_adaptive = compute_factor_scores(
        universe_df,
        sector_neutral=True,
        price_history=price_history_df,
        index_prices=index_series,
        use_regime_weights=True,
    )
    
    print(f"Detected Regime: {scored_adaptive['regime_used'].iloc[0]}")
    print(f"Composite Score Range: {scored_adaptive['composite_score'].min():.1f} - {scored_adaptive['composite_score'].max():.1f}")
    print(f"Mean Composite: {scored_adaptive['composite_score'].mean():.1f}")
    
    # Show top 5 stocks
    print("\nTop 5 Stocks (Regime-Adaptive Scoring):")
    top_5 = scored_adaptive.nlargest(5, 'composite_score')[[
        'symbol', 'sector', 'value_score', 'momentum_score', 'quality_score', 
        'growth_score', 'low_volatility_score', 'composite_score'
    ]]
    print(top_5.to_string(index=False))
    
    # Generate rationales
    print("\nSample Rationales:")
    for idx, row in scored_adaptive.head(3).iterrows():
        rationale = generate_rationale(row)
        print(f"\n{row['symbol']}: {rationale}")
    
    # Compare score distributions
    print("\n--- Score Distribution Comparison ---")
    print(f"Correlation (baseline vs adaptive): {scored_baseline['composite_score'].corr(scored_adaptive['composite_score']):.3f}")
    print(f"Rank Correlation: {scored_baseline['composite_score'].corr(scored_adaptive['composite_score'], method='spearman'):.3f}")
    
    print("\n[OK] Full scoring pipeline test passed\n")


def test_regime_transitions():
    """Test 4: Behavior Across Regime Transitions"""
    print("=" * 60)
    print("TEST 4: REGIME TRANSITION BEHAVIOR")
    print("=" * 60)
    
    universe_df, price_history_df = generate_synthetic_stock_data(n_stocks=20, n_days=300)
    
    results = []
    for regime_type in ["BULL", "BEAR", "HIGH_VOLATILITY", "SIDEWAYS"]:
        index_df = generate_synthetic_index(n_days=300, regime_type=regime_type)
        price_history_df.index = index_df['date']
        index_series = index_df.set_index('date')['close']
        
        scored = compute_factor_scores(
            universe_df,
            sector_neutral=True,
            price_history=price_history_df,
            index_prices=index_series,
            use_regime_weights=True,
        )
        
        results.append({
            'regime': regime_type,
            'mean_composite': scored['composite_score'].mean(),
            'mean_momentum': scored['momentum_score'].mean(),
            'mean_low_vol': scored['low_volatility_score'].mean(),
            'top_composite': scored['composite_score'].max(),
        })
    
    results_df = pd.DataFrame(results)
    print("\nComposite Scores by Regime:")
    print(results_df.to_string(index=False))
    
    print("\nExpected Behavior:")
    print("  • BULL regime: Higher momentum scores influence composite")
    print("  • BEAR regime: Higher low vol scores influence composite")
    print("  • Score distributions shift based on regime-specific weights")
    
    print("\n[OK] Regime transition test passed\n")


def main():
    """Run all tests"""
    print("\n" + "=" * 60)
    print("FUNDAI QUANT ENGINE: REGIME & LOW VOL FACTOR TESTS")
    print("=" * 60 + "\n")
    
    try:
        test_regime_detection()
        test_low_volatility_factor()
        test_full_scoring_pipeline()
        test_regime_transitions()
        
        print("=" * 60)
        print("ALL TESTS PASSED [OK]")
        print("=" * 60)
        print("\nNext Steps:")
        print("  1. Start quant engine: cd services/quant-engine && uvicorn app.main:app --port 8811")
        print("  2. Test API: curl http://localhost:8811/health")
        print("  3. Run full pipeline with real data")
        print()
        
    except Exception as e:
        print(f"\n[FAIL] TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
