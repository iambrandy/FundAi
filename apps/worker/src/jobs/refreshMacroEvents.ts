/**
 * Refresh Macro Events Job
 * ========================
 * Weekly BullMQ job (Sunday 18:00 IST, before Monday market open).
 * Calls the quant engine's /refresh-macro-events endpoint to:
 *   1. Seed any missing hardcoded events (idempotent)
 *   2. Run staleness checks on all event types
 *   3. Write SystemEvent rows for any stale event types so they
 *      surface in the admin dashboard rather than being buried in logs
 *
 * Macro context is date-based — same for all stocks scored on a given day.
 * This job does NOT run per-recommendation; it runs once weekly to keep
 * the store current and alert the operator when manual re-seeding is due.
 *
 * MAINTENANCE SCHEDULE (documented, not assumed):
 *   - RBI MPC dates:     Seed each April when RBI announces the annual schedule.
 *   - Union Budget:      Seed each January (Budget day is typically Feb 1).
 *   - General Election:  Seed when ECI announces the election schedule.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const QUANT_ENGINE_URL = process.env.QUANT_ENGINE_URL ?? "http://localhost:8001";
const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? "";

export async function runMacroEventsRefresh(): Promise<{
  seeded: number;
  warnings: number;
  staleTypes: string[];
}> {
  console.log("[macro_refresh] Starting weekly macro events refresh...");

  let seededEvents = 0;
  let warnings: { event_type: string; message: string }[] = [];

  try {
    const res = await fetch(`${QUANT_ENGINE_URL}/refresh-macro-events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
    });

    if (!res.ok) {
      throw new Error(`/refresh-macro-events returned HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      seeded_events: number;
      staleness_warnings: { event_type: string; message: string; days_since_latest: number | null }[];
      warning_count: number;
    };

    seededEvents = body.seeded_events;
    warnings = body.staleness_warnings ?? [];

    console.log(
      `[macro_refresh] Seeded ${seededEvents} events. ${warnings.length} staleness warning(s).`
    );
  } catch (err) {
    // Log the failure as a SystemEvent so it's visible in the admin dashboard
    console.error("[macro_refresh] Failed to call /refresh-macro-events:", err);
    await _writeSystemEvent(
      "PIPELINE_ERROR",
      "ERROR",
      `macro_refresh job failed to reach quant engine: ${err instanceof Error ? err.message : String(err)}`
    );
    return { seeded: 0, warnings: 0, staleTypes: [] };
  }

  // Write a SystemEvent for each stale event type
  const staleTypes: string[] = [];
  for (const w of warnings) {
    staleTypes.push(w.event_type);
    await _writeSystemEvent(
      "MACRO_STALENESS_ALERT",
      "WARN",
      w.message,
      JSON.stringify(w)
    );
    console.warn(`[macro_refresh] STALE: ${w.event_type} — ${w.message}`);
  }

  console.log(`[macro_refresh] Done. Stale event types: ${staleTypes.length > 0 ? staleTypes.join(", ") : "none"}`);
  return { seeded: seededEvents, warnings: warnings.length, staleTypes };
}

async function _writeSystemEvent(
  eventType: string,
  severity: "INFO" | "WARN" | "ERROR",
  message: string,
  metadata?: string
): Promise<void> {
  try {
    // SystemEvent model is a raw SQLite table (no Prisma model yet pending migration).
    // Use prisma.$executeRaw until the migration adds the model.
    await prisma.$executeRaw`
      INSERT INTO SystemEvent (id, eventType, severity, message, metadata, createdAt)
      VALUES (
        lower(hex(randomblob(16))),
        ${eventType},
        ${severity},
        ${message},
        ${metadata ?? null},
        datetime('now')
      )
    `;
  } catch (err) {
    // If SystemEvent table doesn't exist yet (pre-migration), fall back to log-only.
    console.error(`[macro_refresh] Could not write SystemEvent (table may not exist yet):`, err);
  }
}
