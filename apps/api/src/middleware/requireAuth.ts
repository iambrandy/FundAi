import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthedRequest extends Request {
  user?: {
    id: string;
    role: "ADVISOR" | "RETAIL" | "ADMIN";
    email: string;
  };
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV !== "test") {
  // Fail loudly at boot rather than silently signing tokens with `undefined`
  throw new Error("JWT_SECRET is not set — refusing to start.");
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as {
      sub: string;
      role: "ADVISOR" | "RETAIL" | "ADMIN";
      email: string;
    };
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Extra guard for routes that must never be reachable by ADVISOR/RETAIL, e.g. admin data ingestion triggers. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
