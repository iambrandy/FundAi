import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getTenantPrisma, getSystemPrisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { AuthedRequest } from "../middleware/requireAuth";

const router = Router();

router.get("/portfolio/:portfolioId", async (req: AuthedRequest, res, next) => {
  try {
    const { id: userId, role } = req.user!;
    const prisma = getTenantPrisma(userId, role);

    const portfolio = await prisma.portfolio.findUnique({ where: { id: req.params.portfolioId } });
    if (!portfolio) throw new AppError(404, "Portfolio not found");

    const recs = await getSystemPrisma().recommendation.findMany({
      where: { portfolioId: portfolio.id },
      include: { modelPortfolio: true },
      orderBy: { generatedAt: "desc" },
    });
    res.json(recs);
  } catch (err) {
    next(err);
  }
});

const approveSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
});

/**
 * This is the single most important route in the platform from a compliance
 * standpoint: a Recommendation only becomes a Transaction here, after
 * explicit human approval, and only the owning tenant can approve it.
 *
 * No route in this API creates a Transaction directly from AI output —
 * every trade must pass through this gate.
 */
router.post("/:recommendationId/decide", async (req: AuthedRequest, res, next) => {
  try {
    const { id: userId, role } = req.user!;
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "decision must be APPROVED or REJECTED");

    const tenantPrisma = getTenantPrisma(userId, role);
    const systemPrisma = getSystemPrisma();

    const rec = await systemPrisma.recommendation.findUnique({
      where: { id: req.params.recommendationId },
      include: { portfolio: true },
    });
    if (!rec) throw new AppError(404, "Recommendation not found");

    // Ownership check via tenant-scoped query on the parent portfolio —
    // this is the layer-2 check again; never trust the recommendationId
    // alone as proof of ownership.
    const ownedPortfolio = await tenantPrisma.portfolio.findUnique({
      where: { id: rec.portfolioId },
    });
    if (!ownedPortfolio) throw new AppError(404, "Recommendation not found");

    if (rec.status !== "PENDING") {
      throw new AppError(409, `Recommendation already ${rec.status.toLowerCase()}`);
    }
    if (rec.expiresAt && rec.expiresAt < new Date()) {
      await systemPrisma.recommendation.update({
        where: { id: rec.id },
        data: { status: "EXPIRED" },
      });
      throw new AppError(410, "Recommendation has expired and can no longer be actioned");
    }

    const decision = parsed.data.decision;

    const result = await systemPrisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.recommendation.update({
        where: { id: rec.id },
        data: { status: decision, reviewedByUserId: userId, reviewedAt: new Date() },
      });

      if (decision === "APPROVED" && rec.stockId && rec.suggestedQuantity) {
        await tx.transaction.create({
          data: {
            portfolioId: rec.portfolioId,
            stockId: rec.stockId,
            type: rec.action === "SELL" ? "SELL" : "BUY",
            quantity: rec.suggestedQuantity,
            price: 0, // NOTE: must be filled from live market price at execution time —
            // placeholder here; real execution flow prices this at broker fill time.
            executedAt: new Date(),
            recommendationId: rec.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: decision === "APPROVED" ? "RECOMMENDATION_APPROVED" : "RECOMMENDATION_REJECTED",
          entityType: "Recommendation",
          entityId: rec.id,
          metadata: { portfolioId: rec.portfolioId, action: rec.action },
        },
      });

      return updated;
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { router as recommendationsRouter };
