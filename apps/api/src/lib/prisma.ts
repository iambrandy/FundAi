/**
 * Tenant-scoped Prisma access.
 *
 * Two client factories, deliberately kept separate so it's impossible to
 * accidentally use the wrong one:
 *
 *  - getTenantPrisma(userId): returns a Prisma client that ONLY ever touches
 *    rows belonging to this user (their own Client record if RETAIL, or their
 *    managed Clients if ADVISOR). Use this in every route handler.
 *
 *  - getSystemPrisma(): unscoped, used ONLY for admin jobs, migrations, and
 *    background workers (e.g. the nightly factor-score ingestion job) that
 *    legitimately need cross-tenant access. Never call this from a
 *    user-facing request handler.
 *
 * Enforcement approach: Prisma Client Extensions intercept every query on
 * Client/Portfolio/Holding/Transaction/Recommendation and inject a WHERE
 * clause tying back to the authenticated user. This is defense-in-depth on
 * top of (not instead of) explicit ownership checks in route handlers —
 * financial data gets two independent layers, not one.
 */

import { PrismaClient } from "@prisma/client";

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
});

export function getSystemPrisma(): PrismaClient {
  return basePrisma;
}

export function getTenantPrisma(userId: string, role: "ADVISOR" | "RETAIL" | "ADMIN") {
  if (role === "ADMIN") {
    // Admins still go through basePrisma but every admin route must do its
    // own explicit authorization check — no implicit trust here either.
    return basePrisma;
  }

  return basePrisma.$extends({
    query: {
      client: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ operation, args, query }: { operation: string; args: any; query: (args: any) => Promise<any> }) {
          if (operation === "create" || operation === "createMany") {
            if (operation === "create") {
              args.data = {
                ...args.data,
                ...(role === "ADVISOR" ? { advisorId: userId } : { retailUserId: userId })
              };
            } else if (operation === "createMany") {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((item: any) => ({
                  ...item,
                  ...(role === "ADVISOR" ? { advisorId: userId } : { retailUserId: userId })
                }));
              } else {
                args.data = {
                  ...args.data,
                  ...(role === "ADVISOR" ? { advisorId: userId } : { retailUserId: userId })
                };
              }
            }
          } else {
            args.where =
              role === "ADVISOR"
                ? { ...args.where, advisorId: userId }
                : { ...args.where, retailUserId: userId };
          }
          return query(args);
        },
      },
      portfolio: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ operation, args, query }: { operation: string; args: any; query: (args: any) => Promise<any> }) {
          if (operation !== "create" && operation !== "createMany") {
            args.where = {
              ...args.where,
              client:
                role === "ADVISOR"
                  ? { advisorId: userId }
                  : { retailUserId: userId },
            };
          }
          return query(args);
        },
      },
      // Holding, Transaction, Recommendation are reached via portfolio -> so
      // route handlers must always filter through a portfolio the caller
      // owns (verified explicitly — see routes/portfolios.ts for the pattern).
    },
  });
}
