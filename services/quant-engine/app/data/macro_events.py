"""
Macro Event Store
=================
SQLite-backed store for macro calendar events (RBI MPC meetings,
Union Budgets, General Elections, State Elections).

Design decisions:
- All events are manually seeded. No automated scraper.
  RBI and PIB press release pages both require JavaScript rendering —
  confirmed by live fetch. Named as a human responsibility, not hidden.
- 90-day staleness alert surfaces to SystemEvent via internal API, making
  the maintenance gap visible in the admin dashboard.
- get_context_for_date() has the same return signature as the old
  get_geopolitical_macro_context() — zero call-site changes required.
- macro_context is frozen at recommendation generation time by including
  it in run_metadata from the /score endpoint.

Maintenance schedule (documented, not assumed):
  - RBI MPC dates:    Seed every April when RBI announces the annual schedule.
  - Union Budget:     Seed every January (Budget day is typically Feb 1).
  - General Election: Seed when ECI announces election schedule.
  - State Elections:  Seed per-state when ECI announces.
"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DB path — defaults to local file, overridable via env var
# ---------------------------------------------------------------------------

import os
_DEFAULT_DB_PATH = Path(os.environ.get(
    "MACRO_DB_PATH",
    str(Path(__file__).parent.parent.parent / "macro_events.db"),
))


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS macro_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT NOT NULL,
    event_date  TEXT NOT NULL,       -- ISO date YYYY-MM-DD
    description TEXT NOT NULL,
    source_url  TEXT,
    confidence  REAL DEFAULT 1.0,    -- 1.0=manual, 0.9=scraped, 0.6=inferred
    ingested_at TEXT NOT NULL,
    UNIQUE(event_type, event_date)   -- upsert-safe
);
"""

# Event types
EVENT_RBI_MPC         = "RBI_MPC"
EVENT_UNION_BUDGET    = "UNION_BUDGET"
EVENT_GENERAL_ELECTION = "GENERAL_ELECTION"
EVENT_STATE_ELECTION  = "STATE_ELECTION"
EVENT_OTHER           = "OTHER"

ALL_EVENT_TYPES = [
    EVENT_RBI_MPC,
    EVENT_UNION_BUDGET,
    EVENT_GENERAL_ELECTION,
]

# ---------------------------------------------------------------------------
# Hardcoded seed data
# (replaces old heuristic in get_geopolitical_macro_context)
# ---------------------------------------------------------------------------

_SEED_EVENTS = [
    # --- RBI MPC FY2025-26 ---
    # Source: RBI annual schedule (manually seeded; update each April)
    # Note: Aug meeting rescheduled from 5-7 to 4-6 due to administrative reasons
    (EVENT_RBI_MPC, "2025-04-09", "RBI MPC Decision — FY2025-26 Meeting 1 (Apr 7–9, 2025)"),
    (EVENT_RBI_MPC, "2025-06-06", "RBI MPC Decision — FY2025-26 Meeting 2 (Jun 4–6, 2025)"),
    (EVENT_RBI_MPC, "2025-08-06", "RBI MPC Decision — FY2025-26 Meeting 3 (Aug 4–6, 2025)"),
    (EVENT_RBI_MPC, "2025-10-01", "RBI MPC Decision — FY2025-26 Meeting 4 (Sep 29–Oct 1, 2025)"),
    (EVENT_RBI_MPC, "2025-12-05", "RBI MPC Decision — FY2025-26 Meeting 5 (Dec 3–5, 2025)"),
    (EVENT_RBI_MPC, "2026-02-06", "RBI MPC Decision — FY2025-26 Meeting 6 (Feb 4–6, 2026)"),

    # --- Union Budget ---
    (EVENT_UNION_BUDGET, "2025-02-01", "Union Budget FY2025-26 — presented by Finance Minister"),
    (EVENT_UNION_BUDGET, "2026-02-01", "Union Budget FY2026-27 — presented by Finance Minister"),

    # --- General Elections ---
    (EVENT_GENERAL_ELECTION, "2024-06-04", "18th Lok Sabha General Election — Results Day"),

    # --- State Elections (major, market-moving) ---
    (EVENT_STATE_ELECTION, "2024-11-23", "Maharashtra & Jharkhand State Assembly Elections — Results"),
    (EVENT_STATE_ELECTION, "2025-02-08", "Delhi State Assembly Election — Results"),
]

# ---------------------------------------------------------------------------
# Store class
# ---------------------------------------------------------------------------

class MacroEventStore:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or _DEFAULT_DB_PATH
        self._ensure_schema()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _ensure_schema(self) -> None:
        with self._conn() as conn:
            conn.execute(_SCHEMA)

    # -----------------------------------------------------------------------
    # Seed
    # -----------------------------------------------------------------------

    def seed_from_hardcoded(self) -> int:
        """
        Migrate all hardcoded events into the store.
        Uses INSERT OR IGNORE so repeated calls are idempotent.
        Returns the number of newly inserted rows.
        """
        now = datetime.now(timezone.utc).isoformat()
        inserted = 0
        with self._conn() as conn:
            for event_type, event_date, description in _SEED_EVENTS:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO macro_events
                       (event_type, event_date, description, source_url, confidence, ingested_at)
                       VALUES (?, ?, ?, NULL, 1.0, ?)""",
                    (event_type, event_date, description, now),
                )
                inserted += cur.rowcount
        logger.info("[macro_store] Seeded %d new events", inserted)
        return inserted

    # -----------------------------------------------------------------------
    # Upsert (used by future scrapers or manual updates)
    # -----------------------------------------------------------------------

    def upsert_events(self, events: list[dict]) -> int:
        """
        Upsert a list of events.  Each dict must have:
            event_type, event_date, description
        Optional: source_url, confidence (default 1.0)
        """
        now = datetime.now(timezone.utc).isoformat()
        upserted = 0
        with self._conn() as conn:
            for ev in events:
                conn.execute(
                    """INSERT INTO macro_events
                          (event_type, event_date, description, source_url, confidence, ingested_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(event_type, event_date)
                       DO UPDATE SET
                           description = excluded.description,
                           source_url  = excluded.source_url,
                           confidence  = excluded.confidence,
                           ingested_at = excluded.ingested_at""",
                    (
                        ev["event_type"],
                        ev["event_date"],
                        ev["description"],
                        ev.get("source_url"),
                        ev.get("confidence", 1.0),
                        now,
                    ),
                )
                upserted += 1
        logger.info("[macro_store] Upserted %d events", upserted)
        return upserted

    # -----------------------------------------------------------------------
    # Query
    # -----------------------------------------------------------------------

    def get_context_for_date(self, query_date) -> str:
        """
        Return a macro context string for recommendations generated on query_date.

        Looks for events within ±14 days of the query date.
        Same return type as the old get_geopolitical_macro_context() —
        no call-site changes required.
        """
        if isinstance(query_date, str):
            d = date.fromisoformat(query_date[:10])
        elif isinstance(query_date, datetime):
            d = query_date.date()
        else:
            d = query_date  # assume date

        window_start = (d - timedelta(days=14)).isoformat()
        window_end   = (d + timedelta(days=14)).isoformat()

        with self._conn() as conn:
            rows = conn.execute(
                """SELECT event_type, event_date, description
                   FROM macro_events
                   WHERE event_date BETWEEN ? AND ?
                   ORDER BY event_date""",
                (window_start, window_end),
            ).fetchall()

        if not rows:
            return (
                "No major scheduled macro events (RBI MPC, Union Budget, elections) "
                "detected within the next 14 days. Market conditions appear routine."
            )

        parts = []
        for row in rows:
            event_date_str = row["event_date"]
            days_away = (date.fromisoformat(event_date_str) - d).days
            timing = (
                f"{abs(days_away)} days ago" if days_away < 0
                else "today" if days_away == 0
                else f"in {days_away} days"
            )
            parts.append(f"• {row['description']} ({timing})")

        return (
            "Macro calendar context:\n" + "\n".join(parts) + "\n"
            "Factor scores and recommendations should be interpreted in light of these events."
        )

    # -----------------------------------------------------------------------
    # Staleness check
    # -----------------------------------------------------------------------

    def check_staleness(self, threshold_days: int = 90) -> list[dict]:
        """
        Returns a warning dict for each event_type whose most recent event
        is older than threshold_days.

        Callers should write these to SystemEvent so they surface in the
        admin dashboard rather than being buried in worker logs.
        """
        warnings = []
        cutoff = (date.today() - timedelta(days=threshold_days)).isoformat()

        with self._conn() as conn:
            for event_type in ALL_EVENT_TYPES:
                row = conn.execute(
                    """SELECT MAX(event_date) as latest
                       FROM macro_events
                       WHERE event_type = ?""",
                    (event_type,),
                ).fetchone()

                latest = row["latest"] if row else None
                if latest is None or latest < cutoff:
                    days_stale = (
                        (date.today() - date.fromisoformat(latest)).days
                        if latest else None
                    )
                    msg = (
                        f"[macro_store] {event_type} events are stale: "
                        f"latest={latest}, days_since={days_stale}. "
                        f"Seed new dates before the next event window."
                    )
                    logger.warning(msg)
                    warnings.append({
                        "event_type": event_type,
                        "latest_event_date": latest,
                        "days_since_latest": days_stale,
                        "threshold_days": threshold_days,
                        "message": msg,
                    })

        return warnings
