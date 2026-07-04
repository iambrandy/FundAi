-- ============================================================
-- Hand-translated from prisma/schema.prisma for sandbox testing
-- (no network access to Prisma's engine binary here).
-- Real deployments MUST use `npx prisma migrate dev` instead —
-- this file exists purely to smoke-test the pipeline end-to-end.
-- ============================================================

CREATE TYPE "UserRole" AS ENUM ('ADVISOR', 'RETAIL', 'ADMIN');
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "RiskTolerance" AS ENUM ('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE');
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'BONUS');
CREATE TYPE "StrategyStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'BACKTESTING');
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');
CREATE TYPE "RecommendationAction" AS ENUM ('BUY', 'SELL', 'REBALANCE');

CREATE TABLE "User" (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  role "UserRole" NOT NULL,
  phone TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE "Client" (
  id TEXT PRIMARY KEY,
  "advisorId" TEXT REFERENCES "User"(id),
  "retailUserId" TEXT UNIQUE REFERENCES "User"(id),
  "displayName" TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ON "Client"("advisorId");

CREATE TABLE "RiskProfile" (
  id TEXT PRIMARY KEY,
  "clientId" TEXT UNIQUE NOT NULL REFERENCES "Client"(id),
  "riskTolerance" "RiskTolerance" NOT NULL,
  "investmentHorizonYears" INT NOT NULL,
  "monthlyInvestable" DECIMAL(16,2) NOT NULL,
  goals TEXT,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE "Stock" (
  id TEXT PRIMARY KEY,
  symbol TEXT UNIQUE NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'NSE',
  name TEXT NOT NULL,
  sector TEXT,
  industry TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ON "Stock"(symbol);
CREATE INDEX ON "Stock"(sector);

CREATE TABLE "StockFundamental" (
  id TEXT PRIMARY KEY,
  "stockId" TEXT NOT NULL REFERENCES "Stock"(id),
  "reportDate" DATE NOT NULL,
  "peRatio" DECIMAL(10,2),
  "pbRatio" DECIMAL(10,2),
  roe DECIMAL(6,2),
  "debtToEquity" DECIMAL(8,2),
  "epsGrowthYoy" DECIMAL(6,2),
  "revenueGrowthYoy" DECIMAL(6,2),
  "dividendYield" DECIMAL(6,2),
  "marketCap" DECIMAL(20,2),
  UNIQUE ("stockId", "reportDate")
);
CREATE INDEX ON "StockFundamental"("stockId");

CREATE TABLE "StockPrice" (
  id TEXT PRIMARY KEY,
  "stockId" TEXT NOT NULL REFERENCES "Stock"(id),
  date DATE NOT NULL,
  open DECIMAL(14,4) NOT NULL,
  high DECIMAL(14,4) NOT NULL,
  low DECIMAL(14,4) NOT NULL,
  close DECIMAL(14,4) NOT NULL,
  volume BIGINT NOT NULL,
  UNIQUE ("stockId", date)
);
CREATE INDEX ON "StockPrice"("stockId", date);

CREATE TABLE "FactorScore" (
  id TEXT PRIMARY KEY,
  "stockId" TEXT NOT NULL REFERENCES "Stock"(id),
  "asOfDate" DATE NOT NULL,
  "valueScore" DECIMAL(5,2) NOT NULL,
  "momentumScore" DECIMAL(5,2) NOT NULL,
  "qualityScore" DECIMAL(5,2) NOT NULL,
  "growthScore" DECIMAL(5,2) NOT NULL,
  "compositeScore" DECIMAL(5,2) NOT NULL,
  UNIQUE ("stockId", "asOfDate")
);
CREATE INDEX ON "FactorScore"("stockId", "asOfDate");

CREATE TABLE "ModelPortfolio" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status "StrategyStatus" NOT NULL DEFAULT 'BACKTESTING',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE "ModelPortfolioConstituent" (
  id TEXT PRIMARY KEY,
  "modelPortfolioId" TEXT NOT NULL REFERENCES "ModelPortfolio"(id),
  "stockId" TEXT NOT NULL REFERENCES "Stock"(id),
  "targetWeightPct" DECIMAL(5,2) NOT NULL,
  "asOfDate" DATE NOT NULL,
  UNIQUE ("modelPortfolioId", "stockId", "asOfDate")
);

CREATE TABLE "BacktestResult" (
  id TEXT PRIMARY KEY,
  "modelPortfolioId" TEXT NOT NULL REFERENCES "ModelPortfolio"(id),
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  cagr DECIMAL(6,2),
  xirr DECIMAL(6,2),
  "maxDrawdown" DECIMAL(6,2),
  "sharpeRatio" DECIMAL(6,2),
  volatility DECIMAL(6,2),
  "generatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE "Portfolio" (
  id TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL REFERENCES "Client"(id),
  name TEXT NOT NULL,
  "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
  "modelPortfolioId" TEXT REFERENCES "ModelPortfolio"(id),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ON "Portfolio"("clientId");

CREATE TABLE "Holding" (
  id TEXT PRIMARY KEY,
  "portfolioId" TEXT NOT NULL REFERENCES "Portfolio"(id),
  "stockId" TEXT NOT NULL REFERENCES "Stock"(id),
  quantity DECIMAL(18,4) NOT NULL,
  "avgBuyPrice" DECIMAL(16,4) NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE ("portfolioId", "stockId")
);
CREATE INDEX ON "Holding"("portfolioId");

CREATE TABLE "PortfolioNavHistory" (
  id TEXT PRIMARY KEY,
  "portfolioId" TEXT NOT NULL REFERENCES "Portfolio"(id),
  date DATE NOT NULL,
  "totalValue" DECIMAL(18,2) NOT NULL,
  "cashBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  UNIQUE ("portfolioId", date)
);

CREATE TABLE "Recommendation" (
  id TEXT PRIMARY KEY,
  "portfolioId" TEXT NOT NULL REFERENCES "Portfolio"(id),
  "modelPortfolioId" TEXT REFERENCES "ModelPortfolio"(id),
  action "RecommendationAction" NOT NULL,
  "stockId" TEXT REFERENCES "Stock"(id),
  "suggestedQuantity" DECIMAL(18,4),
  "suggestedWeightPct" DECIMAL(5,2),
  "rationaleText" TEXT NOT NULL,
  "factorSnapshot" JSONB,
  status "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP,
  "generatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMP
);
CREATE INDEX ON "Recommendation"("portfolioId", status);

CREATE TABLE "Transaction" (
  id TEXT PRIMARY KEY,
  "portfolioId" TEXT NOT NULL REFERENCES "Portfolio"(id),
  "stockId" TEXT NOT NULL REFERENCES "Stock"(id),
  type "TransactionType" NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  price DECIMAL(16,4) NOT NULL,
  fees DECIMAL(12,2) NOT NULL DEFAULT 0,
  "executedAt" TIMESTAMP NOT NULL,
  "recommendationId" TEXT REFERENCES "Recommendation"(id),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ON "Transaction"("portfolioId");
CREATE INDEX ON "Transaction"("stockId");

CREATE TABLE "AuditLog" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id),
  action TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  metadata JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX ON "AuditLog"("userId");
CREATE INDEX ON "AuditLog"("entityType", "entityId");
