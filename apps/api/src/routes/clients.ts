import { Router } from "express";
import { z } from "zod";
import { getTenantPrisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { AuthedRequest } from "../middleware/requireAuth";

const router = Router();

const createClientSchema = z.object({
  displayName: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
});

router.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const { id: userId, role } = req.user!;
    const prisma = getTenantPrisma(userId, role);
    const clients = await prisma.client.findMany({
      include: { riskProfile: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(clients);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: AuthedRequest, res, next) => {
  try {
    const { id: userId, role } = req.user!;
    if (role !== "ADVISOR") {
      // Retail users already have exactly one auto-created Client — they
      // cannot create additional ones.
      throw new AppError(403, "Only advisors can create client records");
    }
    const parsed = createClientSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input");

    const prisma = getTenantPrisma(userId, role);
    const client = await prisma.client.create({
      data: { ...parsed.data, advisorId: userId, kycStatus: "PENDING" },
    });
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
});

// Explicit ownership check pattern — every single-resource route re-verifies
// that the tenant-scoped query actually returned a row before proceeding.
// The tenant-scoped Prisma extension is defense layer 1; this is layer 2.
router.get("/:clientId", async (req: AuthedRequest, res, next) => {
  try {
    const { id: userId, role } = req.user!;
    const prisma = getTenantPrisma(userId, role);
    const client = await prisma.client.findUnique({
      where: { id: req.params.clientId },
      include: { riskProfile: true, portfolios: true },
    });
    if (!client) throw new AppError(404, "Client not found");
    res.json(client);
  } catch (err) {
    next(err);
  }
});

export { router as clientsRouter };
