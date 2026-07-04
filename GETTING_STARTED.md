# Getting Started with FundAI v0.2.0

## 🚀 Quick Start (5 Minutes)

### Prerequisites

- **Node.js** 18+ & npm
- **Python** 3.11+
- **PostgreSQL** 14+
- **Redis** 7+ (for worker queue)
- **Git**

### One-Command Setup

```bash
# From project root
npm run setup:all
```

This will:
1. Install all Node.js dependencies
2. Install Python dependencies
3. Set up environment files
4. Initialize database
5. Run validation tests

---

## 📦 Manual Installation

### 1. Clone & Install Dependencies

```bash
# Install root dependencies
npm install

# Install API dependencies
cd apps/api
npm install

# Install Worker dependencies
cd ../worker
npm install

# Install Python dependencies
cd ../../services/quant-engine
pip install -r requirements.txt
```

### 2. Environment Configuration

Create `.env` files in each service directory:

#### **Root `.env`**
```bash
DATABASE_URL=postgresql://fundai:password@localhost:5432/fundai
REDIS_HOST=localhost
REDIS_PORT=6379
```

#### **`apps/api/.env`**
```bash
DATABASE_URL=postgresql://fundai:password@localhost:5432/fundai
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
WEB_APP_ORIGIN=http://localhost:3000
PORT=4000
QUANT_ENGINE_URL=http://localhost:8811
INTERNAL_SERVICE_TOKEN=your-internal-service-token
NODE_ENV=development
```

#### **`apps/worker/.env`**
```bash
DATABASE_URL=postgresql://fundai:password@localhost:5432/fundai
REDIS_HOST=localhost
REDIS_PORT=6379
QUANT_ENGINE_URL=http://localhost:8811
INTERNAL_SERVICE_TOKEN=your-internal-service-token
MARKET_DATA_PROVIDER=synthetic
NODE_ENV=development
```

#### **`services/quant-engine/.env`**
```bash
INTERNAL_SERVICE_TOKEN=your-internal-service-token
```

### 3. Database Setup

```bash
# Create database
createdb fundai

# Run migrations (from apps/api or apps/worker)
cd apps/api
npx prisma migrate dev
npx prisma generate

# Seed test data
cd ../worker
npx tsx src/scripts/seed.ts
```

### 4. Start Services

Open **4 terminals**:

**Terminal 1: Quant Engine (Python)**
```bash
cd services/quant-engine
uvicorn app.main:app --reload --port 8811
```

**Terminal 2: API (Node.js)**
```bash
cd apps/api
npm run dev
```

**Terminal 3: Worker (Node.js)**
```bash
cd apps/worker
npm run dev
```

**Terminal 4: Web (Optional)**
```bash
cd apps/web
npm run dev
```

### 5. Verify Installation

```bash
# Check quant engine
curl http://localhost:8811/health
# Expected: {"status":"ok","version":"0.2.0"}

# Check API
curl http://localhost:4000/health
# Expected: {"status":"ok"}

# Run Python tests
cd services/quant-engine
python test_regime_and_low_vol.py
# Expected: ALL TESTS PASSED ✓
```

---

## 🧪 Testing the New Features

### Test 1: Regime Detection

```bash
# Python test suite
cd services/quant-engine
python test_regime_and_low_vol.py
```

Expected output:
```
TEST 1: REGIME DETECTION
--- Testing BULL regime ---
Detected Regime: BULL
6M Momentum: 15.24%
Current Volatility: 12.50%
✓ Regime detection test passed
```

### Test 2: Low Volatility Factor

The test suite validates:
- Realized volatility computation
- Downside deviation (semi-variance)
- Beta calculation
- Max drawdown measurement
- Factor scoring pipeline

### Test 3: Full Pipeline with Real Data

```bash
# Download real market data and run backtest
cd services/quant-engine
python -m app.backtest.regime_backtest --years 5 --output results.txt
```

This will:
1. Download 5 years of Nifty 50 data from Yahoo Finance
2. Download 50 Nifty constituent stocks
3. Detect regimes across history
4. Generate performance report

**Note**: First run takes ~5-10 minutes to download data. Subsequent runs use cache.

### Test 4: API Integration Test

```bash
# Start all services first, then:

# 1. Create a test user
curl -X POST http://localhost:4000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@fundai.com",
    "password": "SecurePass123!",
    "fullName": "Test Advisor",
    "role": "ADVISOR"
  }'

# 2. Get regime (using token from signup response)
curl http://localhost:4000/api/market/regime \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected response:
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

# 3. Trigger scoring job manually (optional)
cd apps/worker
npx tsx -e "import('./src/jobs/scoreAndRecommend').then(m => m.runScoringAndRecommendations())"
```

---

## 📊 Running Your First Backtest

### Option 1: Quick Demo (Synthetic Data)

```bash
cd services/quant-engine
python test_regime_and_low_vol.py
```

Fast, no internet required. Good for validating installation.

### Option 2: Real Market Data (5 years)

```bash
cd services/quant-engine
python -m app.backtest.regime_backtest --years 5 --output backtest_5y.txt
```

**What it does**:
- Downloads Nifty 50 historical data (2019-2024)
- Detects regime transitions
- Measures regime duration and frequency
- Validates regime classification

**Expected results**:
```
FUNDAI REGIME DETECTION BACKTEST REPORT
========================================
Backtest Period: 2019-01-01 to 2024-07-04
Total Trading Days: 1,350

REGIME DISTRIBUTION
BULL              : 540 days (40.0%)
SIDEWAYS          : 405 days (30.0%)
HIGH_VOLATILITY   : 270 days (20.0%)
BEAR              : 135 days (10.0%)

Transitions per Year: 4.2
```

### Option 3: Full Backtest (10 years, all factors)

**Coming Soon**: Requires fundamental data integration.

For now, regime detection is validated independently. Full factor performance testing across regimes requires:
1. Historical fundamental data (P/E, P/B, ROE, etc.)
2. Survivorship-bias-free stock universe
3. Corporate actions adjustments

---

## 🎯 Next Steps After Installation

### 1. Validate Regime Detection

```bash
cd services/quant-engine
python -m app.backtest.regime_backtest --years 3
```

Review `regime_backtest_results.txt` and check:
- Does March 2020 (COVID crash) show HIGH_VOLATILITY or BEAR? ✓
- Does 2021 (liquidity rally) show BULL? ✓
- Are regime transitions aligned with major market events? ✓

### 2. Customize Regime Thresholds

Edit `services/quant-engine/app/scoring/regime_detection.py`:

```python
RegimeConfig(
    bull_momentum_threshold=0.12,  # Tune based on Indian market
    bear_momentum_threshold=-0.08,
    high_vol_percentile=0.70,
)
```

Re-run backtest to see impact.

### 3. Test Factor Performance

Once fundamental data is integrated:

```python
# Measure factor returns by regime
python -m app.backtest.factor_performance --regime BULL
python -m app.backtest.factor_performance --regime BEAR
```

### 4. Optimize Factor Weights

Based on backtest results, adjust:

```python
# In services/quant-engine/app/scoring/regime_detection.py
REGIME_WEIGHTS = {
    MarketRegime.BULL: RegimeFactorWeights(
        momentum=0.40,  # Increase if momentum worked well in Indian bull markets
        growth=0.25,
        # ...
    ),
}
```

### 5. Build Frontend Dashboard

Add regime indicator to portfolio terminal:

```jsx
// In apps/web/src/pages/PortfolioTerminal.jsx
const [regime, setRegime] = useState(null);

useEffect(() => {
  fetch('/api/market/regime', {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(res => res.json())
    .then(data => setRegime(data));
}, []);

// Display:
<div className="regime-badge" data-regime={regime?.regime}>
  Current Market: {regime?.regime}
  <span className="regime-interpretation">{regime?.interpretation}</span>
</div>
```

---

## 🔧 Troubleshooting

### Issue: "yfinance module not found"

```bash
cd services/quant-engine
pip install yfinance
```

### Issue: "Redis connection failed"

Make sure Redis is running:
```bash
# Windows (if installed via MSI)
redis-server

# Or use Docker
docker run -d -p 6379:6379 redis:7-alpine
```

### Issue: "PostgreSQL connection refused"

Check database is running and credentials match `.env`:
```bash
psql -U fundai -d fundai -h localhost
```

### Issue: "Regime detection returns EQUAL_WEIGHT_FALLBACK"

This means index prices weren't passed or regime detection failed:
1. Check `index_prices` is passed to `/score` endpoint
2. Verify index data has at least 200 days
3. Check quant engine logs for exceptions

### Issue: "Low volatility scores all NaN"

Price history format issue:
- Ensure `price_history` DataFrame has columns = stock_ids
- Ensure index = dates (DatetimeIndex)
- Verify at least 60 days of data per stock

### Issue: "Tests fail with import errors"

Add to PYTHONPATH:
```bash
# Linux/Mac
export PYTHONPATH="${PYTHONPATH}:/path/to/fundai/services/quant-engine"

# Windows PowerShell
$env:PYTHONPATH += ";C:\path\to\fundai\services\quant-engine"

# Or run from quant-engine directory
cd services/quant-engine
python test_regime_and_low_vol.py
```

---

## 📚 Documentation

- **Technical Guide**: `docs/REGIME_DETECTION.md`
- **Upgrade Summary**: `UPGRADE_SUMMARY.md`
- **API Reference**: Start services and visit `http://localhost:8811/docs` (FastAPI auto-docs)
- **Architecture**: See original README.md

---

## 🤝 Development Workflow

### Making Changes

1. **Edit Python code** in `services/quant-engine/app/`
2. **Test immediately**: `python test_regime_and_low_vol.py`
3. **Run backtest**: `python -m app.backtest.regime_backtest --years 3`
4. **Test API integration**: Start services and curl endpoints
5. **Commit**: Include test results in PR

### Running Tests Before Commit

```bash
# Python tests
cd services/quant-engine
python test_regime_and_low_vol.py

# Node.js tests (when you add them)
cd apps/api
npm test

cd ../worker
npm test
```

### Code Formatting

```bash
# Python
cd services/quant-engine
black app/
flake8 app/

# TypeScript
cd apps/api
npm run lint
```

---

## 🎓 Learning Resources

### Understanding Factor Investing
- **Book**: "Your Complete Guide to Factor-Based Investing" by Andrew Berkin
- **Paper**: Fama-French Five-Factor Model (2015)
- **AQR Research**: https://www.aqr.com/Insights/Research

### Regime Detection in Finance
- **Paper**: "Market Timing with Regime Switching Models" (Guidolin & Timmermann)
- **Blog**: QuantStart - Hidden Markov Models for Regime Detection

### Indian Market Specifics
- **NSE Knowledge Hub**: https://www.nseindia.com/education
- **SEBI Guidelines**: Portfolio Management Services regulations

---

## 💡 Tips for Production Deployment

1. **Replace synthetic data** with real Nifty 50 feed (NSE, Bloomberg, etc.)
2. **Set up monitoring** (DataDog, New Relic) for regime transitions
3. **Alert on regime changes** (email advisors when BULL → HIGH_VOLATILITY)
4. **Cache index data** in Redis (doesn't change per request)
5. **Run backtests monthly** to validate regime detection accuracy
6. **A/B test** regime-adaptive vs fixed weights for 6 months
7. **Log all regime decisions** for audit trail

---

## 🚨 Important Notes

### For MVP/Testing
- Currently uses **synthetic index data** via `generateSyntheticIndexPrices()`
- Replace with real data before production

### Database Schema
- No migrations needed (new fields computed on-the-fly)
- Optional: Add `regime` column to `FactorScore` for historical tracking

### Performance
- Scoring time: +10-15% (low vol metrics computation)
- Consider caching price history for high-frequency scoring

### Compliance
- Regime detection is **quantitative analysis**, not market timing advice
- Include disclaimer in all recommendations
- Log regime used for each recommendation (audit trail)

---

**Questions? Issues?** Check `docs/REGIME_DETECTION.md` or create GitHub issue.

**Ready to dive deeper?** Run `python -m app.backtest.regime_backtest --years 10` for full historical analysis!
