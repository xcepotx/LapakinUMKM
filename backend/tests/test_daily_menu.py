"""
Tests for daily-menu bulk update endpoint (Pro/Bisnis only).
"""
import os
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _register_with_shop_and_tier(tier: str = "pro"):
    email = f"dm_test_{uuid.uuid4().hex[:8]}@example.com"
    httpx.post(f"{API}/auth/register",
               json={"email": email, "password": "testpass12", "name": "DM Test"}, timeout=10)
    r = httpx.post(f"{API}/auth/login", json={"email": email, "password": "testpass12"}, timeout=10)
    token = r.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}

    # Create shop
    r = httpx.post(f"{API}/shops/me", headers=h,
                   json={"name": f"DM Shop {uuid.uuid4().hex[:6]}",
                         "whatsapp": "+6281234567890",
                         "business_type": "kuliner"}, timeout=10)
    assert r.status_code in (200, 201)
    shop_slug = r.json()["slug"]

    # Force tier in DB
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _force():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.users.update_one(
            {"email": email},
            {"$set": {"tier": tier, "trial": False, "trial_expires_at": None}},
        )
    asyncio.run(_force())

    # Create 2 products
    pids = []
    for name in ["Nasi Pecel", "Gado-gado"]:
        r = httpx.post(f"{API}/products", headers=h,
                       json={"name": name, "price": 15000, "description": "yum", "stock": 100},
                       timeout=10)
        assert r.status_code in (200, 201), r.text
        pids.append(r.json()["product_id"])
    return token, h, pids, shop_slug


def test_daily_menu_requires_auth():
    r = httpx.put(f"{API}/products/daily-menu", json={"updates": []}, timeout=10)
    assert r.status_code == 401


def test_daily_menu_blocked_for_free():
    _, h, pids, _ = _register_with_shop_and_tier(tier="free")
    r = httpx.put(f"{API}/products/daily-menu",
                  headers=h,
                  json={"updates": [{"product_id": pids[0], "available_days": [0, 1]}]},
                  timeout=10)
    assert r.status_code == 402


def test_daily_menu_pro_can_update():
    _, h, pids, _ = _register_with_shop_and_tier(tier="pro")
    r = httpx.put(f"{API}/products/daily-menu",
                  headers=h,
                  json={"updates": [
                      {"product_id": pids[0], "available_days": [0, 1, 2]},
                      {"product_id": pids[1], "available_days": [3, 4, 5, 6]},
                  ]},
                  timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["total"] == 2

    # Verify persisted
    r = httpx.get(f"{API}/products", headers=h, timeout=10)
    items = r.json()["items"] if isinstance(r.json(), dict) else r.json()
    by_id = {p["product_id"]: p for p in items}
    assert by_id[pids[0]]["available_days"] == [0, 1, 2]
    assert by_id[pids[1]]["available_days"] == [3, 4, 5, 6]


def test_daily_menu_business_unlimited_works():
    _, h, pids, _ = _register_with_shop_and_tier(tier="business")
    r = httpx.put(f"{API}/products/daily-menu",
                  headers=h,
                  json={"updates": [{"product_id": pids[0], "available_days": []}]},
                  timeout=10)
    assert r.status_code == 200


def test_daily_menu_invalid_days_filtered():
    """Out-of-range day numbers are silently dropped, not error."""
    _, h, pids, _ = _register_with_shop_and_tier(tier="pro")
    r = httpx.put(f"{API}/products/daily-menu",
                  headers=h,
                  json={"updates": [{"product_id": pids[0], "available_days": [0, 9, 99, -1, 5]}]},
                  timeout=10)
    assert r.status_code == 200
    items = httpx.get(f"{API}/products", headers=h, timeout=10).json()
    items = items["items"] if isinstance(items, dict) else items
    target = [p for p in items if p["product_id"] == pids[0]][0]
    assert target["available_days"] == [0, 5]


def test_daily_menu_empty_updates_rejected():
    _, h, _, _ = _register_with_shop_and_tier(tier="pro")
    r = httpx.put(f"{API}/products/daily-menu", headers=h, json={"updates": []}, timeout=10)
    assert r.status_code == 400
