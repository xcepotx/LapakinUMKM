"""Auto-schedule helpers — live open/close status based on Asia/Jakarta clock.

Supports:
  • Single-shift schedule entries   {"open": "HH:MM", "close": "HH:MM"}
  • Multi-shift schedule entries    {"shifts": [{"open": "HH:MM", "close": "HH:MM"}, ...]}
  • Temporary snooze                shop.snooze_until (ISO datetime)
  • Pre-order cutoff                shop.last_order_minutes_before_close (int)
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

JAKARTA_OFFSET = timedelta(hours=7)  # WIB
DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]


def _now_jakarta() -> datetime:
    return datetime.now(timezone.utc) + JAKARTA_OFFSET


def _parse_hhmm(s: str) -> Optional[tuple]:
    """Parse 'HH:MM' → (hour, minute). Returns None on failure."""
    if not s or not isinstance(s, str):
        return None
    try:
        parts = s.strip().split(":")
        if len(parts) != 2:
            return None
        h, m = int(parts[0]), int(parts[1])
        if 0 <= h <= 23 and 0 <= m <= 59:
            return (h, m)
    except Exception:
        return None
    return None


def _entry_shifts(entry: dict) -> list:
    """Normalise entry to list of shifts [{'open', 'close'}]. Empty if closed."""
    if not entry or not isinstance(entry, dict):
        return []
    if isinstance(entry.get("shifts"), list) and entry["shifts"]:
        out = []
        for sh in entry["shifts"]:
            if isinstance(sh, dict) and sh.get("open") and sh.get("close"):
                out.append({"open": sh["open"], "close": sh["close"]})
        return out
    # Legacy single shift
    if entry.get("open") and entry.get("close"):
        return [{"open": entry["open"], "close": entry["close"]}]
    return []


def _parse_iso_utc(s: Optional[str]) -> Optional[datetime]:
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def compute_schedule_status(shop: dict) -> dict:
    """Given a shop doc, compute live open/close status from schedule + Jakarta time.

    Returns dict {
        is_open_now: bool,
        auto: bool,
        opens_at: 'HH:MM' or 'Sen HH:MM',
        closes_at: 'HH:MM' (closing of current active shift),
        accepting_orders: bool (False when past last-order cutoff),
        last_order_at: 'HH:MM' (when in active shift),
        snoozed: bool,
        snooze_until_iso: ISO UTC (when snoozed),
    }

    Only schedule/cutoff logic is meaningful when shop.sells_by=='hours'.
    Snooze is honoured for sells_by in ('hours', 'always') — snooze also disables 'always'.
    """
    if not shop:
        return {"is_open_now": False}

    sells_by = shop.get("sells_by") or "stock"

    # Snooze check (works for hours + always modes)
    snooze_until = _parse_iso_utc(shop.get("snooze_until"))
    now_utc = datetime.now(timezone.utc)
    snoozed = bool(snooze_until and snooze_until > now_utc)

    if sells_by != "hours":
        # Non-hours modes: only snooze can close us
        return {
            "is_open_now": not snoozed,
            "auto": False,
            "snoozed": snoozed,
            "snooze_until_iso": shop.get("snooze_until") if snoozed else None,
            "accepting_orders": not snoozed,
        }

    if not shop.get("auto_schedule_enabled"):
        manual_open = bool(shop.get("is_open", True))
        return {
            "is_open_now": manual_open and not snoozed,
            "auto": False,
            "snoozed": snoozed,
            "snooze_until_iso": shop.get("snooze_until") if snoozed else None,
            "accepting_orders": manual_open and not snoozed,
        }

    schedule = shop.get("schedule") or []
    now = _now_jakarta()
    today_idx = now.weekday()  # 0=Mon..6=Sun
    today_min = now.hour * 60 + now.minute

    today_entry = schedule[today_idx] if today_idx < len(schedule) else None
    is_open_now = False
    closes_at = None
    active_close_min = None

    # Check each shift today
    for sh in _entry_shifts(today_entry):
        op = _parse_hhmm(sh["open"])
        cl = _parse_hhmm(sh["close"])
        if not op or not cl:
            continue
        op_min = op[0] * 60 + op[1]
        cl_min = cl[0] * 60 + cl[1]
        if op_min <= today_min < cl_min:
            is_open_now = True
            closes_at = sh["close"]
            active_close_min = cl_min
            break

    # Pre-order cutoff: past (close - cutoff) → no new orders
    cutoff_min = int(shop.get("last_order_minutes_before_close") or 0)
    accepting_orders = is_open_now
    last_order_at = None
    if is_open_now and cutoff_min > 0 and active_close_min is not None:
        last_order_at_min = active_close_min - cutoff_min
        last_order_at = f"{last_order_at_min // 60:02d}:{last_order_at_min % 60:02d}"
        if today_min >= last_order_at_min:
            accepting_orders = False

    # Find next opening (look ahead up to 7 days across all shifts)
    opens_at = None
    if not is_open_now:
        for offset in range(0, 8):
            d_idx = (today_idx + offset) % 7
            entry = schedule[d_idx] if d_idx < len(schedule) else None
            # Sort shifts by open time so earliest is picked
            shifts = sorted(
                _entry_shifts(entry),
                key=lambda s: _parse_hhmm(s["open"]) or (0, 0),
            )
            for sh in shifts:
                op = _parse_hhmm(sh["open"])
                if not op:
                    continue
                op_min = op[0] * 60 + op[1]
                if offset == 0 and op_min <= today_min:
                    continue
                day_label = DAY_LABELS[d_idx]
                opens_at = f"{day_label} {sh['open']}" if offset > 0 else sh["open"]
                break
            if opens_at:
                break

    # Snooze overrides: mark closed + accepting_orders False
    if snoozed:
        is_open_now = False
        accepting_orders = False

    return {
        "is_open_now": is_open_now,
        "auto": True,
        "opens_at": opens_at,
        "closes_at": closes_at,
        "accepting_orders": accepting_orders,
        "last_order_at": last_order_at,
        "snoozed": snoozed,
        "snooze_until_iso": shop.get("snooze_until") if snoozed else None,
    }
