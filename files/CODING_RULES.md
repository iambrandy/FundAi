# FundAI Coding Guidelines
*Enforceable conventions, directory mappings, and regression safety rules.*

---

## 1. Naming & Style Rules
* **TypeScript (Apps/Worker)**:
  * File names: `kebab-case.ts` (e.g. `score-and-recommend.ts`).
  * Variables & Functions: `camelCase` (e.g. `getMarketDataProvider`).
  * Types & Classes: `PascalCase` (e.g. `FundamentalSnapshot`).
* **Python (Quant-Engine)**:
  * File names: `snake_case.py` (e.g. `regime_detection.py`).
  * Variables, Functions & Attributes: `snake_case` (e.g. `compute_factor_scores`).
  * Classes: `PascalCase` (e.g. `YFinanceProvider`).
* **Database Fields**: `camelCase` in Prisma matching JavaScript object mappings; maps to underlying SQLite system tables.
* **Booleans**: Always prefix with helper verbs: `is`, `has`, `should` (e.g., `isActive`, `is_high_vol`).

---

## 2. Directory Layout Rule
Duplicate schema files are banned. The project uses a single-schema structure:
* All database changes are edited in `/prisma/schema.prisma`.
* Sub-projects (`apps/api` and `apps/worker`) resolve to the root schema file via relative directory references:
  ```json
  "prisma": {
    "schema": "../../prisma/schema.prisma"
  }
  ```
* Do not duplicate the database SQL files inside sub-directories.

---

## 3. Lookahead Bias & Trailing-Window Constraints
Any rolling calculation or price difference calculation in the quant engine is a potential lookahead vector.
* **Rule**: All pandas rolling window queries (`.rolling()`) must use `center=False` (default) to guarantee that they only pull past dates.
* **Rule**: Loops that accumulate percentages or calculate rolling stats must slice trailing histories exclusively (e.g. `vols[:idx+1]`). Slices containing future index markers (e.g., `vols[idx:]` or offset index references) are rejected.
* **Regression Guard**: All changes to quant engine scoring or classification logic must run against the `tests/test_lookahead_bias.py` regression suite. This suite appends future rows to active series and asserts that scores at the original final date remain unchanged to 6 decimal places.

---

## 4. Error Handling & Data Quality
* **No Swallowing Errors**: Catch blocks must log the error with context or rethrow. Empty `catch {}` or `except: pass` is prohibited.
* **Data Quality Boundary**: Real market data regularly includes feed corruptions. Ingestors must explicitly drop rows where:
  * High price < Low price.
  * Close price is null.
  * Volume < 0.
* Rejections must be logged at the `WARNING` level with symbol diagnostics.

---

## 5. Standard Agent System Prompt
Provide this context to coding agents before work:
> You are a senior software engineer working on FundAI. Maintain strict layer isolation: frontend (Vite/React), gateway API (Express), background task workers (BullMQ), and math engine (FastAPI/Python). Refer to the single schema source of truth `/prisma/schema.prisma`. Enforce lookahead-free trailing window properties across all Python math logic and ensure the regression tests pass.
