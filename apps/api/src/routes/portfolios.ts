import { Router } from "express";
import { z } from "zod";
import { getTenantPrisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { AuthedRequest } from "../middleware/requireAuth";

const router = Router();

const createPortfolioSchema = z.object({
  clientId: z.string().cuid(),
  name: z.string().min(1).max(200),
  baseCurrency: z.string().length(3).default("INR"),
});

router.post("/", async (req: AuthedRequest, res, next) => {
  try {
    const { id: userId, role } = req.user!;
    const parsed = createPortfolioSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input");

    const prisma = getTenantPrisma(userId, role);

    // Verify the client belongs to this tenant BEFORE creating the portfolio —
    // otherwise a malicious clientId from another tenant would silently fail
    // the FK or, worse, succeed if the extension didn't cover this exact query shape.
    const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId } });
    if (!client) throw new AppError(404, "Client not found");

    const portfolio = await prisma.portfolio.create({
      data: {
        clientId: parsed.data.clientId,
        name: parsed.data.name,
        baseCurrency: parsed.data.baseCurrency,
      },
    });
    res.status(201).json(portfolio);
  } catch (err) {
    next(err);
  }
});

router.get("/:portfolioId", async (req: AuthedRequest, res, next) => {
  try {
    const { id: userId, role } = req.user!;
    const prisma = getTenantPrisma(userId, role);
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: req.params.portfolioId },
      include: {
        holdings: { include: { stock: true } },
        client: true,
      },
    });
    if (!portfolio) throw new AppError(404, "Portfolio not found");
    res.json(portfolio);
  } catch (err) {
    next(err);
  }
});

export { router as portfoliosRouter };
