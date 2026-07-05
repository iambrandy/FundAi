# FundAI Feature Log
*Chronological, verified log of all updates made to the platform.*

---

### 2026-07-05 — Lookahead Bias Safety, DB Macro Store, & Monorepo Configuration
* **Type**: Refactor | Architecture Update | Security Fix
* **Summary**: Implemented a comprehensive lookahead bias regression test suite verifying that no future data leaks into prior factor scores. Migrated the hardcoded macro context dates to a structured SQLite `MacroEventStore` and wired a weekly BullMQ cron job on Sundays (18:00 IST) to audit calendar staleness. Cleaned up monorepo config by removing duplicate `schema.prisma` files and referencing root `/prisma/schema.prisma` relatively.
* **Why**: Ensure backtest integrity by proving lookahead safety mechanically, resolve ViewState/JS-gating failures on government scraping endpoints by moving to manual seeding with staleness alerts, and prevent schema divergence across sub-projects.
* **Modules Touched**: `services/quant-engine`, `apps/worker`, `apps/api`, `prisma/`
* **Docs Updated**: `PROJECT_CONTEXT.md` [x]  `ARCHITECTURE.md` [x]  `SECURITY.md` [x]  `CODING_RULES.md` [x]
* **Rollback Note**: Revert git commit, delete SQLite database file `macro_events.db`, restore individual schema files if necessary.

---

### 2026-07-03 — Low Volatility Factor & Regime-Adaptive Weighting Engine
* **Type**: Added Feature | Model Update
* **Summary**: Added Low Volatility as the 5th scoring factor (incorporating realized volatility, downside deviation, beta, and max drawdown). Built market regime detection (BULL, BEAR, HIGH_VOLATILITY, SIDEWAYS) using index momentum, SMA trends, and realized volatility percentiles. Configured scoring weights to adapt dynamically to the detected regime.
* **Why**: Deliver better risk-adjusted returns during bear market cycles and provide clear rationales explaining scoring weights based on market conditions.
* **Modules Touched**: `services/quant-engine/app/scoring`
* **Docs Updated**: `README.md` [x]  `docs/REGIME_DETECTION.md` [x]
* **Rollback Note**: Set `use_regime_weights=false` to revert to baseline equal-weighted 4-factor scoring.
