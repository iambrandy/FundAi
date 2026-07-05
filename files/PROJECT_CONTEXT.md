# FundAI Project Context
*Single source of truth for product definition, application flow, and core routes.*

---

## 1. Product Description
FundAI is an adaptive 5-factor quantitative scoring and rebalancing advisory platform designed for SEBI-registered Investment Advisors (RIAs) and wealth managers to deliver transparent, regime-aware portfolio recommendations to clients while maintaining a compliance-first human approval gate.

---

## 2. Technical Stack
* **Language(s)**: Python 3.14 (Quant Service), TypeScript (Node API / Frontend / Worker).
* **Frontend**: React, Vite, TailwindCSS.
* **Backend**: Express (Node API Gateway), FastAPI (Python Quant Service).
* **Database(s)**: SQLite (SQLite file databases for both transactional state and macro calendar calendars).
* **Queue / Async Jobs**: BullMQ (with Redis backend).
* **ORM**: Prisma (Node-side database models).
* **Package Manager**: NPM.

---

## 3. Core Application Flow
```
[Ingestion Job (Daily, 16:30 IST)] ──► Fetches OHLCV and fundamental metrics via YFinance
                                                     │
                                                     ▼
[Scoring Engine (Daily, post-ingestion)] ──► Detects market regime & computes winsorized z-scores
                                                     │
                                                     ▼
[Rebalance Construction] ───────────────► Proposes buy/sell trades to match target strategy weights
                                                     │
                                                     ▼
[Human-in-the-Loop Gateway] ────────────► Advisor reviews rationale and explicitly clicks "APPROVE"
                                                     │
                                                     ▼
[Transaction Execution] ────────────────► Generates target execution transactions for client portfolios
```

---

## 4. Internal API Directory (Quant Engine)
Internal endpoints authenticated via the `INTERNAL_SERVICE_TOKEN` header:

| Method | Route | Purpose | Payload Schema |
|---|---|---|---|
| `POST` | `/score` | Returns winsorized 5-factor z-scores and batch metadata. | `{ universe: StockInput[], price_history: ..., index_prices: ... }` |
| `POST` | `/construct-portfolio` | Solves position target weight constraints. | `{ scored_universe: dict[], max_position_weight_pct: ... }` |
| `POST` | `/detect-regime` | Evaluates current market regime classification. | `{ index_prices: IndexPriceInput }` |
| `POST` | `/refresh-macro-events` | Seeds macro calendar database and audits staleness. | (No payload) |
| `GET` | `/data-health` | Connectivity and latency probe. | (No payload) |

---

## 5. Non-Negotiable Rules (Guarantees)
1. **Fiduciary Isolation Gate**: AI engines do not execute trades. A transaction is only created when an advisor or client clicks "APPROVE" on a `Recommendation` record.
2. **Lookahead-Free Assurance**: All rolling and cumulative statistics inside the quant engine must be calculated using trailing windows exclusively (verified by regression suite `test_lookahead_bias.py`).
3. **Database Tenant Isolation**: Database access queries targeting client assets or client portfolios must scope queries using the user ID/advisor ID parameter via `getTenantPrisma()`. Unscoped data queries are prohibited.
