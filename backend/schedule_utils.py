"""Auto-schedule helpers — live open/close status based on Asia/Jakarta clock."""
from datetime import datetime, timezone, timedelta
from typing import Optional

JAKARTA_OFFSET = timedelta(hours=7)  # WIB


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


def compute_schedule_status(shop: dict) -> dict:
    """Given a shop doc, compute live open/close status from schedule + Jakarta time.
    Returns dict {is_open_now, opens_at, closes_at, auto}.
    Only meaningful when shop.sells_by=='hours' and shop.auto_schedule_enabled==True."""
    if not shop:
        return {"is_open_now": False}
    if (shop.get("sells_by") or "stock") != "hours":
        return {"is_open_now": True, "auto": False}
    if not shop.get("auto_schedule_enabled"):
        return {"is_open_now": bool(shop.get("is_open", True)), "auto": False}

    schedule = shop.get("schedule") or []
    now = _now_jakarta()
    today_idx = now.weekday()  # 0=Mon..6=Sun
    today_min = now.hour * 60 + now.minute

    today_entry = schedule[today_idx] if today_idx < len(schedule) else None
    is_open_now = False
    closes_at = None
    if today_entry and isinstance(today_entry, dict):
        op = _parse_hhmm(today_entry.get("open", ""))
        cl = _parse_hhmm(today_entry.get("close", ""))
        if op and cl:
            op_min = op[0] * 60 + op[1]
            cl_min = cl[0] * 60 + cl[1]
            if op_min <= today_min < cl_min:
                is_open_now = True
                closes_at = today_entry["close"]

    # Find next opening (look ahead up to 7 days)
    opens_at = None
    if not is_open_now:
        for offset in range(0, 8):
            d_idx = (today_idx + offset) % 7
            entry = schedule[d_idx] if d_idx < len(schedule) else None
            if not entry or not isinstance(entry, dict):
                continue
            op = _parse_hhmm(entry.get("open", ""))
            if not op:
                continue
            op_min = op[0] * 60 + op[1]
            if offset == 0 and op_min <= today_min:
                continue  # today already passed open time
            day_label = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"][d_idx]
            opens_at = f"{day_label} {entry['open']}" if offset > 0 else entry["open"]
            break

    return {
        "is_open_now": is_open_now,
        "auto": True,
        "opens_at": opens_at,
        "closes_at": closes_at,
    }
