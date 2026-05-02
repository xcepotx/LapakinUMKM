import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from deps import db, require_user
from tiers import get_tier, get_limits, is_unlimited

router = APIRouter()

JAKARTA = timezone(timedelta(hours=7))

VALID_CHANNELS = {"whatsapp", "instagram", "offline", "other"}
VALID_PAYMENT_STATUS = {"paid", "unpaid", "partial"}


class SaleItemIn(BaseModel):
    product_id: Optional[str] = ""
    name: str = Field(min_length=1)
    qty: float = Field(gt=0)
    unit: Optional[str] = "pcs"
    unit_price: int = Field(ge=0)


class SaleCreateIn(BaseModel):
    sale_date: Optional[str] = None
    customer_name: Optional[str] = ""
    customer_phone: Optional[str] = ""
    channel: str = "whatsapp"
    payment_status: str = "paid"
    paid_amount: Optional[int] = None
    notes: Optional[str] = ""
    items: List[SaleItemIn] = Field(min_length=1)
    update_stock: bool = False


class SaleUpdateIn(BaseModel):
    sale_date: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    channel: Optional[str] = None
    payment_status: Optional[str] = None
    paid_amount: Optional[int] = None
    notes: Optional[str] = None
    items: Optional[List[SaleItemIn]] = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_sale_date(value: Optional[str]) -> datetime:
    if not value:
        return _now_utc()

    try:
        normalized = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
    except Exception:
        raise HTTPException(status_code=400, detail="Format sale_date tidak valid")

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JAKARTA)

    return dt.astimezone(timezone.utc)


def _jakarta_month_bucket(dt_utc: datetime) -> str:
    local = dt_utc.astimezone(JAKARTA)
    return f"{local.year:04d}-{local.month:02d}"


def _jakarta_day_bounds() -> tuple[str, str]:
    now_jkt = datetime.now(JAKARTA)
    start = now_jkt.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()


def _jakarta_month_bounds() -> tuple[str, str]:
    now_jkt = datetime.now(JAKARTA)
    start = now_jkt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)

    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()


async def _normalize_items(items: List[SaleItemIn], shop_id: str) -> list[dict]:
    normalized = []

    for item in items:
        product_id = (item.product_id or "").strip()
        name = item.name.strip()
        unit = (item.unit or "pcs").strip() or "pcs"
        unit_price = int(item.unit_price or 0)
        qty = float(item.qty)
        product = None

        if product_id:
            product = await db.products.find_one(
                {"product_id": product_id, "shop_id": shop_id},
                {"_id": 0},
            )
            if not product:
                raise HTTPException(
                    status_code=404,
                    detail=f"Produk {product_id} tidak ditemukan di toko ini",
                )

            if not name:
                name = product.get("name") or "Produk"

            if unit_price == 0:
                unit_price = int(product.get("price") or 0)

        subtotal = int(round(qty * unit_price))

        normalized.append(
            {
                "product_id": product_id,
                "name": name,
                "qty": qty,
                "unit": unit,
                "unit_price": unit_price,
                "subtotal": subtotal,
            }
        )

    return normalized


async def _apply_stock_reduction(items: list[dict], shop_id: str):
    for item in items:
        product_id = item.get("product_id")
        qty = float(item.get("qty") or 0)

        if not product_id or qty <= 0:
            continue

        result = await db.products.update_one(
            {
                "product_id": product_id,
                "shop_id": shop_id,
                "stock": {"$gte": qty},
            },
            {
                "$inc": {"stock": -qty},
                "$set": {"updated_at": _now_utc().isoformat()},
            },
        )

        if result.matched_count == 0:
            product = await db.products.find_one(
                {"product_id": product_id, "shop_id": shop_id},
                {"_id": 0, "name": 1, "stock": 1},
            )
            current_stock = product.get("stock", 0) if product else 0
            product_name = product.get("name", product_id) if product else product_id
            raise HTTPException(
                status_code=400,
                detail=f"Stok {product_name} tidak cukup. Stok saat ini: {current_stock}",
            )


def _payment_amount(payment_status: str, paid_amount: Optional[int], total: int) -> int:
    if payment_status == "paid":
        return total if paid_amount is None else min(int(paid_amount), total)

    if payment_status == "unpaid":
        return 0 if paid_amount is None else min(int(paid_amount), total)

    return max(0, min(int(paid_amount or 0), total))


async def _check_sales_quota(user: dict, sale_month: str):
    limits = get_limits(get_tier(user))
    limit = limits.get("sales_entries_per_month")

    if limit is None or is_unlimited(limit):
        return

    used = await db.sales_entries.count_documents(
        {
            "user_id": user["user_id"],
            "sale_month": sale_month,
        }
    )

    if used >= limit:
        raise HTTPException(
            status_code=402,
            detail=f"Kuota Buku Jualan bulan ini sudah habis ({used}/{limit}). Upgrade paket untuk lanjut.",
        )


@router.get("/sales")
async def list_sales(
    request: Request,
    status: Optional[str] = Query(default=None),
    channel: Optional[str] = Query(default=None),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
):
    user = await require_user(request)

    if not user.get("shop_id"):
        return []

    query = {"shop_id": user["shop_id"]}

    if status:
        if status not in VALID_PAYMENT_STATUS:
            raise HTTPException(status_code=400, detail="Status pembayaran tidak valid")
        query["payment_status"] = status

    if channel:
        if channel not in VALID_CHANNELS:
            raise HTTPException(status_code=400, detail="Channel tidak valid")
        query["channel"] = channel

    if start or end:
        query["sale_date"] = {}
        if start:
            query["sale_date"]["$gte"] = _parse_sale_date(start).isoformat()
        if end:
            query["sale_date"]["$lt"] = _parse_sale_date(end).isoformat()

    sales = await db.sales_entries.find(query, {"_id": 0}).sort("sale_date", -1).to_list(limit)
    return sales


@router.post("/sales")
async def create_sale(data: SaleCreateIn, request: Request):
    user = await require_user(request)

    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Toko belum dibuat")

    if data.channel not in VALID_CHANNELS:
        raise HTTPException(status_code=400, detail="Channel tidak valid")

    if data.payment_status not in VALID_PAYMENT_STATUS:
        raise HTTPException(status_code=400, detail="Status pembayaran tidak valid")

    sale_dt = _parse_sale_date(data.sale_date)
    sale_month = _jakarta_month_bucket(sale_dt)

    await _check_sales_quota(user, sale_month)

    items = await _normalize_items(data.items, user["shop_id"])
    total = sum(int(item.get("subtotal") or 0) for item in items)
    paid_amount = _payment_amount(data.payment_status, data.paid_amount, total)
    now = _now_utc().isoformat()

    if data.update_stock:
        await _apply_stock_reduction(items, user["shop_id"])

    sale_id = f"sale_{uuid.uuid4().hex[:12]}"

    doc = {
        "sale_id": sale_id,
        "shop_id": user["shop_id"],
        "user_id": user["user_id"],
        "sale_date": sale_dt.isoformat(),
        "sale_month": sale_month,
        "customer_name": (data.customer_name or "").strip(),
        "customer_phone": (data.customer_phone or "").strip(),
        "channel": data.channel,
        "payment_status": data.payment_status,
        "items": items,
        "total": total,
        "paid_amount": paid_amount,
        "unpaid_amount": max(0, total - paid_amount),
        "notes": (data.notes or "").strip(),
        "created_at": now,
        "updated_at": now,
    }

    await db.sales_entries.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.get("/sales/summary")
async def sales_summary(request: Request):
    user = await require_user(request)

    if not user.get("shop_id"):
        return {
            "omzet_today": 0,
            "omzet_month": 0,
            "transaction_today": 0,
            "transaction_month": 0,
            "unpaid_total": 0,
            "top_products": [],
            "by_channel": {"whatsapp": 0, "instagram": 0, "offline": 0, "other": 0},
        }

    today_start, today_end = _jakarta_day_bounds()
    month_start, month_end = _jakarta_month_bounds()

    month_sales = await db.sales_entries.find(
        {
            "shop_id": user["shop_id"],
            "sale_date": {"$gte": month_start, "$lt": month_end},
        },
        {"_id": 0},
    ).to_list(5000)

    omzet_today = 0
    transaction_today = 0
    omzet_month = 0
    unpaid_total = 0
    top_map = {}
    by_channel = {"whatsapp": 0, "instagram": 0, "offline": 0, "other": 0}

    for sale in month_sales:
        sale_date = sale.get("sale_date") or ""
        total = int(sale.get("total") or 0)
        unpaid = int(sale.get("unpaid_amount") or 0)
        channel = sale.get("channel") or "other"

        omzet_month += total
        unpaid_total += unpaid
        by_channel[channel if channel in by_channel else "other"] += 1

        if today_start <= sale_date < today_end:
            omzet_today += total
            transaction_today += 1

        for item in sale.get("items") or []:
            key = item.get("product_id") or item.get("name")
            if not key:
                continue

            if key not in top_map:
                top_map[key] = {
                    "product_id": item.get("product_id") or "",
                    "name": item.get("name") or "Produk",
                    "qty": 0,
                    "revenue": 0,
                }

            top_map[key]["qty"] += float(item.get("qty") or 0)
            top_map[key]["revenue"] += int(item.get("subtotal") or 0)

    top_products = sorted(
        top_map.values(),
        key=lambda x: x["revenue"],
        reverse=True,
    )[:5]

    return {
        "omzet_today": omzet_today,
        "omzet_month": omzet_month,
        "transaction_today": transaction_today,
        "transaction_month": len(month_sales),
        "unpaid_total": unpaid_total,
        "top_products": top_products,
        "by_channel": by_channel,
    }


@router.get("/sales/{sale_id}")
async def get_sale(sale_id: str, request: Request):
    user = await require_user(request)

    sale = await db.sales_entries.find_one(
        {"sale_id": sale_id, "shop_id": user.get("shop_id")},
        {"_id": 0},
    )

    if not sale:
        raise HTTPException(status_code=404, detail="Catatan penjualan tidak ditemukan")

    return sale


@router.put("/sales/{sale_id}")
async def update_sale(sale_id: str, data: SaleUpdateIn, request: Request):
    user = await require_user(request)

    existing = await db.sales_entries.find_one(
        {"sale_id": sale_id, "shop_id": user.get("shop_id")},
        {"_id": 0},
    )

    if not existing:
        raise HTTPException(status_code=404, detail="Catatan penjualan tidak ditemukan")

    update = {}

    if data.sale_date is not None:
        sale_dt = _parse_sale_date(data.sale_date)
        update["sale_date"] = sale_dt.isoformat()
        update["sale_month"] = _jakarta_month_bucket(sale_dt)

    if data.customer_name is not None:
        update["customer_name"] = data.customer_name.strip()

    if data.customer_phone is not None:
        update["customer_phone"] = data.customer_phone.strip()

    if data.channel is not None:
        if data.channel not in VALID_CHANNELS:
            raise HTTPException(status_code=400, detail="Channel tidak valid")
        update["channel"] = data.channel

    if data.payment_status is not None:
        if data.payment_status not in VALID_PAYMENT_STATUS:
            raise HTTPException(status_code=400, detail="Status pembayaran tidak valid")
        update["payment_status"] = data.payment_status

    if data.notes is not None:
        update["notes"] = data.notes.strip()

    items = existing.get("items") or []
    total = int(existing.get("total") or 0)

    if data.items is not None:
        items = await _normalize_items(data.items, user["shop_id"])
        total = sum(int(item.get("subtotal") or 0) for item in items)
        update["items"] = items
        update["total"] = total

    payment_status = update.get("payment_status", existing.get("payment_status", "paid"))

    if payment_status == "paid":
        paid_amount = total
    elif payment_status == "unpaid":
        paid_amount = 0
    else:
        paid_amount = max(0, min(int(data.paid_amount or existing.get("paid_amount") or 0), total))

    update["paid_amount"] = paid_amount
    update["unpaid_amount"] = max(0, total - paid_amount)
    update["updated_at"] = _now_utc().isoformat()

    await db.sales_entries.update_one(
        {"sale_id": sale_id, "shop_id": user.get("shop_id")},
        {"$set": update},
    )

    updated = await db.sales_entries.find_one(
        {"sale_id": sale_id},
        {"_id": 0},
    )

    return updated


@router.delete("/sales/{sale_id}")
async def delete_sale(sale_id: str, request: Request):
    user = await require_user(request)

    result = await db.sales_entries.delete_one(
        {"sale_id": sale_id, "shop_id": user.get("shop_id")},
    )

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Catatan penjualan tidak ditemukan")

    return {"ok": True}
