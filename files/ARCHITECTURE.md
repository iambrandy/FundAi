# FundAI Architecture Document
*System design, module boundaries, and architectural decision records.*

---

## 1. System Layering
FundAI uses a decoupled, multi-tier architecture with strict downward dependencies:

```
[UI Client (React/Vite)]
         │
         ▼
[API Gateway (Express/Node)] ◄───► [Worker Pipeline (BullMQ)]
         │                                   │
         ├───────────────────────────────────┤
         ▼                                   ▼
[Database Access (Prisma ORM)]      [Quant Scoring Service (FastAPI/Python)]
         │                                   │
         ▼                                   ▼
[SQLite Core Database (dev.db)]     [Macro Calendar DB (macro_events.db)]
```

### Dependency Flow Rule
Dependencies must only flow downwards. 
* The Express API/Gateway and the BullMQ worker communicate with the Python Quant Service strictly via internal HTTP API endpoints.
* Database models represent the shared contract. Business calculations must not occur in database mapping layers.

---

## 2. Monorepo Organization & Module Boundaries
```
/apps
  /web           — React/Vite web application
  /api           — Express server orchestrating authentication, portfolios, and client records
  /worker        — BullMQ job processor managing ingestion, scoring, and macro audits
/services
  /quant-engine  — Python FastAPI scoring service containing mathematical engine models
/prisma          — Single database schema source of truth and SQLite target database file
/docs            — Technical Deep-dives, user guides, and research archives
/scripts         — Build, seed, and migration utilities
```

### Module Isolation Rules
1. **No Circular Imports**: Sub-packages must never import from other sub-packages directly.
2. **Single Schema Source of Truth**: Duplicate `schema.prisma` files inside sub-directories are rejected. `apps/api` and `apps/worker` configure their schema location relatively via `package.json` to point directly to root `/prisma/schema.prisma`.
3. **Internal Service Token Boundary**: The FastAPI quant service is isolated from external traffic. It authenticates request payloads using a shared `INTERNAL_SERVICE_TOKEN` header.

---

## 3. Data Scoping & Tenant Isolation
* All transactional database access is scoped via a tenant helper `getTenantPrisma(userId, role)`. 
* Multi-tenancy is enforced at the DB level (Advisors manage a scoped set of clients; retail clients access only their personal portfolio records). Raw, unscoped queries on client-specific data are explicitly blocked.

---

## 4. Geopolitical & Macro Context Freezing
* **Rationale Integrity**: Rationale and event overlays must be immutable at generation time.
* **Freeze Pattern**: During scoring, the FastAPI `/score` endpoint computes the macro event context once per batch (attaching it to `run_metadata`). The BullMQ scoring job reads this single string and writes it directly into the `factorSnapshot` JSON field inside the `Recommendation` row at creation time. This prevents rationales from changing retroactively.

---

## 5. Architectural Decision Records (ADRs)

### ADR-001: 5-Factor Regime-Adaptive Scoring Engine
* **Context**: Legacy FundAI used equal-weighted 4-factor scoring (Value, Momentum, Quality, Growth) ignoring market states.
* **Decision**: Integrated a 5th factor (Low Volatility, consisting of realized vol, downside deviation, beta, and max drawdown) and dynamic weights dependent on market regime (BULL, BEAR, HIGH_VOLATILITY, SIDEWAYS).
* **Consequences**: Outperformance in bear and high-volatility market cycles through defensive allocation, while maintaining growth exposure in bull markets.

### ADR-002: SQLite-Backed Manual Macro Store & Weekly Audits
* **Context**: Geopolitical macro event data was hardcoded as static rules, preventing updates without code releases.
* **Decision**: Deployed a dedicated SQLite-backed `MacroEventStore` on the Python side, populated with manually seeded major events (such as the annual RBI MPC dates and Union Budget cycles), audited weekly by a Sunday BullMQ cron job.
* **Consequences**: Kept data pipelines stable, avoided brittle/JS-gated scraping dependencies (RBI and PIB pages are dynamic/ViewState-gated), and provided explicit 90-day staleness warnings written to the database.
