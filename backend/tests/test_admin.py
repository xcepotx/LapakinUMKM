"""Lapakin Admin API tests — covers all 11 admin features added in iteration_3."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@lapakin.id"
ADMIN_PASSWORD = "lapakin123"
USER_EMAIL = "sari@warung.id"
USER_PASSWORD = "newpass123"
RUN_ID = uuid.uuid4().hex[:6]


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def user_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert r.status_code == 200, f"user login failed: {r.status_code} {r.text}"
    return s


# ---------- Auth + role gating ----------
class TestAuthRoleAndTier:
    def test_me_admin_has_role_admin(self, admin_session):
        r = admin_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == ADMIN_EMAIL
        assert d.get("role") == "admin"
        # tier may be None for admin (not strictly required)
        assert "tier" in d or d.get("role") == "admin"

    def test_me_user_has_role_field(self, user_session):
        r = user_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        d = r.json()
        # user should not be admin
        assert d.get("role") != "admin"

    def test_non_admin_blocked_from_admin_stats(self, user_session):
        r = user_session.get(f"{API}/admin/stats")
        assert r.status_code == 403

    def test_unauth_blocked_from_admin_stats(self):
        r = requests.get(f"{API}/admin/stats")
        assert r.status_code == 401


# ---------- 1. Dashboard stats ----------
class TestAdminStats:
    def test_admin_stats_shape(self, admin_session):
        r = admin_session.get(f"{API}/admin/stats")
        assert r.status_code == 200
        d = r.json()
        for k in ["users", "shops", "products", "ai_usage", "daily"]:
            assert k in d
        assert {"total", "last_7d", "last_30d"} <= set(d["users"].keys())
        assert {"total", "active", "suspended"} <= set(d["shops"].keys())
        assert {"total", "last_7d"} <= set(d["products"].keys())
        assert {"total", "last_7d"} <= set(d["ai_usage"].keys())
        assert isinstance(d["daily"], list) and len(d["daily"]) == 14
        for day in d["daily"]:
            assert {"date", "users", "shops", "products", "ai_calls"} <= set(day.keys())


# ---------- 2/3. List shops / users ----------
class TestAdminLists:
    def test_admin_shops_with_owner_join(self, admin_session):
        r = admin_session.get(f"{API}/admin/shops")
        assert r.status_code == 200
        shops = r.json()
        assert isinstance(shops, list) and len(shops) >= 1
        s0 = shops[0]
        assert "shop_id" in s0
        assert "product_count" in s0
        assert isinstance(s0["product_count"], int)
        assert "owner" in s0
        # owner should not contain password
        if s0["owner"]:
            assert "password_hash" not in s0["owner"]
            assert "email" in s0["owner"]

    def test_admin_shops_search(self, admin_session):
        r = admin_session.get(f"{API}/admin/shops", params={"q": "warung"})
        assert r.status_code == 200
        shops = r.json()
        # at least our seeded shop should match
        assert any("warung" in (s.get("slug", "") + s.get("name", "")).lower() for s in shops)

    def test_admin_users_no_password_hash(self, admin_session):
        r = admin_session.get(f"{API}/admin/users")
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 1
        for u in users:
            assert "password_hash" not in u


# ---------- 4. Suspend / activate shop ----------
@pytest.fixture(scope="module")
def sari_shop_id(admin_session):
    r = admin_session.get(f"{API}/admin/shops", params={"q": "warung-sari"})
    shops = r.json()
    assert shops, "warung-sari shop not seeded"
    return shops[0]["shop_id"], shops[0]["slug"]


class TestShopStatus:
    def test_suspend_then_public_404(self, admin_session, sari_shop_id):
        shop_id, slug = sari_shop_id
        r = admin_session.put(f"{API}/admin/shops/{shop_id}/status", json={"status": "suspended"})
        assert r.status_code == 200
        # public should 404 now
        rp = requests.get(f"{API}/shops/by-slug/{slug}")
        assert rp.status_code == 404

    def test_activate_back(self, admin_session, sari_shop_id):
        shop_id, slug = sari_shop_id
        r = admin_session.put(f"{API}/admin/shops/{shop_id}/status", json={"status": "active"})
        assert r.status_code == 200
        rp = requests.get(f"{API}/shops/by-slug/{slug}")
        assert rp.status_code == 200

    def test_invalid_status(self, admin_session, sari_shop_id):
        shop_id, _ = sari_shop_id
        r = admin_session.put(f"{API}/admin/shops/{shop_id}/status", json={"status": "deleted"})
        assert r.status_code == 400


# ---------- 9. Featured shop ----------
class TestFeaturedShop:
    def test_mark_featured_and_public_lists(self, admin_session, sari_shop_id):
        shop_id, slug = sari_shop_id
        r = admin_session.put(f"{API}/admin/shops/{shop_id}/featured", json={"featured": True})
        assert r.status_code == 200
        rp = requests.get(f"{API}/featured-shops")
        assert rp.status_code == 200
        slugs = [s["slug"] for s in rp.json()]
        assert slug in slugs

    def test_unmark_featured_removed_from_public(self, admin_session, sari_shop_id):
        shop_id, slug = sari_shop_id
        admin_session.put(f"{API}/admin/shops/{shop_id}/featured", json={"featured": False})
        rp = requests.get(f"{API}/featured-shops")
        slugs = [s["slug"] for s in rp.json()]
        assert slug not in slugs


# ---------- 5. Admin product moderation ----------
@pytest.fixture
def temp_user_product(user_session):
    """Create a product owned by sari for admin to delete."""
    payload = {
        "name": f"TEST_AdminDel_{RUN_ID}",
        "price": 12345,
        "stock": 5,
        "description": "to be deleted by admin",
        "image_data": "",
        "images": [],
        "ig_caption": "", "tiktok_caption": "", "hashtags": [],
    }
    r = user_session.post(f"{API}/products", json=payload)
    assert r.status_code == 200, f"create product: {r.status_code} {r.text}"
    return r.json()["product_id"]


class TestAdminProducts:
    def test_admin_list_products_no_image(self, admin_session):
        r = admin_session.get(f"{API}/admin/products", params={"q": "TEST"})
        assert r.status_code == 200
        items = r.json()
        for p in items:
            assert "image_data" not in p
            assert "images" not in p

    def test_admin_delete_other_user_product(self, admin_session, temp_user_product):
        pid = temp_user_product
        r = admin_session.delete(f"{API}/admin/products/{pid}")
        assert r.status_code == 200
        # verify gone
        r2 = admin_session.get(f"{API}/admin/products", params={"q": pid})
        assert all(p["product_id"] != pid for p in r2.json())
        # Audit log should have entry
        r3 = admin_session.get(f"{API}/admin/audit")
        actions = [(l["action"], l.get("target_id")) for l in r3.json()]
        assert ("product_delete", pid) in actions

    def test_admin_delete_missing_404(self, admin_session):
        r = admin_session.delete(f"{API}/admin/products/prod_doesnotexist")
        assert r.status_code == 404


# ---------- 6. Generate reset password ----------
class TestAdminResetPassword:
    def test_generate_reset_token_and_use_it(self, admin_session):
        # find sari user_id
        r = admin_session.get(f"{API}/admin/users", params={"q": "sari@warung.id"})
        users = r.json()
        target = next((u for u in users if u["email"] == USER_EMAIL), None)
        assert target, "sari not found"
        uid = target["user_id"]
        # request reset
        r2 = admin_session.post(f"{API}/admin/users/{uid}/reset-password")
        assert r2.status_code == 200
        d = r2.json()
        assert "reset_token" in d and len(d["reset_token"]) > 10
        assert d.get("expires_in_minutes") == 60
        # use token to set same password back (so user fixture still works in subsequent runs)
        new_session = requests.Session()
        rr = new_session.post(f"{API}/auth/reset-password",
                              json={"token": d["reset_token"], "new_password": USER_PASSWORD})
        assert rr.status_code == 200, f"reset-password: {rr.status_code} {rr.text}"

    def test_reset_password_unknown_user(self, admin_session):
        r = admin_session.post(f"{API}/admin/users/user_doesnotexist/reset-password")
        assert r.status_code == 404


# ---------- 11. Tier manager ----------
class TestAdminTier:
    def test_set_user_pro_then_free(self, admin_session):
        # Iter11: tier names changed from "premium" → "pro"/"business"
        r = admin_session.get(f"{API}/admin/users", params={"q": "sari@warung.id"})
        target = next((u for u in r.json() if u["email"] == USER_EMAIL), None)
        uid = target["user_id"]
        rp = admin_session.put(f"{API}/admin/users/{uid}/tier", json={"tier": "pro"})
        assert rp.status_code == 200
        # verify
        r2 = admin_session.get(f"{API}/admin/users", params={"q": "sari@warung.id"})
        u2 = next(u for u in r2.json() if u["email"] == USER_EMAIL)
        assert u2.get("tier") == "pro"
        # back to free
        rf = admin_session.put(f"{API}/admin/users/{uid}/tier", json={"tier": "free"})
        assert rf.status_code == 200

    def test_set_invalid_tier(self, admin_session):
        r = admin_session.get(f"{API}/admin/users", params={"q": "sari@warung.id"})
        target = next((u for u in r.json() if u["email"] == USER_EMAIL), None)
        uid = target["user_id"]
        rp = admin_session.put(f"{API}/admin/users/{uid}/tier", json={"tier": "vip"})
        assert rp.status_code == 400


# ---------- 7. Audit log ----------
class TestAdminAudit:
    def test_audit_sorted_desc(self, admin_session):
        r = admin_session.get(f"{API}/admin/audit")
        assert r.status_code == 200
        logs = r.json()
        assert isinstance(logs, list) and len(logs) >= 1
        # verify desc order
        ts = [l["timestamp"] for l in logs]
        assert ts == sorted(ts, reverse=True)
        # required fields
        for l in logs[:5]:
            for k in ["log_id", "admin_user_id", "admin_email", "action", "timestamp"]:
                assert k in l


# ---------- 8. Broadcast ----------
class TestBroadcast:
    @pytest.fixture(scope="class")
    def broadcast_id(self, admin_session):
        title = f"TEST_BC_{RUN_ID}"
        r = admin_session.post(f"{API}/admin/broadcasts", json={
            "title": title, "message": "hello world", "target": "all",
            "variant": "info", "active": True,
        })
        assert r.status_code == 200
        return r.json()["broadcast_id"]

    def test_user_sees_active_broadcast(self, user_session, broadcast_id):
        r = user_session.get(f"{API}/me/broadcast")
        assert r.status_code == 200
        bc = r.json()
        # Could be a different active broadcast — verify at least one is returned and it's not dismissed
        assert bc is not None
        assert bc.get("active") is True

    def test_user_dismiss_broadcast(self, user_session, broadcast_id):
        # Dismiss the broadcast we created
        r = user_session.post(f"{API}/me/broadcast/{broadcast_id}/dismiss")
        assert r.status_code == 200
        # If there are no other active broadcasts, /me/broadcast returns null/None
        r2 = user_session.get(f"{API}/me/broadcast")
        assert r2.status_code == 200
        data = r2.json()
        # If not None, it must NOT be the dismissed one
        if data is not None:
            assert data.get("broadcast_id") != broadcast_id

    def test_toggle_active(self, admin_session, broadcast_id):
        r = admin_session.put(f"{API}/admin/broadcasts/{broadcast_id}/active", json={"featured": False})
        assert r.status_code == 200
        # confirm in list
        r2 = admin_session.get(f"{API}/admin/broadcasts")
        target = next((b for b in r2.json() if b["broadcast_id"] == broadcast_id), None)
        assert target is not None and target["active"] is False

    def test_delete_broadcast(self, admin_session, broadcast_id):
        r = admin_session.delete(f"{API}/admin/broadcasts/{broadcast_id}")
        assert r.status_code == 200
        r2 = admin_session.get(f"{API}/admin/broadcasts")
        ids = [b["broadcast_id"] for b in r2.json()]
        assert broadcast_id not in ids


# ---------- 10. AI usage ----------
class TestAdminAIUsage:
    def test_ai_usage_shape(self, admin_session):
        r = admin_session.get(f"{API}/admin/ai-usage", params={"days": 14})
        assert r.status_code == 200
        d = r.json()
        assert d["days"] == 14
        assert isinstance(d["series"], list) and len(d["series"]) == 14
        for s in d["series"]:
            assert {"date", "enhance", "content", "theme"} <= set(s.keys())
        assert {"enhance", "content", "theme"} <= set(d["totals"].keys())
        assert isinstance(d["top_users"], list)
        assert len(d["top_users"]) <= 10

    def test_ai_usage_days_clamped(self, admin_session):
        r = admin_session.get(f"{API}/admin/ai-usage", params={"days": 9999})
        assert r.status_code == 200
        assert r.json()["days"] == 90
