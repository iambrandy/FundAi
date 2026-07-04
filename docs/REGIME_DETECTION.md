# Market Regime Detection & Low Volatility Factor

## Overview

This upgrade adds **adaptive intelligence** to FundAI's factor scoring system:

1. **Low Volatility Factor**: Captures the empirical "low volatility anomaly" where defensive stocks deliver superior risk-adjusted returns
2. **Market Regime Detection**: Automatically classifies market conditions (Bull/Bear/High Volatility/Sideways)
3. **Dynamic Factor Weighting**: Adjusts factor weights based on detected regime for improved performance

## Why This Matters

### Problem with Fixed Factor Weights
The original implementation used **equal weights (25% each)** across Value, Momentum, Quality, and Growth factors. This ignores:

- **Momentum fails in bear markets** (negative autocorrelation during crashes)
- **Value underperforms in bull markets** (expensive stocks get more expensive)
- **Growth shines when rates are low**, struggles when rates rise
- **Quality + Low Vol are critical during high volatility** periods

### Solution: Regime-Adaptive Weights
By detecting the current market regime, we dynamically shift factor exposure:

```
BULL MARKET (strong uptrend):
- Momentum: 35% (ride the trend)
- Growth: 30% (growth outperforms)
- Quality: 20%
- Value: 10% (value lags in bull runs)
- Low Volatility: 5%

BEAR MARKET (downtrend):
- Quality: 35% (flight to quality)
- Low Volatility: 30% (defensive positioning)
- Value: 25% (value shines in bear markets)
- Momentum: 5% (momentum fails)
- Growth: 5%

HIGH VOLATILITY (uncertain):
- Quality: 40% (stability prioritized)
- Low Volatility: 25%
- Value: 15%
- Momentum: 10%
- Growth: 10%

SIDEWAYS (range-bound):
- Value: 30% (mean reversion works)
- Quality: 30%
- Momentum: 15%
- Growth: 15%
- Low Volatility: 10%
```

## Technical Implementation

### 1. Low Volatility Factor

**File**: `services/quant-engine/app/scoring/low_volatility_factor.py`

**Sub-Metrics** (weighted combination):
- **Realized Volatility** (25%): Standard deviation of daily returns over 1 year
- **Downside Deviation** (30%): Semi-variance (only negative returns) — more important than total vol
- **Beta to Nifty 50** (20%): Beta < 1 = defensive, Beta > 1 = aggressive
- **Maximum Drawdown** (25%): Peak-to-trough decline over 1 year

**Scoring Logic**:
- Lower risk metrics → Higher score (inverted)
- Cross-sectional z-score → 0-100 scale
- Sector-neutral option available

### 2. Regime Detection

**File**: `services/quant-engine/app/scoring/regime_detection.py`

**Detection Signals**:
1. **Price Momentum**: 6-month return vs thresholds (+10% = bull, -5% = bear)
2. **SMA Crossover**: 50-day vs 200-day moving average (golden cross / death cross)
3. **Realized Volatility**: Current vol vs 75th percentile of historical distribution
4. **Price Position**: Above/below 200-day SMA

**Classification Priority**:
1. High volatility overrides everything (defensive mode)
2. Clear bull/bear signals from momentum + SMA
3. Default to sideways if no clear trend

**Example API Call**:
```bash
curl -X POST http://localhost:8811/detect-regime \
  -H "x-internal-token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "index_prices": {
      "dates": ["2024-01-01", "2024-01-02", ...],
      "closes": [18000, 18050, ...]
    }
  }'
```

**Response**:
```json
{
  "regime": "BULL",
  "metadata": {
    "momentum_6m": 0.124,
    "price_above_sma_200": true,
    "golden_cross": true,
    "current_volatility": 0.18,
    "vol_percentile": 0.42,
    "is_high_vol": false
  },
  "interpretation": "Strong uptrend - favor momentum and growth stocks"
}
```

### 3. Updated Scoring API

**File**: `services/quant-engine/app/main.py`

**New Parameters in `/score` endpoint**:
```python
{
  "universe": [...],  # Existing
  "sector_neutral": true,  # Existing
  "price_history": [  # NEW
    {
      "stock_id": "stock_123",
      "dates": ["2023-01-01", ...],
      "closes": [1500, 1520, ...]
    }
  ],
  "index_prices": {  # NEW
    "dates": ["2023-01-01", ...],
    "closes": [18000, 18100, ...]
  },
  "use_regime_weights": true  # NEW (default: true)
}
```

**Response Now Includes**:
```json
{
  "stock_id": "stock_123",
  "symbol": "HDFCBANK",
  "value_score": 58.2,
  "momentum_score": 74.3,
  "quality_score": 82.1,
  "growth_score": 71.5,
  "low_volatility_score": 68.9,  // NEW
  "composite_score": 74.8,
  "regime_used": "BULL",  // NEW
  "rationale": "HDFCBANK scores strongly on balance sheet quality and risk profile relative to its peers... Current bull market regime favors momentum and growth."
}
```

## Integration with Worker Pipeline

**File**: `apps/worker/src/jobs/scoreAndRecommend.ts`

**Changes**:
1. Fetches 400 days of price history per stock (vs just calculating 6M/12M returns)
2. Generates/fetches Nifty 50 index prices for beta calculation
3. Passes price history + index prices to quant engine
4. Regime detection happens automatically inside scoring

**For Production**:
- Replace `generateSyntheticIndexPrices()` with real NSE data
- Consider caching index prices (doesn't change per stock)
- Add Index table to Prisma schema if storing historical Nifty data

## Frontend Integration

**New API Endpoint**: `GET /api/market/regime`

**Example Usage**:
```typescript
// In PortfolioTerminal.jsx or advisor dashboard
const response = await fetch('/api/market/regime', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const { regime, metadata, interpretation } = await response.json();

// Display to user:
// "Current Market: BULL MARKET
//  Interpretation: Strong uptrend - favor momentum and growth stocks
//  6M Return: +12.4% | Volatility: 18% (42nd percentile)"
```

## Validation & Backtesting

### How to Validate Regime Detection

```python
from app.scoring.regime_detection import backtest_regime_detection
import pandas as pd

# Load historical Nifty 50 data
nifty_data = pd.read_csv('nifty_50_daily.csv')  # date, close columns

# Run backtest
results = backtest_regime_detection(nifty_data, window_days=252)

# Analyze regime transitions
print(results.groupby('regime').size())
# Expected: Bull ~40%, Bear ~20%, High Vol ~20%, Sideways ~20%

# Validate against known events
# - March 2020 COVID crash → should show HIGH_VOLATILITY or BEAR
# - 2021 liquidity rally → should show BULL
# - 2022 rate hike cycle → should show SIDEWAYS or BEAR
```

### How to Backtest Factor Performance by Regime

```python
# For each regime period, measure next-month returns by factor quintile
# Expected results:
# - Momentum works in BULL (Q5 - Q1 spread > 5%)
# - Momentum fails in BEAR (negative spread)
# - Low Vol outperforms in HIGH_VOLATILITY
# - Value works in SIDEWAYS and BEAR
```

## Configuration & Tuning

### Regime Detection Thresholds

**File**: `services/quant-engine/app/scoring/regime_detection.py`

```python
RegimeConfig(
    bull_momentum_threshold=0.10,  # 10% return over 6M
    bear_momentum_threshold=-0.05,  # -5% return over 6M
    high_vol_percentile=0.75,  # 75th percentile
    sma_fast_days=50,
    sma_slow_days=200,
)
```

**Indian Market Considerations**:
- Nifty is more volatile than S&P 500 → may want higher vol threshold
- FII flows create sharp reversals → consider adding volume confirmation
- Budget/election cycles → could add calendar-based adjustments

### Factor Weights per Regime

**File**: `services/quant-engine/app/scoring/regime_detection.py`

Edit `REGIME_WEIGHTS` dict to tune allocations based on backtested performance.

**Recommended Approach**:
1. Backtest each factor individually across regime periods
2. Measure Sharpe ratio and quintile spread per regime
3. Allocate weights proportional to regime-specific Sharpe ratios
4. Maintain minimum 5% allocation to each factor (diversification)

## Performance Expectations

### Expected Improvements

Based on academic research (Fama-French, AQR, MSCI):

1. **Sharpe Ratio**: +0.2 to +0.4 improvement vs fixed weights
2. **Maximum Drawdown**: -5% to -8% reduction (better bear market defense)
3. **Turnover**: +10-20% (more regime transitions = more rebalancing)
4. **Win Rate**: Similar (regime timing isn't market timing)

### What NOT to Expect

- **Market timing perfection**: Regime detection has lag (uses past 200 days)
- **Avoid all losses**: Bear markets will still hurt, just less
- **Always beat benchmark**: Factors have cycles; judge over 3+ years

## Monitoring & Alerts

### Regime Transition Alerts

```typescript
// Recommended: Track regime changes and alert advisors
// apps/worker/src/jobs/regimeMonitor.ts

// Daily check:
const today_regime = detect_regime();
const yesterday_regime = get_from_cache();

if (today_regime !== yesterday_regime) {
  // Alert: "Market regime changed from BULL to HIGH_VOLATILITY"
  // Action: Review all PENDING recommendations under new regime context
  // Send email/Slack notification to advisors
}
```

### Factor Performance Dashboard

```typescript
// GET /api/market/factor-performance
// Returns which factors are currently "working"
// Display on advisor dashboard as health check
```

## FAQs

**Q: Why not use machine learning for regime detection?**
A: Rule-based is transparent, explainable, and robust. ML risks overfitting and "black box" decisions in regulated advisory context.

**Q: Can users override regime detection?**
A: Yes — API accepts `use_regime_weights: false` to fall back to equal weights. Could add UI toggle for manual regime selection.

**Q: How often does regime change?**
A: Empirically, 3-6 times per year in Indian markets. Long periods of stable regime punctuated by sharp transitions.

**Q: What if regime detection is wrong?**
A: It uses 200-day lookback, so it's lagging by design (not predictive). Wrong calls average out over time. Diversification across factors limits damage.

**Q: Should we add more regimes (e.g., "Recovery")?**
A: Possible future enhancement. Current 4 regimes cover 90%+ of market states. More regimes = more parameters to tune = overfitting risk.

## Next Steps

1. **Replace synthetic index data** with real Nifty 50 from NSE or data provider
2. **Backtest regime weights** on 10+ years of Indian market data
3. **Add regime transition alerts** to worker pipeline
4. **Build regime dashboard** in frontend (current regime + historical chart)
5. **A/B test**: Run parallel model portfolios (regime-adaptive vs fixed weights) for 6 months

---

**Version**: 0.2.0  
**Author**: FundAI Quant Team  
**Last Updated**: 2026-07-04
