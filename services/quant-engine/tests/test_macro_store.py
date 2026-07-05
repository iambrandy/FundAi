"""
Macro Event Store Tests
========================
Run with:
    python -m pytest tests/test_macro_store.py -v --tb=short
"""

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import tempfile
from datetime import date, timedelta
from pathlib import Path

from app.data.macro_events import (
    MacroEventStore,
    EVENT_RBI_MPC,
    EVENT_UNION_BUDGET,
    EVENT_GENERAL_ELECTION,
    _SEED_EVENTS,
)


@pytest.fixture
def store(tmp_path):
    """A fresh MacroEventStore backed by a temp DB for each test."""
    db = tmp_path / "test_macro.db"
    return MacroEventStore(db_path=db)


# ---------------------------------------------------------------------------
# Test 1: Seed populates known events
# ---------------------------------------------------------------------------

def test_seed_populates_known_events(store):
    """seed_from_hardcoded() must insert all hardcoded events."""
    inserted = store.seed_from_hardcoded()

    assert inserted == len(_SEED_EVENTS), (
        f"Expected {len(_SEED_EVENTS)} seeded events, got {inserted}"
    )

    # Specific events that must be present
    ctx = store.get_context_for_date("2025-04-09")
    assert "RBI" in ctx or "MPC" in ctx or "Monetary" in ctx, (
        f"Expected MPC context for 2025-04-09, got: {ctx}"
    )


def test_seed_is_idempotent(store):
    """Calling seed_from_hardcoded() twice must not duplicate rows."""
    first = store.seed_from_hardcoded()
    second = store.seed_from_hardcoded()
    assert second == 0, f"Second seed should insert 0 rows (idempotent), inserted {second}"


# ---------------------------------------------------------------------------
# Test 2: get_context_for_date returns event text near budget
# ---------------------------------------------------------------------------

def test_get_context_budget_week(store):
    """Querying Feb 1 (budget day) must return budget-related context."""
    store.seed_from_hardcoded()
    ctx = store.get_context_for_date("2026-02-01")
    assert "Budget" in ctx or "budget" in ctx, (
        f"Expected budget context near Feb 1, got: {ctx}"
    )


def test_get_context_mpc_decision_day(store):
    """Querying an MPC decision date must return MPC-related context."""
    store.seed_from_hardcoded()
    ctx = store.get_context_for_date("2025-06-06")  # MPC Meeting 2
    assert any(kw in ctx for kw in ["RBI", "MPC", "Monetary", "rate"]), (
        f"Expected MPC context for 2025-06-06, got: {ctx}"
    )


# ---------------------------------------------------------------------------
# Test 3: Standard (non-event) day returns default context
# ---------------------------------------------------------------------------

def test_get_context_standard_day(store):
    """Querying a day with no nearby events must return the default message."""
    store.seed_from_hardcoded()
    # 2026-07-15 is far from any seeded event
    ctx = store.get_context_for_date("2026-07-15")
    assert "No major scheduled" in ctx or "routine" in ctx or "Standard" in ctx, (
        f"Expected default context for quiet day, got: {ctx}"
    )


# ---------------------------------------------------------------------------
# Test 4: Staleness check warns when events are old
# ---------------------------------------------------------------------------

def test_staleness_check_warns_when_old(store):
    """
    If the latest event for an event_type is >90 days in the past,
    check_staleness() must return a non-empty warning for that type.
    """
    # Insert a single RBI_MPC event dated 100 days ago
    old_date = (date.today() - timedelta(days=100)).isoformat()
    store.upsert_events([{
        "event_type": EVENT_RBI_MPC,
        "event_date": old_date,
        "description": "Old MPC meeting",
        "confidence": 1.0,
    }])

    warnings = store.check_staleness(threshold_days=90)
    stale_types = [w["event_type"] for w in warnings]

    assert EVENT_RBI_MPC in stale_types, (
        f"Expected RBI_MPC in staleness warnings, got: {stale_types}"
    )

    # The warning should include diagnostic fields
    rbi_warning = next(w for w in warnings if w["event_type"] == EVENT_RBI_MPC)
    assert rbi_warning["days_since_latest"] is not None
    assert rbi_warning["days_since_latest"] >= 90


def test_staleness_check_passes_when_fresh(store):
    """If all events are recent, check_staleness() must return no warnings."""
    # Insert fresh events for all required types
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    store.upsert_events([
        {"event_type": EVENT_RBI_MPC,          "event_date": tomorrow, "description": "Upcoming MPC"},
        {"event_type": EVENT_UNION_BUDGET,      "event_date": tomorrow, "description": "Upcoming Budget"},
        {"event_type": EVENT_GENERAL_ELECTION,  "event_date": tomorrow, "description": "Upcoming Election"},
    ])

    warnings = store.check_staleness(threshold_days=90)
    assert len(warnings) == 0, f"Expected no staleness warnings for fresh events, got: {warnings}"


# ---------------------------------------------------------------------------
# Test 5: macro_context is batch-level (same string for all stocks)
# ---------------------------------------------------------------------------

def test_macro_context_is_date_not_stock_specific(store):
    """
    get_context_for_date() must return the same string for two calls
    with the same date — confirming it is date-level, not per-stock.

    This is the /score run_metadata contract: one call, one string,
    broadcast to all recommendations from the same run.
    """
    store.seed_from_hardcoded()
    date_str = "2025-04-09"

    ctx_a = store.get_context_for_date(date_str)
    ctx_b = store.get_context_for_date(date_str)

    assert ctx_a == ctx_b, (
        "get_context_for_date() returned different strings for the same date — "
        "the function is not deterministic, which would cause drift between stocks "
        "if called per-stock rather than once per batch."
    )


# ---------------------------------------------------------------------------
# Test 6: upsert_events updates existing rows correctly
# ---------------------------------------------------------------------------

def test_upsert_updates_existing_event(store):
    """Upserting an event with the same (event_type, event_date) must update, not duplicate."""
    store.upsert_events([{
        "event_type": EVENT_UNION_BUDGET,
        "event_date": "2027-02-01",
        "description": "Initial description",
    }])
    store.upsert_events([{
        "event_type": EVENT_UNION_BUDGET,
        "event_date": "2027-02-01",
        "description": "Updated description",
        "source_url": "https://example.gov.in",
        "confidence": 0.9,
    }])

    # Context for that date must reflect the updated description
    ctx = store.get_context_for_date("2027-02-01")
    assert "Updated description" in ctx, (
        f"Upsert did not update description. Got: {ctx}"
    )
