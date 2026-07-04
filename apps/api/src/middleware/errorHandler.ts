import { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Never leak internals (stack traces, DB errors, file paths) to the client —
  // this is a financial app; error messages are a real info-disclosure risk.
  console.error("[unhandled error]", err);
  return res.status(500).json({ error: "Internal server error" });
}
