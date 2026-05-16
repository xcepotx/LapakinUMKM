import asyncio

import pytest
from fastapi import HTTPException

from routes import shops as shop_routes


class FakeShopsCollection:
    def __init__(self, used_count):
        self.used_count = used_count
        self.last_query = None

    async def count_documents(self, query):
        self.last_query = query
        return self.used_count


class FakeDB:
    def __init__(self, used_count):
        self.shops = FakeShopsCollection(used_count)


async def fake_suspended_pro_effective_tier(user):
    return {
        "plan": "pro",
        "status": "suspended",
        "shop_limit": 1,
    }


def test_phase_e_owner_shop_limit_counts_only_manageable_shops(monkeypatch):
    fake_db = FakeDB(used_count=1)

    monkeypatch.setattr(shop_routes, "db", fake_db)
    monkeypatch.setattr(
        shop_routes,
        "_downgrade_effective_tier",
        fake_suspended_pro_effective_tier,
        raising=False,
    )

    user = {
        "user_id": "user_phase_e_test",
        "tier": "pro",
        "subscription_status": "suspended",
        "subscription_suspend_reason": "subscription_expired",
    }

    state = asyncio.run(shop_routes._owner_shop_limit(user))

    assert state["tier"] == "pro"
    assert state["status"] == "suspended"
    assert state["limit"] == 1
    assert state["used"] == 1
    assert state["remaining"] == 0
    assert state["can_create"] is False

    query = fake_db.shops.last_query
    assert query["owner_user_id"] == "user_phase_e_test"
    assert query["tier_suspended"] == {"$ne": True}
    assert query["deleted"] == {"$ne": True}
    assert query["is_deleted"] == {"$ne": True}
    assert query["admin_deleted"] == {"$ne": True}
    assert query["deleted_at"] == {"$in": [None, ""]}

    blocked_statuses = set(query["status"]["$nin"])
    assert "tier_suspended" in blocked_statuses
    assert "deleted" in blocked_statuses
    assert "admin_deleted" in blocked_statuses
    assert "admin_suspended" in blocked_statuses
    assert "banned" in blocked_statuses
    assert "disabled" in blocked_statuses
    assert "inactive" in blocked_statuses


def test_phase_e_enforce_blocks_when_limit_full(monkeypatch):
    fake_db = FakeDB(used_count=1)

    monkeypatch.setattr(shop_routes, "db", fake_db)
    monkeypatch.setattr(
        shop_routes,
        "_downgrade_effective_tier",
        fake_suspended_pro_effective_tier,
        raising=False,
    )

    user = {
        "user_id": "user_phase_e_test",
        "tier": "pro",
        "subscription_status": "suspended",
        "subscription_suspend_reason": "subscription_expired",
    }

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(shop_routes._enforce_owner_shop_create_limit(user))

    exc = exc_info.value
    assert exc.status_code == 402
    assert "SHOP_LIMIT_REACHED" in exc.detail
    assert exc.headers == {"X-Lapakin-Error-Code": "SHOP_LIMIT_REACHED"}


def test_phase_e_enforce_allows_when_slot_available(monkeypatch):
    fake_db = FakeDB(used_count=0)

    monkeypatch.setattr(shop_routes, "db", fake_db)
    monkeypatch.setattr(
        shop_routes,
        "_downgrade_effective_tier",
        fake_suspended_pro_effective_tier,
        raising=False,
    )

    user = {
        "user_id": "user_phase_e_test",
        "tier": "pro",
        "subscription_status": "suspended",
        "subscription_suspend_reason": "subscription_expired",
    }

    state = asyncio.run(shop_routes._enforce_owner_shop_create_limit(user))

    assert state["can_create"] is True
    assert state["used"] == 0
    assert state["remaining"] == 1
