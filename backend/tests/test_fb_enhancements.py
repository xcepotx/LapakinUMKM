"""
Tests for F&B enhancements: snooze, multi-shift schedule, pre-order cutoff.
Pure-unit (no HTTP) — exercises schedule_utils.compute_schedule_status().
"""
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from schedule_utils import compute_schedule_status, _now_jakarta  # type: ignore


def _fix_now_jakarta(year, month, day, hour, minute):
    """Patch _now_jakarta() to return a fixed time."""
    fixed = datetime(year, month, day, hour, minute)
    return patch("schedule_utils._now_jakarta", return_value=fixed)


def _shop(**overrides):
    base = {
        "sells_by": "hours",
        "auto_schedule_enabled": True,
        "schedule": [None] * 7,
        "is_open": True,
    }
    base.update(overrides)
    return base


# ----- Snooze -----
def test_snooze_active_closes_shop():
    until = (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()
    shop = _shop(snooze_until=until, sells_by="always")
    s = compute_schedule_status(shop)
    assert s["snoozed"] is True
    assert s["is_open_now"] is False
    assert s["accepting_orders"] is False


def test_snooze_expired_does_not_close():
    until = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    shop = _shop(snooze_until=until, sells_by="always")
    s = compute_schedule_status(shop)
    assert s["snoozed"] is False
    assert s["is_open_now"] is True


def test_snooze_overrides_open_hours():
    """Even when within shop hours, snooze closes the shop."""
    until = (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()
    schedule = [{"open": "00:00", "close": "23:59"}] * 7  # always open
    shop = _shop(schedule=schedule, snooze_until=until)
    # Use real Jakarta time — 00:00–23:59 covers any time
    s = compute_schedule_status(shop)
    assert s["snoozed"] is True
    assert s["is_open_now"] is False


# ----- Multi-shift -----
def test_multi_shift_open_in_first_shift():
    # Monday 11:00 → in shift 1 (08:00-14:00)
    schedule = [None] * 7
    schedule[0] = {"shifts": [
        {"open": "08:00", "close": "14:00"},
        {"open": "17:00", "close": "21:00"},
    ]}
    shop = _shop(schedule=schedule)
    with _fix_now_jakarta(2026, 5, 4, 11, 0):  # Mon 11:00
        s = compute_schedule_status(shop)
    assert s["is_open_now"] is True
    assert s["closes_at"] == "14:00"


def test_multi_shift_closed_between_shifts():
    # Monday 15:00 → between shift 1 (closes 14:00) and shift 2 (opens 17:00)
    schedule = [None] * 7
    schedule[0] = {"shifts": [
        {"open": "08:00", "close": "14:00"},
        {"open": "17:00", "close": "21:00"},
    ]}
    shop = _shop(schedule=schedule)
    with _fix_now_jakarta(2026, 5, 4, 15, 0):  # Mon 15:00
        s = compute_schedule_status(shop)
    assert s["is_open_now"] is False
    assert s["opens_at"] == "17:00"  # next is shift 2 today


def test_multi_shift_open_in_second_shift():
    schedule = [None] * 7
    schedule[0] = {"shifts": [
        {"open": "08:00", "close": "14:00"},
        {"open": "17:00", "close": "21:00"},
    ]}
    shop = _shop(schedule=schedule)
    with _fix_now_jakarta(2026, 5, 4, 18, 30):  # Mon 18:30
        s = compute_schedule_status(shop)
    assert s["is_open_now"] is True
    assert s["closes_at"] == "21:00"


def test_legacy_single_shift_still_works():
    schedule = [None] * 7
    schedule[0] = {"open": "08:00", "close": "21:00"}  # legacy format
    shop = _shop(schedule=schedule)
    with _fix_now_jakarta(2026, 5, 4, 12, 0):  # Mon noon
        s = compute_schedule_status(shop)
    assert s["is_open_now"] is True
    assert s["closes_at"] == "21:00"


# ----- Pre-order cutoff -----
def test_cutoff_not_yet_reached_still_accepting():
    schedule = [None] * 7
    schedule[0] = {"open": "08:00", "close": "21:00"}
    shop = _shop(schedule=schedule, last_order_minutes_before_close=30)
    with _fix_now_jakarta(2026, 5, 4, 19, 0):  # 19:00, cutoff 20:30
        s = compute_schedule_status(shop)
    assert s["is_open_now"] is True
    assert s["accepting_orders"] is True
    assert s["last_order_at"] == "20:30"


def test_cutoff_reached_stops_orders():
    schedule = [None] * 7
    schedule[0] = {"open": "08:00", "close": "21:00"}
    shop = _shop(schedule=schedule, last_order_minutes_before_close=30)
    with _fix_now_jakarta(2026, 5, 4, 20, 45):  # past 20:30
        s = compute_schedule_status(shop)
    assert s["is_open_now"] is True       # still open
    assert s["accepting_orders"] is False  # but no new orders
    assert s["last_order_at"] == "20:30"


def test_cutoff_zero_means_no_cutoff():
    schedule = [None] * 7
    schedule[0] = {"open": "08:00", "close": "21:00"}
    shop = _shop(schedule=schedule, last_order_minutes_before_close=0)
    with _fix_now_jakarta(2026, 5, 4, 20, 59):
        s = compute_schedule_status(shop)
    assert s["accepting_orders"] is True
    assert s["last_order_at"] is None
