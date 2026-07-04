import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getSystemPrisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";

const router = Router();
const prisma = getSystemPrisma();

const BCRYPT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = "8h"; // financial app — shorter session than typical consumer apps

// Strict limiter on auth endpoints specifically — this is the #1 brute-force target
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later." },
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  fullName: z.string().min(1).max(200),
  role: z.enum(["ADVISOR", "RETAIL"]), // ADMIN can never self-register
});

router.post("/signup", authLimiter, async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input");
    }
    const { email, password, fullName, role } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Same generic message as any other signup error — don't confirm
      // whether an email is already registered (user enumeration protection).
      throw new AppError(400, "Unable to create account with provided details");
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: { email, passwordHash, fullName, role },
    });

    // Retail users get their own Client record automatically —
    // they ARE their own client in the data model.
    if (role === "RETAIL") {
      await prisma.client.create({
        data: { retailUserId: user.id, displayName: fullName, kycStatus: "PENDING" },
      });
    }

    const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid credentials"); // generic — don't leak validation specifics on login
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });

    // Constant-time-ish flow: always run bcrypt.compare even if user not found,
    // using a dummy hash, so response timing doesn't reveal whether the email exists.
    const hashToCompare = user?.passwordHash ?? "$2b$12$invalidsaltinvalidsaltinvalidsalthashdummydummydummy";
    const passwordMatches = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatches) {
      throw new AppError(401, "Invalid credentials");
    }

    const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});

export { router as authRouter };
