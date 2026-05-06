"""Products and product category CRUD routes."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from deps import db, require_user
from models import ProductIn
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
    category_id = str(payload.get("category_id") or "").strip()[:80]
    category_name = normalize_product_category_name(
        payload.get("category_name") or payload.get("category") or ""
    )

    category = None
    if category_id:
        category = await _find_category_by_id(shop_id, category_id)
        if not category:
            raise HTTPException(status_code=400, detail="Kategori tidak ditemukan")
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
