"""Products CRUD routes."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from deps import db, require_user
from models import ProductIn
from tiers import get_tier, get_limits, is_unlimited

router = APIRouter()


@router.get("/products")
async def list_my_products(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        return []
    products = await db.products.find(
        {"shop_id": user["shop_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return products


@router.post("/products")
async def create_product(data: ProductIn, request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Toko belum dibuat")
    # Tier limit: max products
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
    if not payload.get("images") and payload.get("image_data"):
        payload["images"] = [payload["image_data"]]
    elif payload.get("images") and not payload.get("image_data"):
        payload["image_data"] = payload["images"][0]
    doc = {
        "product_id": product_id, "shop_id": user["shop_id"],
        **payload,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.products.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductIn, request: Request):
    user = await require_user(request)
    p = await db.products.find_one({"product_id": product_id})
    if not p or p["shop_id"] != user.get("shop_id"):
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    payload = data.model_dump()
    if not payload.get("images") and payload.get("image_data"):
        payload["images"] = [payload["image_data"]]
    elif payload.get("images") and not payload.get("image_data"):
        payload["image_data"] = payload["images"][0]
    await db.products.update_one({"product_id": product_id}, {"$set": payload})
    updated = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    return updated


@router.delete("/products/{product_id}")
async def delete_product(product_id: str, request: Request):
    user = await require_user(request)
    p = await db.products.find_one({"product_id": product_id})
    if not p or p["shop_id"] != user.get("shop_id"):
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.products.delete_one({"product_id": product_id})
    return {"ok": True}
