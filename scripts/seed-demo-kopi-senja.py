import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from deps import db

SHOP_ID = "demo_shop_kopi_senja"
OWNER_ID = "demo_owner_kopi_senja"
SLUG = "kopi-senja"
NOW = datetime.now(timezone.utc).isoformat()

PRODUCTS = [
    ("demo_kopi_espresso", "Espresso Pagi", 18000, "Kopi", "Shot espresso tebal dengan body cokelat dan aftertaste kacang panggang.", "espresso.svg"),
    ("demo_kopi_latte_aren", "Latte Aren", 26000, "Kopi Susu", "Espresso, susu segar, dan gula aren cair. Creamy, manisnya pas.", "latte-aren.svg"),
    ("demo_kopi_cold_brew", "Cold Brew Senja", 28000, "Kopi Dingin", "Kopi seduh dingin 14 jam, ringan, smooth, dan segar.", "cold-brew.svg"),
    ("demo_kopi_manual_brew", "Manual Brew V60", 30000, "Manual Brew", "Filter coffee harian dengan notes buah kering dan floral lembut.", "manual-brew.svg"),
    ("demo_kopi_mocha", "Mocha Cokelat", 29000, "Kopi Susu", "Espresso, susu, dan cokelat pekat untuk rasa hangat yang nyaman.", "mocha.svg"),
    ("demo_kopi_croissant", "Croissant Butter", 22000, "Pastry", "Croissant buttery renyah, cocok untuk teman kopi pagi atau sore.", "croissant.svg"),
]

async def main():
    await db.users.update_one(
        {"user_id": OWNER_ID},
        {"$set": {"user_id": OWNER_ID, "email": "demo-kopi-senja@lapakin.local", "name": "Owner Kopi Senja", "auth_provider": "demo", "shop_id": SHOP_ID, "tier": "business", "updated_at": NOW}, "$setOnInsert": {"created_at": NOW}},
        upsert=True,
    )
    await db.shops.update_one(
        {"shop_id": SHOP_ID},
        {"$set": {
            "shop_id": SHOP_ID,
            "slug": SLUG,
            "owner_user_id": OWNER_ID,
            "name": "Kopi Senja",
            "tagline": "Slow coffee bar untuk jeda yang layak",
            "description": "Kedai kopi kecil dengan espresso, latte aren, cold brew, manual brew, dan pastry hangat.",
            "about": "Kopi Senja lahir dari kebiasaan menikmati kopi pelan-pelan. Kami memilih biji yang nyaman diminum harian, menyeduh manual brew saat meja mulai tenang, dan menyiapkan kopi susu untuk teman kerja santai.",
            "business_type": "kopi",
            "category": "Kopi & Minuman",
            "brand_color": "#8b4f2f",
            "cover_image": f"/{SLUG}/assets/cover.svg",
            "hours": "Senin-Minggu 08:00-22:00",
            "whatsapp": "081234567890",
            "order_whatsapp_enabled": True,
            "pickup_available": True,
            "delivery_available": True,
            "store_address": "Jl. Senja No. 17, Yogyakarta",
            "google_maps_url": "https://maps.google.com/?q=Yogyakarta",
            "service_area": "Yogyakarta kota dan sekitar",
            "instagram": "kopisenja.demo",
            "website_mode": "external_custom",
            "external_website_url": "https://dev.lapakin.my.id/kopi-senja/",
            "external_website_label": "Buka Kopi Senja",
            "external_website_behavior": "redirect",
            "storefront_mode": "food_menu",
            "storefront_style": "premium",
            "storefront_renderer": "template",
            "storefront_hero_title": "Kopi pelan untuk sore yang lebih hangat.",
            "storefront_hero_subtitle": "Espresso, latte aren, cold brew, dan pastry hangat dari bar kecil kami.",
            "storefront_cta_label": "Pesan Kopi Sekarang",
            "storefront_featured_title": "Racikan Favorit Hari Ini",
            "storefront_featured_product_ids": [p[0] for p in PRODUCTS[:4]],
            "storefront_show_payment_instruction": True,
            "storefront_payment_method_label": "Transfer & QRIS",
            "storefront_payment_instruction": "Pembayaran bisa via QRIS di kasir atau transfer setelah admin konfirmasi pesanan.",
            "storefront_whatsapp_checkout_template": "Halo {shop_name}, saya mau pesan:\n\n{items}\n\nTotal: {total}\nNama: {customer_name}\nCatatan: {notes}\n{payment_instruction}",
            "storefront_whatsapp_product_template": "Halo {shop_name}, saya mau tanya menu:\n\n{product_name}\nHarga: {product_price}\n\nApakah tersedia hari ini?",
            "storefront_seo_title": "Kopi Senja · Slow Coffee Bar",
            "storefront_seo_description": "Espresso, latte aren, cold brew, manual brew, dan pastry hangat dari Kopi Senja.",
            "status": "active",
            "is_active": True,
            "updated_at": NOW,
        }, "$setOnInsert": {"created_at": NOW}},
        upsert=True,
    )
    await db.products.delete_many({"shop_id": SHOP_ID})
    docs = []
    for sort_order, (pid, name, price, category, desc, image) in enumerate(PRODUCTS, 1):
        docs.append({
            "product_id": pid,
            "shop_id": SHOP_ID,
            "name": name,
            "price": price,
            "stock": 99,
            "description": desc,
            "category": category,
            "category_name": category,
            "image_data": f"/{SLUG}/assets/{image}",
            "images": [f"/{SLUG}/assets/{image}"],
            "availability_status": "active",
            "is_active": True,
            "sort_order": sort_order,
            "created_at": NOW,
            "updated_at": NOW,
        })
    await db.products.insert_many(docs)
    print({"shop": SLUG, "products": len(docs), "url": f"https://dev.lapakin.my.id/{SLUG}/"})

loop = asyncio.get_event_loop()
loop.run_until_complete(main())
