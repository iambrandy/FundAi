"""
Complete Workflow Demo: Regime Detection + Factor Scoring
===========================================================
Demonstrates the full FundAI v0.2.0 workflow from market data to recommendations.

This script:
1. Downloads real Nifty 50 + stock data
2. Detects current market regime
3. Scores stocks with 5 factors
4. Constructs optimal portfolio
5. Generates recommendations with regime context

Run with: python demo_complete_workflow.py
"""

import sys
import os
sys.path.insert(0, os.path.abspath('.'))

import pandas as pd
import numpy as np
from datetime import datetime, timedelta

from app.data.market_data_fetcher import MarketDataFetcher, download_nifty_historical
from app.scoring.regime_detection import detect_market_regime, get_regime_factor_weights
from app.scoring.factor_scoring import compute_factor_scores, generate_rationale
from app.portfolio.construction import construct_model_portfolio


def print_header(title):
    """Pretty print section headers"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70 + "\n")


def demo_step_1_download_data():
    """Step 1: Download market data"""
    print_header("STEP 1: Download Market Data")
    
    fetcher = MarketDataFetcher(source="yahoo")
    
    # Download Nifty 50 (last 3 years)
    print("Downloading Nifty 50 historical data (3 years)...")
    nifty_data = download_nifty_historical(years=3)
    print(f"✓ Downloaded {len(nifty_data)} days of Nifty 50 data")
    print(f"  Date range: {nifty_data['date'].iloc[0]} to {nifty_data['date'].iloc[-1]}")
    print(f"  Current level: {nifty_data['close'].iloc[-1]:.2f}")
    
    # Download sample stocks (top 10 by market cap for demo speed)
    sample_stocks = [
        "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
        "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    ]
    
    print(f"\nDownloading {len(sample_stocks)} sample stocks (3 years)...")
    start_date = (datetime.now() - timedelta(days=365*3)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")
    
    stock_data = {}
    for symbol in sample_stocks:
        try:
            df = fetcher.get_stock_history(symbol, start_date, end_date)
            stock_id = symbol.replace(".NS", "")
            stock_data[stock_id] = df
            print(f"  ✓ {stock_id}: {len(df)} days")
        except Exception as e:
            print(f"  ✗ {symbol}: {e}")
    
    print(f"\n✓ Downloaded {len(stock_data)} stocks successfully")
    
    return nifty_data, stock_data


def demo_step_2_detect_regime(nifty_data):
    """Step 2: Detect current market regime"""
    print_header("STEP 2: Detect Market Regime")
    
    # Prepare data for regime detection
    index_df = nifty_data.copy()
    index_df['date'] = pd.to_datetime(index_df['date'])
    
    # Detect regime
    print("Analyzing market regime from Nifty 50 price action...")
    regime, metadata = detect_market_regime(index_df)
    
    print(f"\n🎯 DETECTED REGIME: {regime.value}")
    print("\nRegime Indicators:")
    print(f"  • 6-Month Return: {metadata['momentum_6m']:+.1%}")
    print(f"  • Price above 200 SMA: {'Yes' if metadata['price_above_sma_200'] else 'No'}")
    print(f"  • Golden Cross (50>200): {'Yes' if metadata['golden_cross'] else 'No'}")
    print(f"  • Current Volatility: {metadata['current_volatility']:.1%}")
    print(f"  • Volatility Percentile: {metadata['vol_percentile']:.0%}")
    print(f"  • High Volatility Warning: {'YES' if metadata['is_high_vol'] else 'No'}")
    
    # Get optimal weights for this regime
    weights = get_regime_factor_weights(regime)
    print(f"\nOptimal Factor Weights for {regime.value}:")
    print(f"  • Value:          {weights.value:.0%}")
    print(f"  • Momentum:       {weights.momentum:.0%}")
    print(f"  • Quality:        {weights.quality:.0%}")
    print(f"  • Growth:         {weights.growth:.0%}")
    print(f"  • Low Volatility: {weights.low_volatility:.0%}")
    
    regime_interpretation = {
        "BULL": "📈 Strong uptrend - Favor momentum and growth stocks",
        "BEAR": "📉 Downtrend - Favor quality, low volatility, and value",
        "HIGH_VOLATILITY": "⚠️  Uncertain market - Emphasize quality and defensive positioning",
        "SIDEWAYS": "➡️  Range-bound - Favor value and quality",
    }
    print(f"\n💡 Interpretation: {regime_interpretation[regime.value]}")
    
    return regime, metadata, index_df


def demo_step_3_score_stocks(stock_data, nifty_data, regime):
    """Step 3: Score stocks with 5 factors"""
    print_header("STEP 3: Score Stocks with 5 Factors")
    
    print("Building scoring universe...")
    
    # Build universe DataFrame
    universe_rows = []
    price_history_dict = {}
    
    sectors = {
        "RELIANCE": "Energy", "TCS": "IT", "HDFCBANK": "Banking",
        "INFY": "IT", "ICICIBANK": "Banking", "HINDUNILVR": "FMCG",
        "ITC": "FMCG", "SBIN": "Banking", "BHARTIARTL": "Telecom",
        "KOTAKBANK": "Banking",
    }
    
    for stock_id, df in stock_data.items():
        if len(df) < 60:
            continue
        
        # Calculate returns
        prices = df['close'].values
        return_6m = (prices[-1] / prices[-126] - 1) if len(prices) >= 126 else 0
        return_12m = (prices[-1] / prices[0] - 1) if len(prices) >= 252 else 0
        
        # Generate synthetic fundamentals (in production, pull from database)
        universe_rows.append({
            'stock_id': stock_id,
            'symbol': stock_id,
            'sector': sectors.get(stock_id, "Other"),
            'pe_ratio': np.random.uniform(10, 35),
            'pb_ratio': np.random.uniform(1, 6),
            'roe': np.random.uniform(10, 30),
            'debt_to_equity': np.random.uniform(0, 1.5),
            'eps_growth_yoy': np.random.uniform(5, 25),
            'revenue_growth_yoy': np.random.uniform(5, 20),
            'return_6m': return_6m,
            'return_12m': return_12m,
        })
        
        # Store price history
        price_history_dict[stock_id] = df.set_index('date')['close']
    
    universe_df = pd.DataFrame(universe_rows)
    price_history_df = pd.DataFrame(price_history_dict)
    
    print(f"✓ Universe: {len(universe_df)} stocks")
    print(f"✓ Price history: {len(price_history_df)} days")
    
    # Prepare index prices
    nifty_series = nifty_data.set_index('date')['close']
    
    # Score with regime adaptation
    print(f"\nScoring stocks (regime-adaptive: {regime.value})...")
    scored = compute_factor_scores(
        universe_df,
        sector_neutral=True,
        price_history=price_history_df,
        index_prices=nifty_series,
        regime=regime,
        use_regime_weights=True,
    )
    
    # Generate rationales
    scored['rationale'] = scored.apply(generate_rationale, axis=1)
    
    print("\n✓ Scoring complete!")
    print("\nTop 5 Stocks by Composite Score:")
    print("-" * 70)
    
    top_5 = scored.nlargest(5, 'composite_score')
    for idx, row in top_5.iterrows():
        print(f"\n{row['symbol']} - Composite Score: {row['composite_score']:.1f}/100")
        print(f"  Sector: {row['sector']}")
        print(f"  Factor Scores:")
        print(f"    • Value:          {row['value_score']:.1f}")
        print(f"    • Momentum:       {row['momentum_score']:.1f}")
        print(f"    • Quality:        {row['quality_score']:.1f}")
        print(f"    • Growth:         {row['growth_score']:.1f}")
        print(f"    • Low Volatility: {row['low_volatility_score']:.1f}")
        print(f"  Rationale: {row['rationale'][:200]}...")
    
    return scored


def demo_step_4_construct_portfolio(scored):
    """Step 4: Construct optimal portfolio"""
    print_header("STEP 4: Construct Model Portfolio")
    
    print("Applying portfolio construction constraints...")
    print("  • Max position weight: 8%")
    print("  • Max sector weight: 25%")
    print("  • Min positions: 5")
    print("  • Max positions: 10")
    print("  • Min composite score: 60")
    
    from app.portfolio.construction import ConstructionConstraints
    
    constraints = ConstructionConstraints(
        max_position_weight_pct=8.0,
        max_sector_weight_pct=25.0,
        min_positions=5,
        max_positions=10,
        min_composite_score=60.0,
    )
    
    portfolio = construct_model_portfolio(scored, constraints)
    
    print(f"\n✓ Portfolio constructed with {len(portfolio)} positions")
    print("\nPortfolio Allocation:")
    print("-" * 70)
    
    total_weight = portfolio['target_weight_pct'].sum()
    
    for idx, row in portfolio.iterrows():
        print(f"{row['symbol']:12s} ({row['sector']:10s}) "
              f"- {row['target_weight_pct']:5.2f}% "
              f"(Score: {row['composite_score']:5.1f})")
    
    print("-" * 70)
    print(f"{'TOTAL':12s} {'':<13s} - {total_weight:5.2f}%")
    
    # Sector exposure
    print("\nSector Exposure:")
    sector_weights = portfolio.groupby('sector')['target_weight_pct'].sum().sort_values(ascending=False)
    for sector, weight in sector_weights.items():
        print(f"  {sector:12s}: {weight:5.2f}%")
    
    return portfolio


def demo_step_5_generate_recommendations(portfolio, scored):
    """Step 5: Generate investment recommendations"""
    print_header("STEP 5: Generate Recommendations")
    
    print("Creating actionable recommendations for advisors/clients...\n")
    
    for idx, row in portfolio.iterrows():
        stock_data = scored[scored['symbol'] == row['symbol']].iloc[0]
        
        print(f"┌─ RECOMMENDATION #{idx + 1} " + "─" * 50)
        print(f"│ Stock: {row['symbol']}")
        print(f"│ Action: BUY")
        print(f"│ Target Weight: {row['target_weight_pct']:.2f}%")
        print(f"│ Composite Score: {row['composite_score']:.1f}/100")
        print(f"│")
        print(f"│ Factor Breakdown:")
        print(f"│   Value:          {stock_data['value_score']:.1f}/100")
        print(f"│   Momentum:       {stock_data['momentum_score']:.1f}/100")
        print(f"│   Quality:        {stock_data['quality_score']:.1f}/100")
        print(f"│   Growth:         {stock_data['growth_score']:.1f}/100")
        print(f"│   Low Volatility: {stock_data['low_volatility_score']:.1f}/100")
        print(f"│")
        print(f"│ Rationale:")
        print(f"│   {stock_data['rationale']}")
        print(f"└" + "─" * 68 + "\n")


def main():
    """Run complete demo workflow"""
    print("\n" + "=" * 70)
    print("  FUNDAI v0.2.0 - COMPLETE WORKFLOW DEMO")
    print("  Regime Detection + Low Volatility Factor")
    print("=" * 70)
    
    print("\nThis demo will:")
    print("  1. Download real market data from Yahoo Finance")
    print("  2. Detect current market regime from Nifty 50")
    print("  3. Score stocks with 5 factors (regime-adaptive)")
    print("  4. Construct optimal portfolio with constraints")
    print("  5. Generate investment recommendations")
    
    input("\nPress Enter to start (requires internet connection)...")
    
    try:
        # Step 1: Download data
        nifty_data, stock_data = demo_step_1_download_data()
        
        # Step 2: Detect regime
        regime, metadata, index_df = demo_step_2_detect_regime(nifty_data)
        
        # Step 3: Score stocks
        scored = demo_step_3_score_stocks(stock_data, nifty_data, regime)
        
        # Step 4: Construct portfolio
        portfolio = demo_step_4_construct_portfolio(scored)
        
        # Step 5: Generate recommendations
        demo_step_5_generate_recommendations(portfolio, scored)
        
        # Summary
        print_header("DEMO COMPLETE ✓")
        print("You've seen the full FundAI v0.2.0 workflow:")
        print("  ✓ Real market data integration")
        print("  ✓ Regime detection with transparency")
        print("  ✓ 5-factor scoring with regime adaptation")
        print("  ✓ Portfolio construction with constraints")
        print("  ✓ Actionable recommendations with rationales")
        
        print("\nNext Steps:")
        print("  1. Review the generated recommendations above")
        print("  2. Run full backtest: python -m app.backtest.regime_backtest --years 5")
        print("  3. Integrate with API/Worker for production use")
        print("  4. Build frontend dashboard to display regime + recommendations")
        
        print("\n" + "=" * 70)
        print("  Thank you for using FundAI!")
        print("=" * 70 + "\n")
        
    except KeyboardInterrupt:
        print("\n\nDemo interrupted by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Demo failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
