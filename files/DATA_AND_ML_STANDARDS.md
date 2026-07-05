# FundAI Data & ML Standards
*Analytics models, factor calculation rules, and data quality requirements.*

---

## 1. Data Sources & Ownership

| Table / Source | Source of Truth | Owner | PII? | Refresh Cadence |
|---|---|---|---|---|
| `StockPrice` | Yahoo Finance (`^NSEI` / `.NS`) | `YFinanceProvider` | No | Daily (after NSE close) |
| `StockFundamental` | Yahoo Finance (key corporate metrics) | `YFinanceProvider` | No | Quarterly (as reports release) |
| `macro_events` | SQLite event store (RBI MPC / Budgets) | `MacroEventStore` | No | Weekly check / Annual seed |
| `SystemEvent` | Node pipeline / Python API | `SystemEvent` model | No | Realtime on operational warnings |
| `User` / `Client` | User KYC / Signup | Express gateway | Yes | On registration / KYC update |

---

## 2. Ingestion Validation Contracts
The ingestion engine validates data quality during fetches to prevent downstream pipeline crashes:
* **Invalid Rows**: High < Low, close is null, or volume < 0.
* **Filter Action**: Dropped immediately at input. Rejections must generate `logger.warning()` alerts identifying the symbol and count of invalid bars.
* **Symbol Mapping Suffix**: All Indian equity tickers must append `.NS` (e.g. `RELIANCE.NS`) for Yahoo Finance compatibility. Index tickers must use the `^` prefix (e.g. `^NSEI`) to skip suffix addition.

---

## 3. Mathematical Factor Models (Quant Service)
FundAI evaluates the stock universe on a 5-factor scoring model:

1. **Valuation (Value)**: Computed by inverting P/E (`1/pe_ratio`) and P/B (`1/pb_ratio`) ratios. Lower ratio yields a higher score.
2. **Price Momentum (Momentum)**: Evaluates price return vectors over the last 6 months (`return_6m`) and 12 months (`return_12m`).
3. **Balance Sheet Quality (Quality)**: Evaluates ROE (`roe`) and inverted leverage (`1/(1+debt_to_equity)`).
4. **Earnings Growth (Growth)**: Blends Year-over-Year EPS Growth (`eps_growth_yoy`) and Revenue Growth (`revenue_growth_yoy`).
5. **Risk Profile (Low Volatility)**: Blends 252-day realized volatility, downside deviation (semi-variance below 0% return), beta to Nifty index, and max drawdown.

### Cross-Sectional Normalization
* **Winsorization**: Raw metrics are winsorized (clipped) at the 1st and 99th percentiles to protect against outliers.
* **Z-Scoring**: Metrics are cross-sectionally z-scored relative to the sector (sector-neutral scoring) or universe.
* **CDF Mapping**: Z-scores are mapped to a 0–100 percentile-style scale via the Normal Cumulative Distribution Function (CDF):
  $$Score = \Phi(Z) \times 100$$
  This ensures stable scores regardless of absolute sector valuation heights.

---

## 4. Regime-Adaptive Scoring Model
The system adapts factor weight allocations dynamically according to four market regimes:

| Regime | Value | Momentum | Quality | Growth | Low Vol | Rationale |
|---|---|---|---|---|---|---|
| **BULL** | 10% | 35% | 20% | 30% | 5% | Focus on growth and trend momentum. |
| **BEAR** | 25% | 5% | 35% | 5% | 30% | Defensive positioning (Low Vol + Quality). |
| **HIGH_VOLATILITY** | 15% | 10% | 40% | 10% | 25% | Strong capital protection, high balance-sheet quality. |
| **SIDEWAYS** | 30% | 15% | 30% | 15% | 10% | Value-oriented yield collection. |

---

## 5. Geopolitical Event Modeling
Geopolitical context operates under a manual-seed-plus-staleness-alert model rather than automated scrapers:
* **Manual Input**: Schedule dates are entered manually. Standard schedules (RBI MPC, Union Budget, lok sabha results) are seeded during setup.
* **Auditing**: A Sunday BullMQ job calls `/refresh-macro-events` to evaluate if the database holds events within the next 90 days. If the store is stale, a `SystemEvent` alert is raised to notify the system operator.
* **Freeze Strategy**: Scored context is broadcast at scoring and saved as an immutable `factorSnapshot` in the DB.
