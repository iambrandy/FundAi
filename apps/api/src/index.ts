import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { authRouter } from "./routes/auth";
import { clientsRouter } from "./routes/clients";
import { portfoliosRouter } from "./routes/portfolios";
import { recommendationsRouter } from "./routes/recommendations";
import { marketRouter } from "./routes/market";
import { requireAuth } from "./middleware/requireAuth";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

// --- Security baseline ---
app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_APP_ORIGIN?.split(",") ?? [],
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" })); // cap body size; financial payloads are small

// Global rate limit — tighter limits applied per-route below for sensitive ops
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Public routes ---
app.use("/api/auth", authRouter);

// --- Authenticated routes (JWT required, tenant-scoped Prisma client attached) ---
app.use("/api/clients", requireAuth, clientsRouter);
app.use("/api/portfolios", requireAuth, portfoliosRouter);
app.use("/api/recommendations", requireAuth, recommendationsRouter);
app.use("/api/market", requireAuth, marketRouter); // NEW: Market intelligence endpoints

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Must be last
app.use(errorHandler);

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});

export default app;
