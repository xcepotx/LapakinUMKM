from typing import Optional
"""Products and product category CRUD routes."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from deps import db, require_user
from models import ProductIn
from pydantic import BaseModel
from tiers import get_tier, get_limits, is_unlimited

router = APIRouter()


def _lapakin_expose_product_status_fields(product):
    """Return a product dict with stable status fields for API consumers."""
    if not isinstance(product, dict):
        return product
    out = dict(product)
    try:
        out["sort_order"] = int(out.get("sort_order") or 0)
    except Exception:
        out["sort_order"] = 0
    raw_status = str(out.get("availability_status") or "").strip().lower()
    allowed_statuses = {"active", "out_of_stock", "hidden"}
    if raw_status not in allowed_statuses:
        raw_status = "hidden" if out.get("is_active") is False else "active"
    out["availability_status"] = raw_status
    out["is_active"] = raw_status != "hidden"
    return out


def _lapakin_parse_reorder_items(body, *, id_field, list_keys):
    # Parse reorder payloads into [(item_id, sort_order)].
    # Supported:
    # - {"ordered_product_ids": ["prod_a", "prod_b"]}
    # - {"items": [{"product_id": "prod_a", "sort_order": 0}]}
    if not isinstance(body, dict):
        return []

    raw_items = None
    for key in list_keys:
        value = body.get(key)
        if isinstance(value, list):
            raw_items = value
            break

    if raw_items is None:
        raw_items = body.get("items") if isinstance(body.get("items"), list) else []

    parsed = []
    seen = set()
    for index, item in enumerate(raw_items):
        if isinstance(item, dict):
            item_id = str(item.get(id_field) or item.get("id") or "").strip()
            raw_sort = item.get("sort_order", index)
        else:
            item_id = str(item or "").strip()
            raw_sort = index

        if not item_id or item_id in seen:
            continue

        seen.add(item_id)
        try:
            sort_order = int(raw_sort)
        except Exception:
            sort_order = index
        parsed.append((item_id, sort_order))

    return parsed


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_product_category_name(value):
    text = str(value or "").strip()
    text = " ".join(text.split())
    return text[:80]


def slugify_category(value):
    text = normalize_product_category_name(value).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "kategori"


async def _get_shop_id(request: Request):
    user = await require_user(request)
    shop_id = user.get("shop_id")
    if not shop_id:
        raise HTTPException(status_code=400, detail="Toko belum dibuat")
    return user, shop_id


def _category_response(doc):
    return {k: v for k, v in (doc or {}).items() if k != "_id"}


async def _find_category_by_id(shop_id: str, category_id: str):
    if not category_id:
        return None
    return await db.product_categories.find_one(
        {"shop_id": shop_id, "category_id": category_id}, {"_id": 0}
    )


async def _find_category_by_name(shop_id: str, name: str):
    slug = slugify_category(name)
    return await db.product_categories.find_one(
        {"shop_id": shop_id, "slug": slug}, {"_id": 0}
    )


async def _ensure_category(shop_id: str, name: str):
    category_name = normalize_product_category_name(name)
    if not category_name:
        return None

    existing = await _find_category_by_name(shop_id, category_name)
    if existing:
        if existing.get("is_active") is False:
            await db.product_categories.update_one(
                {"shop_id": shop_id, "category_id": existing["category_id"]},
                {"$set": {"is_active": True, "updated_at": _now_iso()}},
            )
            existing["is_active"] = True
        return existing

    category_id = f"cat_{uuid.uuid4().hex[:12]}"
    now = _now_iso()
    count = await db.product_categories.count_documents({"shop_id": shop_id})
    doc = {
        "category_id": category_id,
        "shop_id": shop_id,
        "name": category_name,
        "slug": slugify_category(category_name),
        "sort_order": count,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    await db.product_categories.insert_one(doc)
    return _category_response(doc)



def normalize_product_availability_payload(payload):
    raw_status = str(payload.get("availability_status") or "").strip().lower()
    is_active = payload.get("is_active")

    allowed = {"active", "out_of_stock", "hidden"}

    if raw_status not in allowed:
        if is_active is False:
            raw_status = "hidden"
        else:
            raw_status = "active"

    payload["availability_status"] = raw_status
    payload["is_active"] = raw_status != "hidden"

    return payload


async def _resolve_category_for_product(shop_id: str, payload: dict):
    """Normalize product category fields.

    Accepts both:
    - category_id as real category_id, e.g. cat_xxx
    - category_id accidentally sent as category name, e.g. "Makanan"
    """
    category_id = str(payload.get("category_id") or "").strip()[:80]
    category_name = normalize_product_category_name(
        payload.get("category_name") or payload.get("category") or ""
    )

    category = None

    if category_id:
        category = await _find_category_by_id(shop_id, category_id)

        # Defensive fallback: some older frontend paths may send the category
        # name in category_id. Treat it as category_name instead of clearing it.
        if not category and not category_name:
            maybe_name = normalize_product_category_name(category_id)
            if maybe_name:
                category = await _ensure_category(shop_id, maybe_name)

    elif category_name:
        category = await _ensure_category(shop_id, category_name)

    if category:
        payload["category_id"] = category.get("category_id", "")
        payload["category"] = category.get("name", "")
        payload["category_name"] = category.get("name", "")
    else:
        payload["category_id"] = ""
        payload["category"] = ""
        payload["category_name"] = ""

    return payload


@router.get("/product-categories")
async def list_product_categories(request: Request):
    user, shop_id = await _get_shop_id(request)
    categories = await db.product_categories.find(
        {"shop_id": shop_id}, {"_id": 0}
    ).sort([("sort_order", 1), ("name", 1)]).to_list(500)

    # Backfill virtual categories from older products that already have category/category_name.
    existing_slugs = {c.get("slug") for c in categories}
    products = await db.products.find(
        {"shop_id": shop_id},
        {"_id": 0, "category": 1, "category_name": 1},
    ).to_list(1000)

    virtual = []
    for product in products:
        name = normalize_product_category_name(
            product.get("category_name") or product.get("category") or ""
        )
        if not name:
            continue
        slug = slugify_category(name)
        if slug in existing_slugs:
            continue
        existing_slugs.add(slug)
        virtual.append({
            "category_id": "",
            "shop_id": shop_id,
            "name": name,
            "slug": slug,
            "sort_order": len(categories) + len(virtual),
            "is_active": True,
            "is_virtual": True,
        })

    return categories + virtual


@router.post("/product-categories")
async def create_product_category(request: Request):
    user, shop_id = await _get_shop_id(request)
    body = await request.json()
    name = normalize_product_category_name(body.get("name") or body.get("category") or "")
    if not name:
        raise HTTPException(status_code=400, detail="Nama kategori wajib diisi")

    category = await _ensure_category(shop_id, name)
    return category


@router.patch("/product-categories/reorder")
@router.patch("/product_categories/reorder")
async def reorder_product_categories(request: Request):
    user, shop_id = await _get_shop_id(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    items = _lapakin_parse_reorder_items(
        body,
        id_field="category_id",
        list_keys=("ordered_category_ids", "category_ids", "categories"),
    )
    if not items:
        raise HTTPException(status_code=400, detail="Daftar urutan kategori kosong")

    now = _now_iso()
    updated = 0
    matched = 0
    missing = []

    for category_id, sort_order in items:
        result = await db.product_categories.update_one(
            {"shop_id": shop_id, "category_id": category_id},
            {"$set": {"sort_order": sort_order, "updated_at": now}},
        )
        matched += int(getattr(result, "matched_count", 0) or 0)
        updated += int(getattr(result, "modified_count", 0) or 0)
        if not getattr(result, "matched_count", 0):
            missing.append(category_id)

    return {
        "ok": True,
        "requested": len(items),
        "matched": matched,
        "updated": updated,
        "missing": missing,
    }


@router.put("/product-categories/{category_id}")
async def update_product_category_master(category_id: str, request: Request):
    user, shop_id = await _get_shop_id(request)
    category = await _find_category_by_id(shop_id, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")

    body = await request.json()
    update = {"updated_at": _now_iso()}

    if "name" in body or "category" in body:
        name = normalize_product_category_name(body.get("name") or body.get("category") or "")
        if not name:
            raise HTTPException(status_code=400, detail="Nama kategori wajib diisi")

        slug = slugify_category(name)
        duplicate = await db.product_categories.find_one({
            "shop_id": shop_id,
            "slug": slug,
            "category_id": {"$ne": category_id},
        })
        if duplicate:
            raise HTTPException(status_code=409, detail="Kategori dengan nama ini sudah ada")

        update["name"] = name
        update["slug"] = slug

    if "sort_order" in body:
        try:
            update["sort_order"] = int(body.get("sort_order") or 0)
        except Exception:
            update["sort_order"] = 0

    if "is_active" in body:
        update["is_active"] = bool(body.get("is_active"))

    await db.product_categories.update_one(
        {"shop_id": shop_id, "category_id": category_id},
        {"$set": update},
    )

    if "name" in update:
        await db.products.update_many(
            {"shop_id": shop_id, "category_id": category_id},
            {"$set": {
                "category": update["name"],
                "category_name": update["name"],
                "updated_at": _now_iso(),
            }},
        )

    updated = await _find_category_by_id(shop_id, category_id)
    return updated


@router.delete("/product-categories/{category_id}")
async def delete_product_category(category_id: str, request: Request):
    user, shop_id = await _get_shop_id(request)
    category = await _find_category_by_id(shop_id, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Kategori tidak ditemukan")

    await db.product_categories.update_one(
        {"shop_id": shop_id, "category_id": category_id},
        {"$set": {"is_active": False, "updated_at": _now_iso()}},
    )

    # Keep product category text for compatibility, but detach from inactive master category.
    await db.products.update_many(
        {"shop_id": shop_id, "category_id": category_id},
        {"$set": {"category_id": "", "updated_at": _now_iso()}},
    )

    return {"ok": True}


@router.get("/products")
async def list_my_products(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        return []
    products = await db.products.find(
        {"shop_id": user["shop_id"]}, {"_id": 0}
    ).sort([("sort_order", 1), ("created_at", -1)]).to_list(500)
    return [_lapakin_expose_product_status_fields(p) for p in products]
@router.post("/products")
async def create_product(data: ProductIn, request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Toko belum dibuat")

    limits = get_limits(get_tier(user))
    if not is_unlimited(limits["max_products"]):
        cur_count = await db.products.count_documents({"shop_id": user["shop_id"]})
        if cur_count >= limits["max_products"]:
            raise HTTPException(
                status_code=402,
                detail=f"Tier {get_tier(user)} dibatasi {limits['max_products']} produk. Upgrade ke Pro untuk hingga 100 produk.",
            )

    product_id = f"prod_{uuid.uuid4().hex[:12]}"
    payload = data.model_dump()
    payload = await _resolve_category_for_product(user["shop_id"], payload)
    payload = normalize_product_availability_payload(payload)
    payload = normalize_product_availability_payload(payload)

    if not payload.get("images") and payload.get("image_data"):
        payload["images"] = [payload["image_data"]]
    elif payload.get("images") and not payload.get("image_data"):
        payload["image_data"] = payload["images"][0]

    doc = {
        "product_id": product_id,
        "shop_id": user["shop_id"],
        **payload,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.products.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/products/daily-menu")
async def bulk_update_daily_menu(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")

    tier = get_tier(user)
    limits = get_limits(tier)
    if not limits.get("multi_shift_schedule"):
        raise HTTPException(
            status_code=402,
            detail="Pengaturan menu per-hari hanya tersedia untuk paket Pro & Bisnis."
        )

    body = await request.json()
    updates = body.get("updates") or []
    if not isinstance(updates, list) or len(updates) == 0:
        raise HTTPException(status_code=400, detail="Tidak ada update")
    if len(updates) > 500:
        raise HTTPException(status_code=400, detail="Maks 500 produk per request")

    valid_days = set(range(7))
    sane_updates = []
    for u in updates:
        pid = u.get("product_id")
        days = u.get("available_days") or []
        if not isinstance(pid, str) or not isinstance(days, list):
            continue
        days = [int(d) for d in days if isinstance(d, int) or (isinstance(d, str) and d.isdigit())]
        days = sorted({d for d in days if d in valid_days})
        sane_updates.append({"product_id": pid, "available_days": days})

    if not sane_updates:
        raise HTTPException(status_code=400, detail="Format update tidak valid")

    modified = 0
    for u in sane_updates:
        r = await db.products.update_one(
            {"product_id": u["product_id"], "shop_id": user["shop_id"]},
            {"$set": {"available_days": u["available_days"], "updated_at": _now_iso()}},
        )
        if r.modified_count or r.matched_count:
            modified += r.matched_count

    return {"ok": True, "updated": modified, "total": len(sane_updates)}


@router.patch("/products/reorder")
async def reorder_products(request: Request):
    user, shop_id = await _get_shop_id(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    items = _lapakin_parse_reorder_items(
        body,
        id_field="product_id",
        list_keys=("ordered_product_ids", "product_ids", "products"),
    )
    if not items:
        raise HTTPException(status_code=400, detail="Daftar urutan produk kosong")

    now = _now_iso()
    updated = 0
    matched = 0
    missing = []

    for product_id, sort_order in items:
        result = await db.products.update_one(
            {"shop_id": shop_id, "product_id": product_id},
            {"$set": {"sort_order": sort_order, "updated_at": now}},
        )
        matched += int(getattr(result, "matched_count", 0) or 0)
        updated += int(getattr(result, "modified_count", 0) or 0)
        if not getattr(result, "matched_count", 0):
            missing.append(product_id)

    return {
        "ok": True,
        "requested": len(items),
        "matched": matched,
        "updated": updated,
        "missing": missing,
    }


@router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductIn, request: Request):
    user = await require_user(request)
    p = await db.products.find_one({"product_id": product_id})
    if not p or p["shop_id"] != user.get("shop_id"):
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")

    payload = data.model_dump()
    payload = await _resolve_category_for_product(user["shop_id"], payload)
    payload["updated_at"] = _now_iso()

    if not payload.get("images") and payload.get("image_data"):
        payload["images"] = [payload["image_data"]]
    elif payload.get("images") and not payload.get("image_data"):
        payload["image_data"] = payload["images"][0]

    await db.products.update_one(
        {"product_id": product_id, "shop_id": user["shop_id"]},
        {"$set": payload},
    )
    updated = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    return updated


@router.put("/products/{product_id}/category")
async def update_product_category(product_id: str, request: Request):
    user, shop_id = await _get_shop_id(request)
    p = await db.products.find_one({"product_id": product_id})
    if not p or p["shop_id"] != shop_id:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")

    body = await request.json()
    payload = {
        "category_id": body.get("category_id") or "",
        "category": body.get("category") or body.get("category_name") or "",
        "category_name": body.get("category_name") or body.get("category") or "",
    }
    payload = await _resolve_category_for_product(shop_id, payload)
    payload["updated_at"] = _now_iso()

    await db.products.update_one(
        {"product_id": product_id, "shop_id": shop_id},
        {"$set": payload},
    )

    updated = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    return updated


@router.put("/products/{product_id}/availability")
async def update_product_availability(product_id: str, request: Request):
    user, shop_id = await _get_shop_id(request)
    p = await db.products.find_one({"product_id": product_id})
    if not p or p["shop_id"] != shop_id:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")

    body = await request.json()
    payload = normalize_product_availability_payload({
        "availability_status": body.get("availability_status"),
        "is_active": body.get("is_active"),
    })
    payload["updated_at"] = _now_iso()

    await db.products.update_one(
        {"product_id": product_id, "shop_id": shop_id},
        {"$set": payload},
    )

    updated = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    return updated



@router.delete("/products/{product_id}")
async def delete_product(product_id: str, request: Request):
    user = await require_user(request)
    p = await db.products.find_one({"product_id": product_id})
    if not p or p["shop_id"] != user.get("shop_id"):
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.products.delete_one({"product_id": product_id, "shop_id": user["shop_id"]})
    return {"ok": True}


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
class TenantMallSubmitIn(BaseModel):
    product_id: str
    mall_category: Optional[str] = ""
    mall_badge: Optional[str] = ""
    highlight: Optional[str] = ""


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
class TenantMallListingActionIn(BaseModel):
    action: str
    mall_category: Optional[str] = ""
    mall_badge: Optional[str] = ""
    highlight: Optional[str] = ""


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
def _tenant_mall_clean_text(value, limit=500):
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
def _tenant_mall_product_active(product):
    if not product:
        return False

    availability = str(product.get("availability_status") or "").lower()
    if availability in {"hidden", "out_of_stock"}:
        return False

    status = str(product.get("status") or "").lower()
    if status in {"hidden", "deleted", "inactive"}:
        return False

    if product.get("is_active") is False:
        return False

    return True


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
def _tenant_mall_shop_active(shop):
    if not shop:
        return False

    status = str(shop.get("status") or "active").lower()
    if status in {"deleted", "suspended", "inactive"}:
        return False

    if shop.get("deleted_at"):
        return False

    return bool(shop.get("slug"))


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
def _tenant_mall_has_order_contact(shop):
    keys = [
        "whatsapp",
        "whatsapp_number",
        "wa_number",
        "phone",
        "phone_number",
        "contact_phone",
        "order_phone",
        "order_whatsapp",
        "contact_whatsapp",
    ]

    return any(str((shop or {}).get(key) or "").strip() for key in keys)


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
def _tenant_mall_product_image(product):
    product = product or {}

    for key in ["image_url", "thumbnail_url", "photo_url", "image_data"]:
        value = product.get(key)
        if value:
            return value

    images = product.get("images")
    if isinstance(images, list) and images:
        return images[0]

    return ""


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
def _tenant_mall_default_category(product, shop):
    return (
        product.get("category_name")
        or product.get("category")
        or shop.get("business_type")
        or "Pilihan UMKM"
    )


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
def _tenant_mall_listing_public_status(listing):
    if not listing:
        return "not_submitted"

    status = str(listing.get("status") or "pending").lower()
    if listing.get("hidden") and status == "approved":
        return "hidden"

    return status


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
def _tenant_mall_listing_response(product, listing, shop):
    product = product or {}
    listing = listing or {}
    shop = shop or {}

    eligible_product = _tenant_mall_product_active(product)
    eligible_shop = _tenant_mall_shop_active(shop)
    has_contact = _tenant_mall_has_order_contact(shop)

    status = _tenant_mall_listing_public_status(listing)

    return {
        "product_id": product.get("product_id"),
        "shop_id": product.get("shop_id"),
        "name": product.get("name") or "-",
        "description": product.get("description") or product.get("caption") or "",
        "price": product.get("price") or 0,
        "stock": product.get("stock"),
        "category": product.get("category_name") or product.get("category") or "",
        "image": _tenant_mall_product_image(product),
        "availability_status": product.get("availability_status") or "active",
        "is_active": product.get("is_active", True),
        "eligible_for_mall": bool(eligible_product and eligible_shop),
        "eligibility": {
            "product_active": eligible_product,
            "shop_active": eligible_shop,
            "has_order_contact": has_contact,
            "shop_slug": shop.get("slug") or "",
        },
        "listing": {
            "listing_id": listing.get("listing_id") or "",
            "status": status,
            "raw_status": listing.get("status") or "",
            "mall_category": listing.get("mall_category") or _tenant_mall_default_category(product, shop),
            "mall_badge": listing.get("mall_badge") or "",
            "highlight": listing.get("highlight") or product.get("description") or product.get("caption") or "",
            "featured": bool(listing.get("featured")),
            "submitted_at": listing.get("submitted_at") or listing.get("created_at") or "",
            "approved_at": listing.get("approved_at") or "",
            "rejected_at": listing.get("rejected_at") or "",
            "updated_at": listing.get("updated_at") or "",
            "admin_note": listing.get("admin_note") or listing.get("reject_reason") or "",
        },
    }


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
@router.get("/mall/my-listings")
async def tenant_mall_my_listings(request: Request, limit: int = 500):
    user, shop_id = await _get_shop_id(request)

    shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    limit = max(1, min(int(limit or 500), 1000))

    products = await db.products.find({"shop_id": shop_id}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    product_ids = [product.get("product_id") for product in products if product.get("product_id")]

    listings_by_product = {}
    if product_ids:
        listings = await db.mall_listings.find(
            {"shop_id": shop_id, "product_id": {"$in": product_ids}},
            {"_id": 0},
        ).to_list(len(product_ids))

        listings_by_product = {
            item.get("product_id"): item
            for item in listings
            if item.get("product_id")
        }

    items = [
        _tenant_mall_listing_response(product, listings_by_product.get(product.get("product_id")), shop)
        for product in products
    ]

    summary = {
        "total_products": len(products),
        "not_submitted": len([item for item in items if item["listing"]["status"] == "not_submitted"]),
        "pending": len([item for item in items if item["listing"]["status"] == "pending"]),
        "approved": len([item for item in items if item["listing"]["status"] == "approved"]),
        "rejected": len([item for item in items if item["listing"]["status"] == "rejected"]),
        "hidden": len([item for item in items if item["listing"]["status"] == "hidden"]),
        "eligible": len([item for item in items if item.get("eligible_for_mall")]),
        "shop_ready": _tenant_mall_shop_active(shop),
        "has_order_contact": _tenant_mall_has_order_contact(shop),
        "shop_slug": shop.get("slug") or "",
    }

    return {
        "items": items,
        "summary": summary,
        "shop": {
            "shop_id": shop_id,
            "name": shop.get("name") or "",
            "slug": shop.get("slug") or "",
            "status": shop.get("status") or "active",
        },
    }


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
@router.post("/mall/submit")
async def tenant_mall_submit_product(data: TenantMallSubmitIn, request: Request):
    import uuid
    from datetime import datetime, timezone

    user, shop_id = await _get_shop_id(request)

    product_id = _tenant_mall_clean_text(data.product_id, 120)
    if not product_id:
        raise HTTPException(status_code=400, detail="product_id wajib diisi")

    product = await db.products.find_one({"shop_id": shop_id, "product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan di toko kamu")

    shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0}) or {}

    if not _tenant_mall_product_active(product):
        raise HTTPException(status_code=400, detail="Produk hidden/habis/tidak aktif belum bisa diajukan ke Mall")

    if not _tenant_mall_shop_active(shop):
        raise HTTPException(status_code=400, detail="Toko belum aktif atau slug belum tersedia")

    existing = await db.mall_listings.find_one({"shop_id": shop_id, "product_id": product_id}, {"_id": 0})
    now = datetime.now(timezone.utc).isoformat()

    category = _tenant_mall_clean_text(
        data.mall_category or _tenant_mall_default_category(product, shop),
        120,
    ) or "Pilihan UMKM"
    badge = _tenant_mall_clean_text(data.mall_badge, 60)
    highlight = _tenant_mall_clean_text(data.highlight or product.get("description") or product.get("caption") or "", 500)

    if existing and str(existing.get("status") or "").lower() == "approved":
        raise HTTPException(status_code=409, detail="Produk sudah approved di Mall. Hubungi admin untuk ubah data listing.")

    if existing:
        update = {
            "status": "pending",
            "hidden": False,
            "mall_category": category,
            "mall_badge": badge,
            "highlight": highlight,
            "submitted_at": now,
            "updated_at": now,
            "submitted_by_user_id": user.get("user_id"),
            "submitted_by_email": user.get("email"),
            "submission_count": int(existing.get("submission_count") or 0) + 1,
            "tenant_note": "resubmitted",
        }

        await db.mall_listings.update_one({"listing_id": existing["listing_id"]}, {"$set": update})
        item = await db.mall_listings.find_one({"listing_id": existing["listing_id"]}, {"_id": 0})
    else:
        item = {
            "listing_id": f"mall_{uuid.uuid4().hex[:14]}",
            "shop_id": shop_id,
            "product_id": product_id,
            "status": "pending",
            "hidden": False,
            "mall_category": category,
            "mall_badge": badge,
            "mall_rank": 100,
            "featured": False,
            "highlight": highlight,
            "created_at": now,
            "updated_at": now,
            "submitted_at": now,
            "submitted_by_user_id": user.get("user_id"),
            "submitted_by_email": user.get("email"),
            "submission_count": 1,
            "source": "tenant_submit",
        }

        await db.mall_listings.insert_one(dict(item))

    try:
        await db.mall_submission_events.insert_one({
            "event_id": f"mall_sub_{uuid.uuid4().hex[:14]}",
            "event_type": "tenant_submit",
            "listing_id": item.get("listing_id"),
            "shop_id": shop_id,
            "product_id": product_id,
            "created_at": now,
            "user_id": user.get("user_id"),
            "email": user.get("email"),
            "status": item.get("status"),
        })
    except Exception:
        pass

    return {
        "ok": True,
        "item": _tenant_mall_listing_response(product, item, shop),
        "message": "Produk berhasil diajukan ke Lapakin Mall. Menunggu approval admin.",
    }


# LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
@router.patch("/mall/my-listings/{listing_id}")
async def tenant_mall_listing_action(listing_id: str, data: TenantMallListingActionIn, request: Request):
    import uuid
    from datetime import datetime, timezone

    user, shop_id = await _get_shop_id(request)

    listing = await db.mall_listings.find_one({"shop_id": shop_id, "listing_id": listing_id}, {"_id": 0})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing Mall tidak ditemukan")

    product = await db.products.find_one({"shop_id": shop_id, "product_id": listing.get("product_id")}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk listing tidak ditemukan")

    shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    action = str(data.action or "").strip().lower()
    now = datetime.now(timezone.utc).isoformat()

    if action == "withdraw":
        update = {
            "status": "hidden",
            "hidden": True,
            "withdrawn_at": now,
            "updated_at": now,
            "withdrawn_by_user_id": user.get("user_id"),
            "withdrawn_by_email": user.get("email"),
        }
        event_type = "tenant_withdraw"

    elif action == "resubmit":
        if not _tenant_mall_product_active(product):
            raise HTTPException(status_code=400, detail="Produk hidden/habis/tidak aktif belum bisa diajukan ulang")

        if not _tenant_mall_shop_active(shop):
            raise HTTPException(status_code=400, detail="Toko belum aktif atau slug belum tersedia")

        update = {
            "status": "pending",
            "hidden": False,
            "mall_category": _tenant_mall_clean_text(data.mall_category or listing.get("mall_category") or _tenant_mall_default_category(product, shop), 120),
            "mall_badge": _tenant_mall_clean_text(data.mall_badge if data.mall_badge is not None else listing.get("mall_badge"), 60),
            "highlight": _tenant_mall_clean_text(data.highlight or listing.get("highlight") or product.get("description") or product.get("caption") or "", 500),
            "submitted_at": now,
            "updated_at": now,
            "submitted_by_user_id": user.get("user_id"),
            "submitted_by_email": user.get("email"),
            "submission_count": int(listing.get("submission_count") or 0) + 1,
        }
        event_type = "tenant_resubmit"

    else:
        raise HTTPException(status_code=400, detail="Action harus withdraw atau resubmit")

    await db.mall_listings.update_one({"listing_id": listing_id, "shop_id": shop_id}, {"$set": update})
    item = await db.mall_listings.find_one({"listing_id": listing_id, "shop_id": shop_id}, {"_id": 0})

    try:
        await db.mall_submission_events.insert_one({
            "event_id": f"mall_sub_{uuid.uuid4().hex[:14]}",
            "event_type": event_type,
            "listing_id": listing_id,
            "shop_id": shop_id,
            "product_id": listing.get("product_id"),
            "created_at": now,
            "user_id": user.get("user_id"),
            "email": user.get("email"),
            "status": item.get("status"),
        })
    except Exception:
        pass

    return {
        "ok": True,
        "item": _tenant_mall_listing_response(product, item, shop),
        "message": "Status listing Mall diperbarui.",
    }

