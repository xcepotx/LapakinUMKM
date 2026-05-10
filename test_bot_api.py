#!/usr/bin/env python3
"""
Smoke test untuk Bot Context API Lapakin.
Jalankan setelah deploy:
  BASE_URL=https://dev.lapakin.my.id \
  TEST_EMAIL=warungbusari@demo.lapakin.id \
  TEST_PASSWORD=demo12345 \
  BOT_SERVICE_TOKEN=xxx \
  python3 /tmp/test_bot_api.py
"""

import os, sys, json
import requests as _requests

BASE      = os.environ.get("BASE_URL", "https://dev.lapakin.my.id")
EMAIL     = os.environ.get("TEST_EMAIL", "warungbusari@demo.lapakin.id")
PASSWORD  = os.environ.get("TEST_PASSWORD", "demo12345")
BOT_TOKEN = os.environ.get("BOT_SERVICE_TOKEN", "")

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"

results = []

def req(method, path, body=None, headers=None, cookies=None):
    url  = f"{BASE}{path}"
    hdrs = {"Content-Type": "application/json", **(headers or {})}
    jar  = None
    if cookies:
        jar = _requests.cookies.RequestsCookieJar()
        for k, v in cookies.items():
            jar.set(k, v)
    try:
        r = _requests.request(method, url, json=body, headers=hdrs, cookies=jar, timeout=10)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, {}
    except Exception as e:
        return 0, {"error": str(e)}

def check(name, condition, detail=""):
    icon = PASS if condition else FAIL
    print(f"  {icon} {name}" + (f" — {detail}" if detail else ""))
    results.append(condition)

print(f"\n{'='*55}")
print(f"  Lapakin AI Bot API Smoke Test")
print(f"  {BASE}")
print(f"{'='*55}\n")

# 1. Login
print("[ 1 ] Login")
status, resp = req("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
check("Login berhasil", status == 200, f"status={status}")
token = resp.get("access_token", "")
cookies = {"access_token": token} if token else {}
# shop_id ada di root response (bukan nested di "user")
shop_id = resp.get("shop_id", "") or ""
check("Dapat access_token", bool(token))
check("User punya shop_id", bool(shop_id), shop_id)

# 2. Bot Readiness
print("\n[ 2 ] Bot Readiness Score")
status, resp = req("GET", "/api/bot/readiness", headers={}, cookies=cookies)
check("Endpoint readiness OK", status == 200, f"status={status}")
if status == 200:
    check("Ada score",   "score" in resp, str(resp.get("score")))
    check("Ada status",  "status" in resp, resp.get("status"))
    check("Ada checklist", "checklist" in resp)
    check("can_simulate selalu True", resp.get("can_simulate") == True)

# 3. Bot Settings GET
print("\n[ 3 ] Bot Settings")
status, resp = req("GET", "/api/bot/settings", cookies=cookies)
check("GET settings OK", status == 200, f"status={status}")
if status == 200:
    s = resp.get("settings", {})
    check("Ada mode",   "mode" in s, s.get("mode"))
    check("Ada tone",   "tone" in s, s.get("tone"))
    check("Ada readiness di response", "readiness" in resp)

# 4. Bot Settings PUT
print("\n[ 4 ] Update Bot Settings")
status, resp = req("PUT", "/api/bot/settings", {
    "tone": "ramah",
    "bot_name": "Hana",
    "fallback_message": "Maaf kak, silakan hubungi admin ya 🙏",
    "handoff_keywords": ["komplain", "refund", "batal"],
    "mode": "simulator_only",
}, cookies=cookies)
check("PUT settings OK", status == 200, f"status={status}")

# 5. Bot Profile
print("\n[ 5 ] Bot Shop Profile")
status, resp = req("PUT", "/api/bot/profile", {
    "order_methods": ["pickup", "delivery"],
    "service_area": "Area Buah Batu, Bandung",
    "min_order": 20000,
    "payment_notes": "Konfirmasi transfer via WA ya kak",
    "bank_accounts": [{"bank": "BCA", "number": "1234567890", "name": "Warung Bu Sari"}],
}, cookies=cookies)
check("PUT profile OK", status == 200, f"status={status}")

status, resp = req("GET", "/api/bot/profile", cookies=cookies)
check("GET profile OK", status == 200)
if status == 200:
    p = resp.get("profile", {})
    check("order_methods tersimpan", bool(p.get("order_methods")))

# 6. FAQ CRUD
print("\n[ 6 ] FAQ CRUD")
status, resp = req("POST", "/api/bot/faqs", {
    "question": "Apakah ada delivery?",
    "answer": "Iya kak, kami melayani delivery area Buah Batu. Min order Rp20.000.",
    "category": "delivery",
}, cookies=cookies)
check("POST faq OK", status == 200, f"status={status}")
faq_id = resp.get("faq", {}).get("faq_id", "")
check("Dapat faq_id", bool(faq_id))

status, resp = req("GET", "/api/bot/faqs", cookies=cookies)
check("GET faqs OK", status == 200)
check("Ada minimal 1 FAQ", len(resp.get("faqs", [])) >= 1)

if faq_id:
    status, resp = req("PUT", f"/api/bot/faqs/{faq_id}", {
        "question": "Apakah ada delivery?",
        "answer": "Iya kak, delivery area Buah Batu dan sekitarnya. Min order Rp20.000 ya.",
        "category": "delivery",
    }, cookies=cookies)
    check("PUT faq OK", status == 200)

    status, resp = req("DELETE", f"/api/bot/faqs/{faq_id}", cookies=cookies)
    check("DELETE faq OK", status == 200)

# 7. Context API (service token)
print("\n[ 7 ] Bot Context API (X-Bot-Token)")
if BOT_TOKEN and shop_id:
    status, resp = req("GET", f"/api/bot/shops/{shop_id}/context",
                       headers={"X-Bot-Token": BOT_TOKEN})
    check("Context API OK", status == 200, f"status={status}")
    if status == 200:
        check("Ada shop data",     bool(resp.get("shop")))
        check("Ada products",      "products" in resp)
        check("Ada payment info",  bool(resp.get("payment")))
        check("Ada bot_settings",  bool(resp.get("bot_settings")))
        check("Ada faqs",          "faqs" in resp)
        check("Ada readiness",     bool(resp.get("readiness")))
        shop_name = resp.get("shop", {}).get("name", "")
        check("Nama toko ada", bool(shop_name), shop_name)
else:
    print(f"  ⚠ Skip — BOT_SERVICE_TOKEN tidak diset atau shop_id kosong")

# 8. Simulate ping
print("\n[ 8 ] Simulator Ping")
status, resp = req("POST", "/api/bot/settings/simulate-ping", cookies=cookies)
check("Simulate ping OK", status == 200, f"status={status}")

# 9. Admin bot overview
print("\n[ 9 ] Admin Bot Overview")
status, resp = req("GET", "/api/admin/bot/overview", cookies=cookies)
check("Admin overview OK", status in (200, 403), f"status={status}")
if status == 200:
    check("Ada bot_enabled field",  "bot_enabled" in resp)
    check("Ada handoff_pending",    "handoff_pending" in resp)

# Summary
print(f"\n{'='*55}")
total  = len(results)
passed = sum(results)
failed = total - passed
print(f"  Hasil: {passed}/{total} passed", end="")
if failed > 0:
    print(f"  ({failed} FAILED)")
else:
    print("  🎉 Semua OK!")
print(f"{'='*55}\n")

sys.exit(0 if failed == 0 else 1)
