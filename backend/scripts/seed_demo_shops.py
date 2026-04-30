"""
Seed script: bikin 2 toko demo (kuliner + fashion) lengkap dengan produk.

Usage:
  cd /app/backend  (atau /home/lapakin/LapakinUMKM/backend di VPS)
  source .venv/bin/activate
  python -m scripts.seed_demo_shops

Idempotent: kalau toko sudah ada (slug match), update saja, tidak duplikasi.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Setup path supaya bisa import deps.py dari backend root
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

import bcrypt

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# ---------- Demo Shops ----------
DEMO_SHOPS = [
    {
        "owner": {
            "email": "warungbusari@demo.lapakin.id",
            "password": "demo12345",
            "name": "Bu Sari",
        },
        "shop": {
            "slug": "warung-bu-sari",
            "name": "Warung Bu Sari",
            "tagline": "Masakan rumahan Jawa, hangat & murah meriah",
            "description": "Sudah 12 tahun jualan masakan rumah di Pasar Beringharjo.",
            "business_type": "kuliner",
            "whatsapp": "+6281234567890",
            "brand_color": "#C04A3B",
            "tagline_extra": "",
            "about": (
                "Halo! Saya Bu Sari, ibu rumah tangga dari Jogja yang udah 12 tahun "
                "jual masakan rumah di Pasar Beringharjo. Semua resep turun-temurun "
                "dari nenek, dimasak fresh tiap hari. Yang paling laku: sambel pecel "
                "+ urap segar, langganan tetangga komplek!"
            ),
            "hours": "Senin-Sabtu 07:00-15:00",
            "address": "Pasar Beringharjo Lt. 1 Blok B-23, Yogyakarta",
            "instagram": "warungbusari",
            "tiktok": "",
            "shopee": "",
            "promo_active": True,
            "promo_title": "Promo Bundle Hemat",
            "promo_description": "Beli 5 porsi nasi rames gratis 1 es teh manis!",
            "promo_code": "RAMES5",
            "story": [],
            "sells_by": "hours",
            "is_open": True,
            "auto_schedule_enabled": True,
            "schedule": [
                {"open": "07:00", "close": "15:00"},   # Senin
                {"open": "07:00", "close": "15:00"},   # Selasa
                {"open": "07:00", "close": "15:00"},   # Rabu
                {"open": "07:00", "close": "15:00"},   # Kamis
                {"open": "07:00", "close": "15:00"},   # Jumat
                {"open": "07:00", "close": "13:00"},   # Sabtu
                None,                                   # Minggu tutup
            ],
        },
        "products": [
            {
                "name": "Nasi Rames Komplit",
                "price": 18000, "stock": 50,
                "description": "Nasi putih + ayam goreng + sambel pecel + urap + tahu tempe + telur dadar. Porsi mengenyangkan untuk makan siang.",
                "ig_caption": "Nasi rames komplit ala Bu Sari, sambel pecel & urap-nya pakai bumbu kacang asli ulekan tangan 🌶️ Cocok buat makan siang di kantor atau dibawa pulang. Order via WA ya!",
                "tiktok_caption": "POV: kamu nemu nasi rames Jogja yang masih bumbu nenek 😍 #masakanrumah #jogjafood",
                "hashtags": ["#nasirames", "#masakanrumah", "#kulinerjogja", "#warungumkm", "#sambalpecel", "#makansiang", "#beringharjo", "#jajanjogja"],
                "available_days": [0, 1, 2, 3, 4, 5],
            },
            {
                "name": "Sambel Pecel Botol",
                "price": 25000, "stock": 30,
                "description": "Sambel pecel asli ulekan tangan, tahan 2 minggu di kulkas. Cocok untuk stok di rumah / oleh-oleh keluar Jogja.",
                "ig_caption": "Sambel pecel asli Bu Sari sekarang ada versi botol! Tahan 2 minggu, tinggal cocol ke gorengan/sayur. 🥜",
                "tiktok_caption": "Bawa pulang ke Jakarta? Sambel pecel botol ini juaranya 🔥",
                "hashtags": ["#sambelpecel", "#oleholehjogja", "#sambelbotol", "#kulinertradisional", "#beringharjo", "#jajanjogja"],
                "available_days": [],
            },
            {
                "name": "Es Teh Manis Jumbo",
                "price": 5000, "stock": 100,
                "description": "Es teh manis 500ml, segar untuk siang panas. Pakai gula asli, bukan sirup.",
                "ig_caption": "Es teh jumbo Rp 5rb aja, segarnya kebangetan ☀️",
                "tiktok_caption": "5 ribu doang. 500 ml. Es teh terlaris di Beringharjo 🧋",
                "hashtags": ["#esteh", "#minumansegar", "#warungumkm", "#kulinerjogja"],
                "available_days": [],
            },
            {
                "name": "Gudeg Special",
                "price": 22000, "stock": 25,
                "description": "Gudeg basah Jogja autentik dengan ayam, telur, krecek. Pedas? Ada sambel khas.",
                "ig_caption": "Gudeg basah Bu Sari, manis legit dari nangka muda yang dimasak 6 jam 🍛",
                "tiktok_caption": "Gudeg yang bikin kangen Jogja walau lagi di Jakarta 🥺",
                "hashtags": ["#gudeg", "#gudegjogja", "#kulinertradisional", "#masakanrumah", "#beringharjo"],
                "available_days": [4, 5, 6],   # weekend only
            },
        ],
    },

    {
        "owner": {
            "email": "kainkita@demo.lapakin.id",
            "password": "demo12345",
            "name": "Mba Rina",
        },
        "shop": {
            "slug": "kain-kita-bandung",
            "name": "Kain Kita Bandung",
            "tagline": "Fashion lokal, kain etnik kekinian",
            "description": "Brand fashion lokal Bandung, kain Indonesia gaya streetwear modern.",
            "business_type": "fashion",
            "whatsapp": "+6285678901234",
            "brand_color": "#7C5E3C",   # warm earth brown
            "about": (
                "Kain Kita lahir 2022 di Bandung dari kecintaan kami sama kain "
                "tradisional Indonesia. Kami collab langsung dengan pengrajin tenun "
                "Garut & batik Pekalongan, lalu rancang jadi outer streetwear yang "
                "bisa dipakai sehari-hari. Setiap piece ada cerita pengrajin di "
                "balik labelnya. Slow fashion dengan jiwa muda."
            ),
            "hours": "Senin-Minggu 10:00-21:00 (DM IG fast response)",
            "address": "Jl. Trunojoyo No. 12, Bandung",
            "instagram": "kainkita.id",
            "tiktok": "kainkita",
            "shopee": "https://shopee.co.id/kainkita",
            "promo_active": True,
            "promo_title": "Free Ongkir JABODETABEK",
            "promo_description": "Min belanja Rp 200rb, otomatis bebas ongkir Jabodetabek pakai kode KAINFREE",
            "promo_code": "KAINFREE",
            "story": [],
            "sells_by": "stock",
            "is_open": True,
            "auto_schedule_enabled": False,
            "schedule": [],
        },
        "products": [
            {
                "name": "Outer Tenun Garut Mocha",
                "price": 285000, "stock": 12,
                "description": "Outer kimono panjang dari kain tenun Garut warna mocha cream. Cocok dipakai di atas kaos polos atau dress. Pengrajin: Pak Asep, Garut.",
                "ig_caption": "Outer tenun Garut yang bikin look-mu langsung etnik tanpa norak 🤎 Pengrajin: Pak Asep & timnya di Garut, dirancang ulang biar fit ke streetwear.",
                "tiktok_caption": "Outer tenun yang dipuji bos kantor padahal lagi minimum effort 😎",
                "hashtags": ["#fashionlokal", "#tenungaru", "#slowfashion", "#outetenun", "#kainindonesia", "#streetwearetnik", "#bandungfashion"],
                "available_days": [],
            },
            {
                "name": "Kemeja Batik Pekalongan Indigo",
                "price": 195000, "stock": 18,
                "description": "Kemeja batik tulis Pekalongan motif Mega Mendung modifikasi. Warna indigo pakai pewarna alam dari nila. Unisex, fit oversized.",
                "ig_caption": "Batik tulis Pekalongan yang pewarnanya dari tumbuhan nila 🌿 Each piece tone-nya beda dikit karena natural dye, jadi punyamu unik!",
                "tiktok_caption": "Batik bukan cuma buat kondangan. Pakai kemeja indigo ini ke kafe juga bagus 🔥",
                "hashtags": ["#batikpekalongan", "#batiktulis", "#fashionlokal", "#naturaldye", "#kemejabatik", "#slowfashion"],
                "available_days": [],
            },
            {
                "name": "Tote Bag Tenun Recycled",
                "price": 125000, "stock": 25,
                "description": "Tote bag dari sisa kain tenun + lining canvas recycled. Muat laptop 14 inch. Dijahit pengrajin Bandung Selatan.",
                "ig_caption": "Tote bag ini bahan bakunya scrap kain tenun yang biasanya dibuang 💚 Sustainable fashion versi gak boring.",
                "tiktok_caption": "Tote bag yang nge-statement banget. Sekali pakai, dipuji 5 orang seharian 😆",
                "hashtags": ["#totebagtenun", "#sustainablefashion", "#fashionlokal", "#zerowaste", "#bandungcrafts"],
                "available_days": [],
            },
            {
                "name": "Celana Sarung Bali Maroon",
                "price": 165000, "stock": 8,
                "description": "Celana model sarung Bali, motif endek maroon. Bahan adem cocok untuk cuaca tropis. Karet pinggang elastis.",
                "ig_caption": "Celana sarung Bali yang bikin liburan makin chill 🌺 Bahan endek aslinya, adem dipakai seharian.",
                "tiktok_caption": "Celana enak banget buat WFH atau ke pantai 🏖️",
                "hashtags": ["#kainendek", "#fashionbali", "#celanasarung", "#fashionlokal", "#slowfashion"],
                "available_days": [],
            },
            {
                "name": "Scarf Tenun Mini",
                "price": 85000, "stock": 30,
                "description": "Scarf kecil tenun warna-warni untuk aksen leher / handle bag. 8 motif tersedia, request via WA.",
                "ig_caption": "Scarf tenun mini, aksen kecil yang bikin outfit naik level. 8 motif berbeda, milih warna-mu lewat WA ya 🧣",
                "tiktok_caption": "Tinggal iket di handle bag, bag IKEA aja jadi keliatan branded 😂",
                "hashtags": ["#scarftenun", "#aksesoris", "#fashionlokal", "#slowfashion"],
                "available_days": [],
            },
        ],
    },
]


async def seed():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print(f"Connected to {MONGO_URL} → {DB_NAME}")

    for entry in DEMO_SHOPS:
        owner = entry["owner"]
        shop = entry["shop"]
        products = entry["products"]

        # 1. Owner user (idempotent: upsert)
        existing_user = await db.users.find_one({"email": owner["email"]})
        if existing_user:
            user_id = existing_user["user_id"]
            print(f"✓ User exists: {owner['email']} ({user_id})")
        else:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            now = datetime.now(timezone.utc)
            await db.users.insert_one({
                "user_id": user_id,
                "email": owner["email"],
                "password_hash": hash_pw(owner["password"]),
                "name": owner["name"],
                "picture": "",
                "auth_provider": "email",
                "shop_id": None,
                "tier": "pro",
                "trial": True,
                "trial_expires_at": (now + timedelta(days=14)).isoformat(),
                "created_at": now.isoformat(),
            })
            print(f"+ Created user: {owner['email']}")

        # 2. Shop (idempotent: upsert by slug)
        existing_shop = await db.shops.find_one({"slug": shop["slug"]})
        if existing_shop:
            shop_id = existing_shop["shop_id"]
            await db.shops.update_one(
                {"shop_id": shop_id},
                {"$set": {**shop,
                          "owner_user_id": user_id,
                          "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
            print(f"✓ Shop exists, updated: {shop['slug']}")
        else:
            shop_id = f"shop_{uuid.uuid4().hex[:12]}"
            await db.shops.insert_one({
                "shop_id": shop_id,
                "owner_user_id": user_id,
                **shop,
                "featured": True,    # show on landing
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"+ Created shop: {shop['slug']} ({shop_id})")

        await db.users.update_one({"user_id": user_id}, {"$set": {"shop_id": shop_id}})

        # 3. Products (delete + recreate so reseed always clean)
        await db.products.delete_many({"shop_id": shop_id})
        for p in products:
            product_id = f"prod_{uuid.uuid4().hex[:12]}"
            await db.products.insert_one({
                "product_id": product_id,
                "shop_id": shop_id,
                **p,
                "image_data": "",
                "images": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        print(f"  + {len(products)} produk seeded")

    print("\n✅ Done. Demo shops:")
    for entry in DEMO_SHOPS:
        print(f"  • https://lapakin.my.id/toko/{entry['shop']['slug']}")
    print("\nLogin demo:")
    for entry in DEMO_SHOPS:
        print(f"  {entry['owner']['email']} / {entry['owner']['password']}")

    client.close()


if __name__ == "__main__":
    asyncio.run(seed())
