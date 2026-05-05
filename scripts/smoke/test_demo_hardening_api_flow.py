#!/usr/bin/env python3
"""
Lapakin API hardening smoke test v2.

Changes from v1:
- Uses actual public storefront endpoint observed in existing smoke: /api/shops/by-slug/{slug}.
- Uses actual Lead Inbox owner endpoint observed in existing smoke: /api/shops/storefront-leads?limit=20.
- Separates missing product status fixture from missing implementation by inspecting both /api/products
  and the public storefront payload.
- Soft by default. Set STRICT_API_HARDENING=1 once demo fixtures include category/status/lead data.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

BASE_URL = os.getenv("BASE_URL", "https://dev.lapakin.my.id").rstrip("/")
TEST_EMAIL = os.getenv("TEST_EMAIL", "warungbusari@demo.lapakin.id")
TEST_PASSWORD = os.getenv("TEST_PASSWORD", "demo12345")
STORE_SLUG = os.getenv("STORE_SLUG", "warung-bu-sari")
STRICT = os.getenv("STRICT_API_HARDENING") == "1"
TIMEOUT = float(os.getenv("API_HARDENING_TIMEOUT", "20"))


def log(step: str, detail: str = "") -> None:
    print(f"[api-hardening-v2] {step}{': ' + detail if detail else ''}")


def warn(message: str) -> None:
    print(f"[api-hardening-v2][WARN] {message}")


def fail(message: str) -> None:
    print(f"[api-hardening-v2][FAIL] {message}", file=sys.stderr)
    raise SystemExit(1)


def warn_or_fail(message: str) -> None:
    if STRICT:
        fail(message)
    warn(message)


def flatten_keys(obj: Any, prefix: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if isinstance(obj, dict):
        for key, value in obj.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            out[path] = value
            out.update(flatten_keys(value, path))
    elif isinstance(obj, list):
        for idx, value in enumerate(obj[:20]):
            path = f"{prefix}[{idx}]" if prefix else f"[{idx}]"
            out[path] = value
            out.update(flatten_keys(value, path))
    return out


def find_key_paths(payload: Any, names: Iterable[str]) -> Dict[str, List[str]]:
    wanted = set(names)
    matches = {name: [] for name in wanted}
    for path in flatten_keys(payload).keys():
        leaf = path.split(".")[-1]
        if "[" in leaf:
            leaf = leaf.split("[")[0]
        if leaf in wanted:
            matches[leaf].append(path)
    return matches


def request_json(session: requests.Session, method: str, path: str, **kwargs: Any) -> Tuple[int, Optional[Any], str]:
    url = f"{BASE_URL}{path}"
    try:
        response = session.request(method, url, timeout=TIMEOUT, **kwargs)
    except requests.RequestException as exc:
        return 0, None, str(exc)
    try:
        data = response.json()
    except ValueError:
        data = None
    return response.status_code, data, response.text[:600]


def try_login(session: requests.Session) -> Optional[str]:
    for path in ["/api/auth/login"]:
        status, data, raw = request_json(session, "POST", path, json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        log("login probe", f"POST {path} -> {status}")
        if status in (200, 201) and isinstance(data, dict):
            token = data.get("access_token") or data.get("token") or data.get("jwt")
            if token:
                session.headers.update({"Authorization": f"Bearer {token}"})
            return path
    return None


def get_json(session: requests.Session, path: str, label: str, required: bool = False) -> Optional[Any]:
    status, data, raw = request_json(session, "GET", path)
    log(label, f"GET {path} -> {status}")
    if 200 <= status < 300 and data is not None:
        return data
    if required:
        warn_or_fail(f"Required endpoint did not return JSON 2xx: {path} status={status} raw={raw[:180]}")
    return None


def assert_keys(payload: Any, keys: Iterable[str], label: str, required: bool = False) -> None:
    matches = find_key_paths(payload, keys)
    missing = [key for key, paths in matches.items() if not paths]
    present = {key: paths[:4] for key, paths in matches.items() if paths}
    if present:
        log("keys found", f"{label}: {json.dumps(present, ensure_ascii=False)}")
    if missing:
        msg = f"{label} missing keys: {', '.join(sorted(missing))}"
        if required:
            warn_or_fail(msg)
        else:
            warn(msg)


def extract_list(payload: Any, likely_keys: Iterable[str]) -> List[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in likely_keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    # fallback: first reasonably product-like list inside the payload
    for value in payload.values():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return value
    return []


def has_any_key(items: List[Any], keys: Iterable[str]) -> Dict[str, int]:
    counts = {key: 0 for key in keys}
    for item in items:
        if not isinstance(item, dict):
            continue
        flat = flatten_keys(item)
        leafs = {path.split(".")[-1].split("[")[0] for path in flat.keys()}
        for key in keys:
            if key in leafs:
                counts[key] += 1
    return counts


def main() -> None:
    log("start", f"{BASE_URL} slug={STORE_SLUG}")
    session = requests.Session()
    session.headers.update({"Accept": "application/json"})

    login_path = try_login(session)
    if login_path:
        log("login ok", login_path)
    else:
        warn_or_fail("Login failed; private checks may be invalid.")

    shop_me = get_json(session, "/api/shops/me", "private", required=True)
    products_payload = get_json(session, "/api/products", "private", required=True)
    leads_payload = get_json(session, "/api/shops/storefront-leads?limit=20", "private", required=False)
    analytics_payload = get_json(session, "/api/shops/storefront-analytics?days=30", "private", required=False)
    public_payload = get_json(session, f"/api/shops/by-slug/{STORE_SLUG}", "public", required=True)

    payloads: Dict[str, Any] = {}
    for name, payload in [
        ("/api/shops/me", shop_me),
        ("/api/products", products_payload),
        (f"/api/shops/by-slug/{STORE_SLUG}", public_payload),
        ("/api/shops/storefront-leads?limit=20", leads_payload),
        ("/api/shops/storefront-analytics?days=30", analytics_payload),
    ]:
        if payload is not None:
            payloads[name] = payload

    if not payloads:
        fail("No JSON payloads available from auth/private/public probes.")

    assert_keys(
        payloads,
        [
            "storefront_renderer",
            "storefront_mode",
            "storefront_style",
            "storefront_show_testimonials",
            "storefront_testimonials",
            "storefront_show_payment_instruction",
            "storefront_payment_method_label",
            "storefront_payment_instruction",
            "storefront_qris_image",
            "storefront_payment_confirmation_text",
            "storefront_whatsapp_checkout_template",
            "storefront_whatsapp_product_template",
        ],
        "storefront settings",
        required=True,
    )

    products = extract_list(products_payload, ["products", "items", "data"]) + extract_list(public_payload, ["products", "items", "data"])
    if products:
        counts = has_any_key(products, ["category_id", "category", "category_name", "availability_status", "is_active"])
        log("product field counts", json.dumps(counts, ensure_ascii=False))
        missing_core = [key for key in ["category_id", "category", "category_name"] if counts.get(key, 0) == 0]
        missing_status = [key for key in ["availability_status", "is_active"] if counts.get(key, 0) == 0]
        if missing_core:
            warn_or_fail(f"Product category fields not found in product payloads: {', '.join(missing_core)}")
        if missing_status:
            warn_or_fail(
                "Product status fields not found in product payloads: "
                + ", ".join(missing_status)
                + ". If dashboard supports status, inspect serializer for /api/products and /api/shops/by-slug/{slug}."
            )
    else:
        warn_or_fail("No products found in private/public payloads; cannot verify category/status fields.")

    if leads_payload is not None:
        assert_keys(
            leads_payload,
            ["customer_name", "customer_phone", "fulfillment_method", "notes", "items", "total"],
            "lead inbox payload",
            required=False,
        )
    else:
        warn("Lead inbox payload unavailable; existing smoke already created a lead, rerun after data exists or inspect auth route.")

    event_body = {"event": "page_view", "event_type": "page_view", "campaign_slug": STORE_SLUG, "slug": STORE_SLUG}
    status, data, raw = request_json(session, "POST", "/api/storefront/events", json=event_body)
    log("event probe", f"POST /api/storefront/events -> {status}")
    if not (200 <= status < 300):
        warn_or_fail(f"Storefront event endpoint did not return 2xx. status={status} raw={raw[:180]}")

    log("done", "strict mode passed" if STRICT else "soft mode completed with warnings allowed")


if __name__ == "__main__":
    main()
