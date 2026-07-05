# FundAI Security Standards
*Security baselines, token setups, and pre-release audits.*

---

## 1. Secrets Management
* **Environment Variables Only**: All credentials (such as DB URLs, JWT secrets, and tokens) are read from `.env` files. Hardcoding credentials in commits is prohibited.
* **Gitignore Baseline**: `.env` and SQLite databases (`*.db`, `*.sqlite`) are gitignored.
* **Token Rotation**: If any key is ever pushed to version control, it is immediately revoked and rotated.

---

## 2. Authentication (AuthN) & Authorization (AuthZ)
* **JWT Token Security**: Client requests to the Express gateway API require a valid JSON Web Token (JWT) passed in the `Authorization` header.
* **Quant Engine Isolation**: The Python Quant FastAPI service runs inside an internal subnet. It accepts requests only if they provide a header `x-internal-token` matching the environment `INTERNAL_SERVICE_TOKEN`.
* **Row-Level Tenancy Scoping**: Database queries targeting portfolios, transactions, or client records must construct queries using `getTenantPrisma(userId, role)` to ensure advisors can only read/write their authorized clients, and retail users can only access their personal accounts.

---

## 3. Input validation & Sanitization
* **TypeScript (API Gateways)**: All endpoints validate payload shapes using Zod schemas (e.g. `approveSchema` in `recommendations.ts`).
* **Python (Quant Service)**: Input structures are parsed and validated using Pydantic models (e.g. `ScoreRequest`, `RegimeDetectionRequest`).
* **Parameterized SQL**: All raw database access (e.g. logging system events in `refreshMacroEvents.ts`) must run parameterized queries using Prisma's template tag system (`prisma.$executeRaw` or `$queryRaw`) to protect against SQL injections.

---

## 4. Operational System Events & Logging
* **Diagnostic Alerts**: Machine-generated pipeline failures or database staleness warnings are logged to the database using the `SystemEvent` table.
* **PII & Credentials Scrubbing**: Loggers must never output secrets, auth tokens, passwords, or full PII fields. Output details must be checked before registering warning events.

---

## 5. Pre-Release Security Checklist
Before moving schema changes or deployment updates to staging/production:

- [ ] **Dependency Audit**: Execute `npm audit` and resolve all high/critical alerts.
- [ ] **Token Validation**: Confirm `INTERNAL_SERVICE_TOKEN` is defined and populated with a secure, 32-character string.
- [ ] **Migration Check**: Regenerate compile-safe prisma schema files and verify all migrations contain proper labels (no schema drifts).
- [ ] **Lookahead Regression Check**: Run the lookahead suite (`python -m pytest tests/test_lookahead_bias.py`) and verify all tests pass.
- [ ] **Rate Limiting Check**: Confirm rate limit middleware is enabled on all authentication endpoints.
