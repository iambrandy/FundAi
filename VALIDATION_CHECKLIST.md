# FundAI v0.2.0 - Validation Checklist

**Date**: 2026-07-04  
**Version**: 0.2.0  
**Validator**: _______________

---

## ✅ Pre-Deployment Validation

Complete this checklist before deploying to production or presenting to stakeholders.

---

### 1. Installation & Setup

- [ ] **Prerequisites installed**
  - [ ] Node.js 18+ (`node --version`)
  - [ ] Python 3.11+ (`python --version`)
  - [ ] PostgreSQL 14+ (`psql --version`)
  - [ ] Redis 7+ (running on port 6379)

- [ ] **Dependencies installed**
  - [ ] Root: `npm install` (no errors)
  - [ ] API: `cd apps/api && npm install`
  - [ ] Worker: `cd apps/worker && npm install`
  - [ ] Quant Engine: `cd services/quant-engine && pip install -r requirements.txt`

- [ ] **Environment files created**
  - [ ] `apps/api/.env` (JWT_SECRET, DATABASE_URL, INTERNAL_SERVICE_TOKEN)
  - [ ] `apps/worker/.env` (DATABASE_URL, REDIS_HOST, INTERNAL_SERVICE_TOKEN)
  - [ ] `services/quant-engine/.env` (INTERNAL_SERVICE_TOKEN)

- [ ] **Database initialized**
  - [ ] Database created: `createdb fundai`
  - [ ] Migrations run: `cd apps/api && npx prisma migrate dev`
  - [ ] Seed data loaded: `cd apps/worker && npx tsx src/scripts/seed.ts`

---

### 2. Python Unit Tests

```bash
cd services/quant-engine
python test_regime_and_low_vol.py
```

- [ ] **Test 1: Regime Detection** - PASSED
  - [ ] BULL regime detected correctly
  - [ ] BEAR regime detected correctly
  - [ ] HIGH_VOLATILITY regime detected correctly
  - [ ] SIDEWAYS regime detected correctly
  - [ ] Factor weights returned per regime

- [ ] **Test 2: Low Volatility Factor** - PASSED
  - [ ] Realized volatility computed
  - [ ] Downside deviation computed
  - [ ] Beta to index computed
  - [ ] Max drawdown computed
  - [ ] Factor scores generated

- [ ] **Test 3: Full Scoring Pipeline** - PASSED
  - [ ] 5 factors scored (value, momentum, quality, growth, low_vol)
  - [ ] Composite score includes regime weighting
  - [ ] Rationales include regime context
  - [ ] Top stocks identified correctly

- [ ] **Test 4: Regime Transitions** - PASSED
  - [ ] Score distributions shift per regime
  - [ ] Momentum scores higher in BULL
  - [ ] Low vol scores higher in BEAR

**Test Result**: ⬜ ALL PASSED / ⬜ SOME FAILED (details: _____________)

---

### 3. Service Health Checks

**Start all services before validation:**

Terminal 1: `cd services/quant-engine && uvicorn app.main:app --reload --port 8811`  
Terminal 2: `cd apps/api && npm run dev`  
Terminal 3: `cd apps/worker && npm run dev`

- [ ] **Quant Engine Health**
  ```bash
  curl http://localhost:8811/health
  ```
  Expected: `{"status":"ok","version":"0.2.0"}`
  Result: ⬜ PASS / ⬜ FAIL (error: _____________)

- [ ] **API Health**
  ```bash
  curl http://localhost:4000/health
  ```
  Expected: `{"status":"ok"}`
  Result: ⬜ PASS / ⬜ FAIL (error: _____________)

- [ ] **Worker Running**
  - Check console output for: `[worker] Ready and listening for jobs.`
  - Result: ⬜ PASS / ⬜ FAIL (error: _____________)

---

### 4. API Endpoint Validation

**Prerequisites**: Create test user first

```bash
curl -X POST http://localhost:4000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@fundai.com",
    "password": "SecurePass123!",
    "fullName": "Test Advisor",
    "role": "ADVISOR"
  }'
```

Copy the `token` from response and use in tests below.

- [ ] **GET /api/market/regime**
  ```bash
  curl http://localhost:4000/api/market/regime \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
  Expected: Regime detected (BULL/BEAR/HIGH_VOLATILITY/SIDEWAYS) with metadata
  Result: ⬜ PASS / ⬜ FAIL (error: _____________)

- [ ] **GET /api/market/factor-performance**
  ```bash
  curl http://localhost:4000/api/market/factor-performance \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
  Expected: Factor performance metrics returned
  Result: ⬜ PASS / ⬜ FAIL (error: _____________)

- [ ] **POST /api/clients** (Create client)
  ```bash
  curl -X POST http://localhost:4000/api/clients \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"displayName": "Test Client", "email": "client@test.com"}'
  ```
  Expected: Client created with ID
  Result: ⬜ PASS / ⬜ FAIL (error: _____________)

---

### 5. Worker Pipeline Validation

- [ ] **Manual Ingestion Job**
  ```bash
  cd apps/worker
  npx tsx -e "import('./src/jobs/ingestMarketData').then(m => m.runDailyIngestion())"
  ```
  Expected: Stocks processed, no fatal errors
  Processed: _____ stocks / Failed: _____ stocks
  Result: ⬜ PASS / ⬜ FAIL

- [ ] **Manual Scoring Job**
  ```bash
  cd apps/worker
  npx tsx -e "import('./src/jobs/scoreAndRecommend').then(m => m.runScoringAndRecommendations())"
  ```
  Expected: Stocks scored, recommendations created
  Scored: _____ stocks / Recommendations: _____
  Result: ⬜ PASS / ⬜ FAIL

- [ ] **Check Database Results**
  ```sql
  -- Check factor scores have 5 factors
  SELECT * FROM "FactorScore" ORDER BY "asOfDate" DESC LIMIT 5;
  
  -- Check recommendations include regime context
  SELECT "rationaleText" FROM "Recommendation" ORDER BY "generatedAt" DESC LIMIT 3;
  ```
  Expected: Factor scores present, rationales include regime mention
  Result: ⬜ PASS / ⬜ FAIL

---

### 6. Complete Workflow Demo

- [ ] **Run Full Demo**
  ```bash
  cd services/quant-engine
  python demo_complete_workflow.py
  ```
  
  Demo Steps Completed:
  - [ ] Step 1: Downloaded market data (Nifty 50 + 10 stocks)
  - [ ] Step 2: Regime detected with metadata
  - [ ] Step 3: Stocks scored with 5 factors
  - [ ] Step 4: Portfolio constructed (5-10 positions)
  - [ ] Step 5: Recommendations generated with rationales
  
  Overall Result: ⬜ PASS / ⬜ FAIL (error: _____________)

---

### 7. Backtesting Validation

- [ ] **Run 3-Year Backtest**
  ```bash
  cd services/quant-engine
  python -m app.backtest.regime_backtest --years 3 --output backtest_3y.txt
  ```
  
  Expected Results:
  - [ ] Nifty 50 data downloaded (~750 days)
  - [ ] Regime transitions detected (3-6 per year)
  - [ ] Report generated: `backtest_3y.txt`
  - [ ] JSON results: `backtest_3y.json`
  - [ ] CSV history: `backtest_3y_regime_history.csv`
  
  Validation Points:
  - [ ] March 2020 (COVID crash) shows HIGH_VOLATILITY or BEAR
  - [ ] 2021 (liquidity rally) shows BULL
  - [ ] Regime distribution reasonable: BULL ~40%, BEAR ~10%, etc.
  
  Overall Result: ⬜ PASS / ⬜ FAIL

---

### 8. Code Quality Checks

- [ ] **Python Linting**
  ```bash
  cd services/quant-engine
  flake8 app/ --max-line-length=120 --exclude=__pycache__
  ```
  Result: ⬜ PASS / ⬜ FAIL (errors: _____________)

- [ ] **Python Formatting**
  ```bash
  cd services/quant-engine
  black --check app/
  ```
  Result: ⬜ PASS / ⬜ FAIL

- [ ] **TypeScript Linting**
  ```bash
  cd apps/api && npm run lint
  cd apps/worker && npm run lint
  ```
  Result: ⬜ PASS / ⬜ FAIL (errors: _____________)

---

### 9. Documentation Completeness

- [ ] **Core Documentation Exists**
  - [ ] README.md (project overview)
  - [ ] GETTING_STARTED.md (setup guide)
  - [ ] docs/REGIME_DETECTION.md (technical deep-dive)
  - [ ] UPGRADE_SUMMARY.md (v0.2.0 changes)
  - [ ] IMPLEMENTATION_COMPLETE.md (file manifest)

- [ ] **Code Documentation**
  - [ ] Python modules have docstrings
  - [ ] Complex functions have inline comments
  - [ ] API endpoints documented (FastAPI auto-docs)

- [ ] **Examples & Demos**
  - [ ] test_regime_and_low_vol.py (unit tests)
  - [ ] demo_complete_workflow.py (end-to-end demo)
  - [ ] regime_backtest.py (backtesting framework)

---

### 10. Performance Benchmarks

- [ ] **Scoring Performance**
  - Measure time for 50 stocks: _______ ms
  - Expected: < 1000ms
  - Result: ⬜ PASS / ⬜ FAIL

- [ ] **API Response Time**
  - Measure `/api/market/regime`: _______ ms
  - Expected: < 500ms
  - Result: ⬜ PASS / ⬜ FAIL

- [ ] **Memory Usage**
  - Quant Engine (idle): _______ MB
  - Quant Engine (scoring 50 stocks): _______ MB
  - Expected: < 500 MB
  - Result: ⬜ PASS / ⬜ FAIL

---

### 11. Security Validation

- [ ] **Authentication**
  - [ ] JWT tokens expire after 8 hours
  - [ ] Invalid tokens rejected (401)
  - [ ] Missing Authorization header rejected (401)

- [ ] **Authorization**
  - [ ] ADVISOR can create clients
  - [ ] RETAIL cannot create clients (403)
  - [ ] Cross-tenant access blocked (404, not 403)

- [ ] **Rate Limiting**
  - [ ] Auth endpoints limited (10 req/15min)
  - [ ] Global rate limit active (300 req/15min)

- [ ] **Error Handling**
  - [ ] Stack traces not leaked to client
  - [ ] DB errors return generic "Internal server error"
  - [ ] Sensitive data not in logs

---

### 12. Data Integrity Checks

- [ ] **Factor Scores**
  - [ ] All 5 factors present (value, momentum, quality, growth, low_volatility)
  - [ ] Scores in 0-100 range
  - [ ] Composite score calculated correctly
  - [ ] Regime context logged

- [ ] **Recommendations**
  - [ ] Status starts as PENDING
  - [ ] Rationale includes factor breakdown
  - [ ] Expiry date set (7 days)
  - [ ] Linked to model portfolio

- [ ] **Audit Logs**
  - [ ] Approval actions logged
  - [ ] User ID captured
  - [ ] Timestamps accurate

---

### 13. Edge Cases & Error Handling

- [ ] **Insufficient Data**
  - [ ] < 200 days of index data → regime detection fails gracefully
  - [ ] < 60 days of stock data → low vol score = NaN (handled)
  - [ ] Empty universe → error message, job doesn't crash

- [ ] **Network Issues**
  - [ ] Yahoo Finance down → job logs error, continues with other stocks
  - [ ] Redis down → worker logs error, retries
  - [ ] Database slow → worker waits, doesn't timeout prematurely

- [ ] **Invalid Input**
  - [ ] Malformed API requests → 400 Bad Request
  - [ ] Invalid stock symbols → logged, skipped, doesn't crash pipeline

---

### 14. Regression Testing (v0.1.0 Features)

Ensure old features still work:

- [ ] **Authentication**
  - [ ] Signup works
  - [ ] Login works
  - [ ] JWT tokens valid

- [ ] **Client Management**
  - [ ] ADVISOR can create clients
  - [ ] ADVISOR can list own clients
  - [ ] RETAIL sees own client only

- [ ] **Portfolios**
  - [ ] Portfolio creation works
  - [ ] Holdings tracked correctly
  - [ ] Transactions recorded

- [ ] **4-Factor Scoring** (without regime)
  - [ ] Setting `use_regime_weights=false` works
  - [ ] Equal weights applied
  - [ ] Recommendations generated

---

## 📊 Final Validation Summary

### Test Results

| Category | Pass Rate | Status |
|----------|-----------|--------|
| Installation | ___ / 5 | ⬜ |
| Python Tests | ___ / 4 | ⬜ |
| Service Health | ___ / 3 | ⬜ |
| API Endpoints | ___ / 3 | ⬜ |
| Worker Pipeline | ___ / 3 | ⬜ |
| Demo | ___ / 1 | ⬜ |
| Backtest | ___ / 1 | ⬜ |
| Code Quality | ___ / 3 | ⬜ |
| Documentation | ___ / 3 | ⬜ |
| Performance | ___ / 3 | ⬜ |
| Security | ___ / 4 | ⬜ |
| Data Integrity | ___ / 3 | ⬜ |
| Edge Cases | ___ / 3 | ⬜ |
| Regression | ___ / 4 | ⬜ |

**Overall Score**: _____ / 43 (___%)

### Recommendation

⬜ **APPROVED FOR PRODUCTION** (Score ≥ 95%, all critical tests pass)  
⬜ **APPROVED WITH CONDITIONS** (Score 85-94%, minor issues documented)  
⬜ **NOT APPROVED** (Score < 85% or critical failures)

### Critical Issues Found

1. _____________________________________________
2. _____________________________________________
3. _____________________________________________

### Non-Critical Issues Found

1. _____________________________________________
2. _____________________________________________
3. _____________________________________________

---

## ✍️ Sign-Off

**Validator Name**: _________________________  
**Date**: _________________________  
**Signature**: _________________________  

**Technical Lead Approval**: _________________________  
**Product Manager Approval**: _________________________  

---

## 📎 Attachments

Attach the following validation artifacts:

- [ ] Test output logs (Python tests, API tests)
- [ ] Backtest results (backtest_3y.txt, backtest_3y.json)
- [ ] Performance benchmark results
- [ ] Screenshots of successful demo run
- [ ] Database query results (factor scores, recommendations)

---

**Next Steps After Validation**:

1. ✅ All tests pass → Proceed to staging deployment
2. ⚠️ Minor issues → Document workarounds, fix in next sprint
3. ❌ Critical issues → Fix immediately, re-validate

**Deployment Checklist**: See [IMPLEMENTATION_COMPLETE.md](IMPLEMENTATION_COMPLETE.md) for production deployment steps.
