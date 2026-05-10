"""Pydantic models shared across route modules."""
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


# ---- Auth ----
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    auth_provider: str
    shop_id: Optional[str] = None


class GoogleSessionIn(BaseModel):
    session_id: str


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


# ---- Shops ----
class ShopIn(BaseModel):
    storefront_mode: Optional[str] = None
    storefront_style: Optional[str] = None
    storefront_renderer: Optional[str] = None
    # LAPAKIN_STOREFRONT_LAYOUT_VARIANT_V1
    storefront_layout_variant: Optional[str] = ""
    storefront_hero_title: Optional[str] = ""
    storefront_hero_subtitle: Optional[str] = ""
    storefront_cta_label: Optional[str] = ""
    storefront_featured_title: Optional[str] = ""
    storefront_featured_product_ids: Optional[List[str]] = None
    storefront_show_promo: Optional[bool] = False
    storefront_promo_title: Optional[str] = ""
    storefront_promo_text: Optional[str] = ""
    storefront_promo_cta_label: Optional[str] = ""
    storefront_promo_slug: Optional[str] = ""
    storefront_show_payment_instruction: Optional[bool] = False
    storefront_payment_method_label: Optional[str] = ""
    storefront_payment_instruction: Optional[str] = ""
    payment_instruction: Optional[str] = ""
    payment_notes: Optional[str] = ""          # legacy alias
    storefront_qris_image: Optional[str] = ""
    storefront_seo_title: Optional[str] = ""
    storefront_seo_description: Optional[str] = ""
    storefront_seo_image: Optional[str] = ""
    storefront_payment_confirmation_text: Optional[str] = ""
    storefront_whatsapp_checkout_template: Optional[str] = ""
    storefront_whatsapp_product_template: Optional[str] = ""
    storefront_show_location_map: Optional[bool] = False
    storefront_location_title: Optional[str] = ""
    storefront_location_address: Optional[str] = ""
    storefront_google_maps_url: Optional[str] = ""
    storefront_location_embed_url: Optional[str] = ""
    # Storefront testimonials
    storefront_show_testimonials: Optional[bool] = False
    storefront_testimonials: Optional[List[dict]] = []
    storefront_about_title: Optional[str] = ""
    name: str
    tagline: Optional[str] = ""
    description: Optional[str] = ""
    category_id: Optional[str] = ""
    category: Optional[str] = ""
    category_name: Optional[str] = ""
    is_active: Optional[bool] = True
    availability_status: Optional[str] = "active"
    business_type: str  # kuliner / kopi / fashion / kerajinan / kecantikan / lainnya
    whatsapp: Optional[str] = ""
    whatsapp_number: Optional[str] = ""        # legacy alias for whatsapp
    order_whatsapp_enabled: Optional[bool] = True
    pickup_available: Optional[bool] = False
    delivery_available: Optional[bool] = False
    brand_color: Optional[str] = "#C04A3B"
    logo_url: Optional[str] = ""
    # Storefront Pro
    cover_image: Optional[str] = ""           # base64 data URL
    about: Optional[str] = ""                 # AI-generated story
    hours: Optional[str] = ""                 # e.g., "Senin-Sabtu 08:00-21:00"
    address: Optional[str] = ""
    store_address: Optional[str] = ""          # canonical dashboard field
    location_address: Optional[str] = ""       # legacy alias
    has_offline_store: Optional[bool] = False
    show_location: Optional[bool] = False      # legacy alias
    google_maps_url: Optional[str] = ""
    google_maps_link: Optional[str] = ""       # legacy alias
    service_area: Optional[str] = ""
    instagram: Optional[str] = ""             # handle without @
    tiktok: Optional[str] = ""                # handle without @
    shopee: Optional[str] = ""                # URL
    promo_active: Optional[bool] = False
    promo_title: Optional[str] = ""
    promo_description: Optional[str] = ""
    promo_code: Optional[str] = ""
    story: List[dict] = []                    # [{image, caption}] max 5
    # Sales mode
    sells_by: Optional[str] = "stock"         # "stock" | "hours" | "always"
    is_open: Optional[bool] = True            # only relevant when sells_by == "hours"
    # Auto-schedule — 7 entries idx 0=Senin..6=Minggu.
    # Each entry: {"open": "HH:MM", "close": "HH:MM"} (single shift, legacy) OR
    #             {"shifts": [{"open": "HH:MM", "close": "HH:MM"}, ...]} (multi-shift, F&B Pro).
    # None/empty dict = tutup hari itu.
    auto_schedule_enabled: Optional[bool] = False
    schedule: List[Optional[dict]] = []
    # F&B enhancements
    snooze_until: Optional[str] = None                     # ISO datetime; effective close until this moment
    last_order_minutes_before_close: Optional[int] = 0     # e.g., 30 = last order 30 min before close


class ShopOut(ShopIn):
    shop_id: str
    slug: str
    owner_user_id: str
    created_at: str


class CustomDomainIn(BaseModel):
    domain: str


# ---- Products ----
class ProductIn(BaseModel):
    name: str
    price: int = Field(ge=0)
    stock: int = Field(ge=0, default=0)
    description: Optional[str] = ""
    image_data: Optional[str] = ""  # primary image (kept for backward compat — first item of images)
    images: List[str] = []           # all images (data URLs or base64)
    ig_caption: Optional[str] = ""
    tiktok_caption: Optional[str] = ""
    hashtags: List[str] = []
    # Per-product day availability — empty list = setiap hari.
    # 0=Senin … 6=Minggu (Python's weekday() convention).
    available_days: List[int] = []
    sort_order: Optional[int] = 0
    is_active: Optional[bool] = True
    availability_status: Optional[str] = "active"

class ProductOut(ProductIn):
    product_id: str
    shop_id: str
    created_at: str


# ---- AI ----
class AIContentIn(BaseModel):
    product_name: str
    business_type: Optional[str] = ""
    shop_name: Optional[str] = ""
    extra_hints: Optional[str] = ""


class AIThemeIn(BaseModel):
    business_type: str
    shop_name: str


class AIAboutIn(BaseModel):
    shop_name: str
    business_type: str
    tagline: Optional[str] = ""
    description: Optional[str] = ""


class AICoverIn(BaseModel):
    shop_name: str
    business_type: str
    style: Optional[str] = "warm"  # warm / minimal / vibrant


class AIEnhanceIn(BaseModel):
    image_base64: str  # raw base64, no data: prefix
    style: Optional[str] = "clean"  # clean / lifestyle / minimal


# ---- Admin ----
class TierIn(BaseModel):
    tier: str  # "free" | "starter" | "pro" | "business"


class StatusIn(BaseModel):
    status: str  # "active" | "suspended"


class FeaturedIn(BaseModel):
    featured: bool


class BroadcastIn(BaseModel):
    title: str
    message: str
    target: str = "all"  # "all" | "whatsapp"
    variant: str = "info"  # "info" | "success" | "warning"
    active: bool = True


# ---- Analytics ----
class AnalyticsTrackIn(BaseModel):
    event: str  # "view_product" | "click_order" | "share_wa" | "view_shop"
    product_id: Optional[str] = None
    slug: Optional[str] = None
