import { Component, useEffect, useMemo, useRef, useState } from "react";
import "./storefront-template-renderer.css";

function cx(...classes) {
  return classes
    .flatMap((item) => {
      if (!item) return [];
      if (typeof item === "string") return [item];
      if (typeof item === "object") {
        return Object.entries(item)
          .filter(([, enabled]) => Boolean(enabled))
          .map(([className]) => className);
      }
      return [];
    })
    .join(" ");
}

function getShop(data) {
  return (
    data?.shop ||
    data?.store ||
    data?.tenant ||
    data?.data?.shop ||
    data?.data?.store ||
    data ||
    {}
  );
}

function getProducts(data) {
  const candidates = [
    data?.products,
    data?.items,
    data?.data?.products,
    data?.data?.items,
    data?.shop?.products,
    data?.store?.products,
  ];

  const found = candidates.find((item) => Array.isArray(item));
  return found || [];
}

function getValue(obj, keys, fallback = "") {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function getProductId(product, index) {
  return getValue(product, ["id", "_id", "product_id", "sku"], `product-${index}`);
}

function getProductName(product) {
  return getValue(product, ["name", "title", "product_name"], "Produk");
}

function getProductDescription(product) {
  return getValue(product, ["description", "desc", "short_description", "caption"], "");
}

function getProductCategory(product) {
  return getValue(product, ["category", "category_name", "type"], "Pilihan");
}

function getProductCategoryKey(product) {
  const raw = getProductCategory(product);
  return String(raw || "").trim().toLowerCase();
}

function productMatchesTemplateSearch(product, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  return [
    getProductName(product),
    getProductDescription(product),
    getProductCategory(product),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

// LAPAKIN_TEMPLATE_AVAILABILITY_F2
function getTemplateProductAvailability(product) {
  const raw = String(product?.availability_status || "").trim().toLowerCase();
  if (raw === "out_of_stock" || raw === "hidden") return raw;
  if (product?.is_active === false) return "hidden";
  return "active";
}

function isTemplateProductHidden(product) {
  return getTemplateProductAvailability(product) === "hidden";
}

function isTemplateProductOutOfStock(product) {
  return getTemplateProductAvailability(product) === "out_of_stock";
}

function getProductImage(product) {
  const image = getValue(product, [
    "image_url",
    "image",
    "photo_url",
    "thumbnail_url",
    "thumbnail",
    "cover_url",
  ]);

  if (image) return image;

  const images = product?.images || product?.photos || product?.media;
  if (Array.isArray(images) && images.length) {
    const first = images[0];
    if (typeof first === "string") return first;
    return first?.url || first?.image_url || first?.src || "";
  }

  return "";
}

function getProductPrice(product) {
  const price = getValue(product, ["price", "selling_price", "amount", "base_price"], 0);
  const number = Number(price);
  return Number.isFinite(number) ? number : 0;
}

function formatPrice(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "Hubungi toko";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(number);
}

function normalizeWhatsapp(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  return digits;
}



function isLegacyPromoLikeSection(section) {
  const key = String(section || "").toLowerCase();

  return (
    key === "cta" ||
    key === "quick_cta" ||
    key === "order_cta" ||
    key === "banner_cta" ||
    key === "cta_banner" ||
    key === "promo_cta" ||
    key === "promo_card" ||
    key === "promotion" ||
    key === "campaign" ||
    key === "announcement" ||
    key === "highlight_cta" ||
    key === "template_cta" ||
    key.includes("promo") ||
    key.includes("campaign") ||
    key.includes("announcement")
  );
}

function shouldShowPromoBanner(shop) {
  return Boolean(shop?.storefront_show_promo);
}


function getPromoSlug(shop) {
  const raw =
    String(shop?.storefront_promo_slug || "").trim() ||
    String(shop?.storefront_promo_title || "").trim() ||
    "promo";

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "promo";
}

function getPromoTitle(shop) {
  return String(shop?.storefront_promo_title || "").trim() || "Promo Spesial";
}

function getPromoText(shop) {
  return String(shop?.storefront_promo_text || "").trim() || "Hubungi kami untuk penawaran terbaik hari ini.";
}

function getPromoCtaLabel(shop) {
  return String(shop?.storefront_promo_cta_label || "").trim() || "Chat Sekarang";
}

function shouldShowPaymentInstruction(shop) {
  return Boolean(
    shop?.storefront_show_payment_instruction &&
    (shop?.storefront_payment_instruction || shop?.storefront_qris_image || shop?.storefront_payment_method_label)
  );
}

function getPaymentMethodLabel(shop) {
  return String(shop?.storefront_payment_method_label || "QRIS / Transfer Manual").trim();
}

function getPaymentInstruction(shop) {
  return String(
    shop?.storefront_payment_instruction ||
    "Silakan lakukan pembayaran sesuai instruksi toko, lalu kirim bukti pembayaran melalui WhatsApp."
  ).trim();
}

function getPaymentConfirmationText(shop) {
  return String(
    shop?.storefront_payment_confirmation_text ||
    "Saya akan kirim bukti pembayaran via WhatsApp setelah checkout."
  ).trim();
}


// LAPAKIN_TEMPLATE_PRODUCT_WHATSAPP_G1C
const TEMPLATE_DEFAULT_WHATSAPP_PRODUCT_TEMPLATE = `Halo {shop_name}, saya mau tanya produk:

{product_name}
Harga: {product_price}

Apakah masih tersedia?`;

function renderProductWhatsappTemplate(template, variables) {
  let text = String(template || TEMPLATE_DEFAULT_WHATSAPP_PRODUCT_TEMPLATE || "");

  Object.entries(variables || {}).forEach(([key, value]) => {
    const pattern = new RegExp(`\\{${key}\\}`, "g");
    text = text.replace(pattern, value == null ? "" : String(value));
  });

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function buildWhatsappLink(shop, product) {
  const phone = normalizeWhatsapp(
    getValue(shop, [
      "whatsapp",
      "whatsapp_number",
      "phone",
      "phone_number",
      "contact_phone",
      "wa_number",
    ])
  );

  if (!phone) return "#";

  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "toko");
  const productName = product ? getProductName(product) : "";
  const productPrice = product ? formatPrice(getProductPrice(product)) : "";
  const campaignSlug = getCampaignSlugFromUrl();

  const productTemplate = String(shop?.storefront_whatsapp_product_template || "").trim() ||
    TEMPLATE_DEFAULT_WHATSAPP_PRODUCT_TEMPLATE;

  const message = productName
    ? renderProductWhatsappTemplate(productTemplate, {
        shop_name: shopName,
        product_name: productName,
        product_price: productPrice,
        campaign_slug: campaignSlug,
      })
    : `Halo ${shopName}, saya ingin bertanya.`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}




// LAPAKIN_GROWTH_SPRINT_V2_TEMPLATE_HELPERS
function getApiBaseUrl() {
  const raw = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
  if (!raw) return "/api";
  return raw.endsWith("/api") ? raw : `${raw}/api`;
}

function postStorefrontJson(path, payload) {
  if (typeof window === "undefined") return Promise.resolve({ ok: true });
  const url = `${getApiBaseUrl()}${path}`;
  try {
    const body = JSON.stringify(payload || {});
    if (navigator.sendBeacon && path === "/storefront/events") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return Promise.resolve({ ok: true });
    }
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => ({ ok: true }));
  } catch { return Promise.resolve({ ok: true }); }
}
function getCampaignSlugFromUrl() { try { return new URLSearchParams(window.location.search).get("promo") || ""; } catch { return ""; } }
function getTrafficSourceFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const utm = params.get("utm_source");
    if (utm) return utm;
    if (!document.referrer) return "direct";
    const host = new URL(document.referrer).hostname.toLowerCase();
    if (host.includes("instagram")) return "instagram";
    if (host.includes("tiktok")) return "tiktok";
    if (host.includes("facebook") || host.includes("fb.")) return "facebook";
    if (host.includes("whatsapp") || host.includes("wa.me")) return "whatsapp";
    if (host.includes("google")) return "google";
    return host.replace(/^www\./, "");
  } catch { return "direct"; }
}
function getShopId(shop) { return getValue(shop, ["shop_id", "id", "_id"], ""); }
function getAnalyticsBasePayload(shop) {
  return { shop_id: getShopId(shop) || undefined, shop_slug: getShopSlug(shop) || undefined, campaign_slug: getCampaignSlugFromUrl() || undefined, source: getTrafficSourceFromUrl() };
}
function trackTemplateEvent(shop, event_type, extra = {}) {
  return postStorefrontJson("/storefront/events", { ...getAnalyticsBasePayload(shop), event_type, ...extra, metadata: extra.metadata || {} });
}
function enrichWhatsappHrefWithLead(href, form) {
  if (!href || href === "#") return href;
  try {
    const url = new URL(href);
    const currentText = url.searchParams.get("text") || "";
    const extraLines = ["", "Data pelanggan:", form.customer_name ? `Nama: ${form.customer_name}` : "", form.customer_phone ? `No HP: ${form.customer_phone}` : "", form.fulfillment_method ? `Metode: ${form.fulfillment_method}` : "", form.notes ? `Catatan: ${form.notes}` : ""].filter(Boolean);
    url.searchParams.set("text", `${currentText}${extraLines.join("\n")}`);
    return url.toString();
  } catch { return href; }
}
function openWhatsappHref(href) {
  // LAPAKIN_OPEN_WHATSAPP_ONCE_V1
  if (!href || href === "#") return;

  try {
    // Do not use an immediate window.location fallback here.
    // Some browsers return null for window.open with noopener/noreferrer even when a new tab was opened,
    // which caused WhatsApp to open twice.
    window.open(href, "_blank");
  } catch {
    window.location.assign(href);
  }
}
// /LAPAKIN_GROWTH_SPRINT_V2_TEMPLATE_HELPERS

function normalizeSocialUrl(value, platform) {
  if (!value) return "";

  let raw = String(value).trim();
  if (!raw) return "";

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  raw = raw.replace(/^@+/, "");

  if (platform === "instagram") {
    return `https://instagram.com/${raw}`;
  }

  if (platform === "tiktok") {
    return `https://www.tiktok.com/@${raw}`;
  }

  if (platform === "shopee") {
    return raw.includes(".") ? `https://${raw.replace(/^https?:\/\//, "")}` : `https://shopee.co.id/${raw}`;
  }

  return raw;
}

function getSocialLinks(shop) {
  const socials = shop?.socials || shop?.social_links || {};

  const instagram = getValue(
    {
      ...shop,
      instagram_from_socials: socials.instagram,
      instagram_url_from_socials: socials.instagram_url,
      ig_from_socials: socials.ig,
    },
    [
      "instagram_url",
      "instagram",
      "ig_url",
      "ig",
      "social_instagram",
      "instagram_handle",
      "instagram_from_socials",
      "instagram_url_from_socials",
      "ig_from_socials",
    ],
    ""
  );

  const tiktok = getValue(
    {
      ...shop,
      tiktok_from_socials: socials.tiktok,
      tiktok_url_from_socials: socials.tiktok_url,
    },
    [
      "tiktok_url",
      "tiktok",
      "tik_tok",
      "social_tiktok",
      "tiktok_handle",
      "tiktok_from_socials",
      "tiktok_url_from_socials",
    ],
    ""
  );

  const shopee = getValue(
    {
      ...shop,
      shopee_from_socials: socials.shopee,
      shopee_url_from_socials: socials.shopee_url,
    },
    [
      "shopee_url",
      "shopee",
      "social_shopee",
      "shopee_handle",
      "shopee_from_socials",
      "shopee_url_from_socials",
    ],
    ""
  );

  return [
    {
      key: "instagram",
      label: "Instagram",
      url: normalizeSocialUrl(instagram, "instagram"),
    },
    {
      key: "tiktok",
      label: "TikTok",
      url: normalizeSocialUrl(tiktok, "tiktok"),
    },
    {
      key: "shopee",
      label: "Shopee",
      url: normalizeSocialUrl(shopee, "shopee"),
    },
  ].filter((item) => item.url);
}

function hasAboutContent(shop) {
  return Boolean(
    getValue(
      shop,
      ["about", "description", "bio", "tagline", "story", "business_description"],
      ""
    )
  );
}

function normalizeProductCategory(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  const normalized = value.toLowerCase();

  // Ignore non-category labels/badges that should not become category chips
  if (["pilihan", "siap pesan", "tampil", "aktif", "tersedia"].includes(normalized)) {
    return "";
  }

  if (
    normalized.includes("minuman") ||
    normalized.includes("kopi") ||
    normalized.includes("tea") ||
    normalized.includes("teh") ||
    normalized.includes("jus")
  ) {
    return "Minuman";
  }

  if (
    normalized.includes("makanan") ||
    normalized.includes("kuliner") ||
    normalized.includes("food") ||
    normalized.includes("menu")
  ) {
    return "Makanan";
  }

  return value
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getCategories(products) {
  const seen = new Set();
  const categories = [];

  (products || []).forEach((product) => {
    const candidates = [
      product?.category,
      product?.category_name,
      product?.product_category,
      product?.catalog_category,
      product?.group,
      product?.group_name,
      product?.product_type,
      product?.business_category,
    ];

    candidates.forEach((candidate) => {
      const normalized = normalizeProductCategory(candidate);
      if (!normalized) return;

      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      categories.push(normalized);
    });
  });

  return categories;
}

function getModeFromTemplate(template) {
  const key = template?.templateKey || "";
  if (key.startsWith("food_")) return "food_menu";
  if (key.startsWith("services_")) return "services";
  return "catalog";
}

// LAPAKIN_BUSINESS_TEMPLATE_VARIANTS_V1
const BUSINESS_TEMPLATE_VARIANTS = {
  food_warm_menu: {
    key: "food_warm_menu",
    label: "Food Warm Menu",
    tone: "Hangat, rumahan, menu-first",
    mode: "food_menu",
    rootClass: "ltr-business-food-warm",
    heroEyebrow: "Menu rumahan siap pesan",
    orderLabel: "Pesan Menu Sekarang",
  },
  laundry_clean_service: {
    key: "laundry_clean_service",
    label: "Laundry Clean Service",
    tone: "Bersih, praktis, layanan pickup",
    mode: "services",
    rootClass: "ltr-business-laundry-clean",
    heroEyebrow: "Laundry bersih & praktis",
    orderLabel: "Jadwalkan Pickup",
  },
  fashion_visual_catalog: {
    key: "fashion_visual_catalog",
    label: "Fashion Visual Catalog",
    tone: "Visual, modern, katalog-first",
    mode: "catalog",
    rootClass: "ltr-business-fashion-visual",
    heroEyebrow: "Koleksi pilihan",
    orderLabel: "Lihat Koleksi",
  },
  service_trust_cta: {
    key: "service_trust_cta",
    label: "Service Trust CTA",
    tone: "Profesional, terpercaya, konsultasi",
    mode: "services",
    rootClass: "ltr-business-service-trust",
    heroEyebrow: "Layanan terpercaya",
    orderLabel: "Konsultasi Sekarang",
  },
  craft_story_catalog: {
    key: "craft_story_catalog",
    label: "Craft Story Catalog",
    tone: "Hangat, handmade, story-driven",
    mode: "catalog",
    rootClass: "ltr-business-craft-story",
    heroEyebrow: "Produk lokal penuh cerita",
    orderLabel: "Tanya Custom Order",
  },
};

function normalizeBusinessTemplateText(value) {
  return String(value || "").trim().toLowerCase();
}

function inferBusinessTemplateVariant(shop, template) {
  const explicit = normalizeBusinessTemplateText(
    shop?.storefront_layout_variant ||
    shop?.storefront_template_variant ||
    shop?.template_variant
  );

  if (explicit && BUSINESS_TEMPLATE_VARIANTS[explicit]) {
    return BUSINESS_TEMPLATE_VARIANTS[explicit];
  }

  const raw = [
    shop?.business_type,
    shop?.category,
    shop?.category_name,
    shop?.business_category,
    shop?.description,
    shop?.tagline,
    shop?.name,
  ].map(normalizeBusinessTemplateText).join(" ");

  const mode = normalizeBusinessTemplateText(shop?.storefront_mode) || getModeFromTemplate(template);

  if (/laundry|laundri|cuci|setrika|dry clean|dryclean/.test(raw)) {
    return BUSINESS_TEMPLATE_VARIANTS.laundry_clean_service;
  }

  if (/fashion|baju|pakaian|busana|hijab|sepatu|tas|aksesoris|clothing/.test(raw)) {
    return BUSINESS_TEMPLATE_VARIANTS.fashion_visual_catalog;
  }

  if (/jasa|service|servis|repair|konsultan|konsultasi|booking|salon|barber|ac|maintenance/.test(raw) || mode === "services") {
    return BUSINESS_TEMPLATE_VARIANTS.service_trust_cta;
  }

  if (/kerajinan|craft|handmade|souvenir|hampers|kriya|rajut|batik|anyaman/.test(raw)) {
    return BUSINESS_TEMPLATE_VARIANTS.craft_story_catalog;
  }

  if (/kuliner|makanan|minuman|warung|kopi|cafe|resto|bakso|nasi|snack|kue|catering|food/.test(raw) || mode === "food_menu") {
    return BUSINESS_TEMPLATE_VARIANTS.food_warm_menu;
  }

  return BUSINESS_TEMPLATE_VARIANTS.fashion_visual_catalog;
}

function getBusinessTemplateVariant(shop, template) {
  return inferBusinessTemplateVariant(shop, template) || BUSINESS_TEMPLATE_VARIANTS.fashion_visual_catalog;
}


function ensureSmallFoodMenuCategories(sections, products, template) {
  if (!Array.isArray(sections)) return sections;
  if (!Array.isArray(products) || products.length > 6) return sections;
  if (getModeFromTemplate(template) !== "food_menu") return sections;
  if (getCategories(products).length <= 1) return sections;
  if (sections.includes("categories")) return sections;

  const next = [...sections];
  const menuIndex = next.findIndex((key) =>
    ["featured_products", "today_menu", "menu_list", "menu_grid", "signature_menu"].includes(key)
  );

  if (menuIndex >= 0) {
    next.splice(menuIndex + 1, 0, "categories");
  } else {
    next.unshift("categories");
  }

  return next;
}

function getSectionTitle(section, mode) {
  const titles = {
    hero: "",
    featured_products: mode === "food_menu" ? "Menu Favorit" : mode === "services" ? "Layanan Unggulan" : "Produk Unggulan",
    all_products: mode === "food_menu" ? "Semua Menu" : mode === "services" ? "Semua Layanan" : "Semua Produk",
    today_menu: "Menu Hari Ini",
    menu_list: "Daftar Menu",
    menu_grid: "Pilihan Menu",
    signature_menu: "Signature Menu",
    service_list: "Daftar Layanan",
    categories: mode === "services" ? "Kategori Layanan" : "Kategori",
    collections: "Koleksi Pilihan",
    brand_story: "Cerita Brand",
    about: "Tentang Kami",
    benefits: "Kenapa Pilih Kami",
    testimonials: "Dipercaya Pelanggan",
    promo_banner: "Promo Spesial",
    faq: "Pertanyaan Umum",
    business_hours: "Jam Operasional",
    operational_info: "Info Order",
    contact: "Hubungi Toko",
  };

  return titles[section] || section;
}

function getHeroCopy(mode, template) {
  if (mode === "food_menu") {
    return {
      eyebrow: "Menu siap dipesan",
      titlePrefix: "Nikmati pilihan menu dari",
      subtitle:
        "Pilih menu favorit, cek harga, lalu pesan langsung lewat WhatsApp tanpa ribet.",
      cta: "Pesan Sekarang",
    };
  }

  if (mode === "services") {
    return {
      eyebrow: "Jasa & layanan",
      titlePrefix: "Temukan layanan dari",
      subtitle:
        "Lihat pilihan layanan, estimasi harga, dan konsultasikan kebutuhan kamu langsung ke toko.",
      cta: "Konsultasi Sekarang",
    };
  }

  return {
    eyebrow: template?.label || "Katalog toko",
    titlePrefix: "Belanja mudah di",
    subtitle:
      "Lihat produk pilihan, cek detail dan harga, lalu hubungi toko untuk memesan.",
    cta: "Hubungi Toko",
  };
}



function cleanStorefrontHeroTitle(title, shopName, mode) {
  const raw = String(title || "").trim();
  if (!raw) return "";

  let cleaned = raw
    .replace(/^Menu\s+Menu\b/i, "Menu")
    .replace(/\s+/g, " ")
    .trim();

  // AI fallback kadang terlalu generik untuk toko kuliner.
  // Untuk food menu, buat judul lebih pendek dan natural.
  if (
    mode === "food_menu" &&
    /^Menu enak dari/i.test(cleaned) &&
    shopName
  ) {
    cleaned = `Menu Rumahan ${shopName}`;
  }

  return cleaned;
}

function getShopSlug(shop) {
  return getValue(shop, ["slug", "shop_slug", "store_slug", "subdomain"], "storefront");
}

function getCartStorageKey(shop) {
  return `lapakin_template_cart_${getShopSlug(shop)}`;
}

function getProductSnapshot(product, index = 0) {
  return {
    id: getProductId(product, index),
    name: getProductName(product),
    description: getProductDescription(product),
    category: getProductCategory(product),
    image_url: getProductImage(product),
    price: getProductPrice(product),
  };
}

// LAPAKIN_STOREFRONT_PRODUCT_DETAIL_MODAL_V1
function getProductDetailShareUrl(product, index = 0) {
  const productId = getProductId(product, index);

  if (typeof window === "undefined") {
    return `?product=${encodeURIComponent(productId)}`;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("product", productId);
  url.hash = "";

  return url.toString();
}

function syncProductDetailUrl(product, index = 0) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.set("product", getProductId(product, index));
  url.hash = "";

  window.history.replaceState({}, "", url.toString());
}

function clearProductDetailUrl() {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.delete("product");

  window.history.replaceState({}, "", url.toString());
}


// LAPAKIN_PRODUCT_SHARE_COPY_TOAST_V1
async function copyStorefrontProductShareLink(link) {
  const value = String(link || "").trim();
  if (!value) return false;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, value.length);
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (copied) return true;
    }
  } catch {
    // fallback below
  }

  if (typeof window !== "undefined") {
    window.prompt("Salin link produk:", value);
  }

  return false;
}

// LAPAKIN_PRODUCT_SHARE_COPY_TOAST_V1
function showStorefrontProductShareToast(message = "Link produk sudah disalin") {
  if (typeof document === "undefined") return;

  const toastId = "lapakin-product-share-copy-toast";
  const oldToast = document.getElementById(toastId);
  if (oldToast) oldToast.remove();

  const toast = document.createElement("div");
  toast.id = toastId;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = message;

  Object.assign(toast.style, {
    position: "fixed",
    left: "50%",
    bottom: "24px",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    padding: "10px 14px",
    borderRadius: "999px",
    background: "rgba(17, 24, 39, 0.94)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "800",
    lineHeight: "1",
    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.28)",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 160ms ease, transform 160ms ease",
  });

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(-4px)";
  });

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(4px)";
    window.setTimeout(() => toast.remove(), 180);
  }, 1800);
}


function ProductDetailModal({ open, product, index = 0, shop, onClose, onAddToCart }) {
  if (!open || !product) return null;

  const productId = getProductId(product, index);
  const name = getProductName(product);
  const description = getProductDescription(product);
  const price = getProductPrice(product);
  const category = getProductCategory(product);
  const image = getProductImage(product);
  const outOfStock = isTemplateProductOutOfStock(product);
  const shareUrl = getProductDetailShareUrl(product, index);

  const shareProduct = async () => {
    const copied = await copyStorefrontProductShareLink(shareUrl);
    if (copied) {
      showStorefrontProductShareToast("Link produk sudah disalin");
    }
  };

  return (
    <div
      className="ltr-product-detail-overlay"
      data-testid="storefront-product-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="storefront-product-detail-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        // LAPAKIN_PRODUCT_DETAIL_POPUP_BACKDROP_V1
        // LAPAKIN_PRODUCT_DETAIL_NEUTRAL_POPUP_V1
        // LAPAKIN_PRODUCT_DETAIL_SOLID_BACKDROP_V2
        // LAPAKIN_PRODUCT_DETAIL_LIGHT_BACKDROP_V1
        // LAPAKIN_PRODUCT_DETAIL_WHITE_GLASS_BACKDROP_V1
        // LAPAKIN_PRODUCT_DETAIL_INLINE_VISIBLE_PAGE_V1
        // LAPAKIN_PRODUCT_DETAIL_MATCH_ORDER_MODAL_V3
        // Match the order modal backdrop style (navy dark transparent) so the
        // product detail clearly reads as a floating modal over the storefront,
        // not a separate page. No backdrop-filter to stay consistent with order modal.
        background: "rgba(15, 23, 42, 0.56)",
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup detail produk"
        style={{
          position: "absolute",
          inset: 0,
          border: 0,
          background: "transparent",
          cursor: "pointer",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "min(94vw, 720px)",
          maxWidth: 720,
          maxHeight: "calc(100dvh - 48px)",
          overflowY: "auto",
          borderRadius: 28,
          background: "#fff",
          boxShadow: "0 26px 90px rgba(15, 23, 42, 0.32)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup detail produk"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            zIndex: 2,
            width: 38,
            height: 38,
            borderRadius: 999,
            border: "1px solid rgba(15,23,42,0.12)",
            background: "rgba(255,255,255,0.92)",
            fontSize: 24,
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          ×
        </button>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.05fr)",
            gap: 0,
          }}
          className="ltr-product-detail-grid"
        >
          <div
            style={{
              minHeight: 260,
              background: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 22,
            }}
          >
            {image ? (
              <img
                src={image}
                alt={name}
                style={{
                  width: "100%",
                  maxHeight: 460,
                  objectFit: "contain",
                  borderRadius: 22,
                  background: "#fff",
                  boxShadow: "0 18px 48px rgba(67,20,7,0.12)",
                }}
              />
            ) : (
              <div className="ltr-product-image-placeholder" style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 22 }}>
                <span>{name.slice(0, 1).toUpperCase()}</span>
              </div>
            )}
          </div>

          <div style={{ padding: "30px 26px", display: "grid", gap: 16, alignContent: "start" }}>
            <div>
              {category ? (
                <span
                  style={{
                    display: "inline-flex",
                    borderRadius: 999,
                    padding: "6px 10px",
                    background: "#fff7ed",
                    color: "#c2410c",
                    fontSize: 12,
                    fontWeight: 900,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                  }}
                >
                  {category}
                </span>
              ) : null}

              <h2 id="storefront-product-detail-title" style={{ margin: "12px 0 0", color: "#1f2933", fontSize: 30, lineHeight: 1.1, fontWeight: 950 }}>
                {name}
              </h2>

              <strong style={{ display: "block", marginTop: 10, color: "#C04A3B", fontSize: 24, fontWeight: 950 }}>
                {formatPrice(price)}
              </strong>
            </div>

            {description ? (
              <p
                data-testid="storefront-product-detail-description"
                style={{
                  margin: 0,
                  color: "#475569",
                  lineHeight: 1.65,
                  fontSize: 15,
                  whiteSpace: "pre-line",
                }}
              >
                {description}
              </p>
            ) : (
              <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>
                Detail produk belum diisi oleh toko.
              </p>
            )}

            <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
              <button
                type="button"
                disabled={outOfStock}
                onClick={(event) => {
                event.stopPropagation();
                onAddToCart(product, index);
              }}
                data-testid="storefront-product-detail-add-cart"
                style={{
                  border: 0,
                  borderRadius: 999,
                  padding: "13px 18px",
                  background: outOfStock ? "#94a3b8" : "#C04A3B",
                  color: "#fff",
                  fontWeight: 950,
                  cursor: outOfStock ? "not-allowed" : "pointer",
                }}
              >
                {outOfStock ? "Stok habis" : "Tambah ke Keranjang"}
              </button>

              <a
                href={buildWhatsappLink(shop)}
                target="_blank"
                rel="noreferrer"
                data-testid="storefront-product-detail-whatsapp"
                style={{
                  borderRadius: 999,
                  padding: "12px 18px",
                  background: "#16a34a",
                  color: "#fff",
                  fontWeight: 950,
                  textDecoration: "none",
                  textAlign: "center",
                }}
              >
                Tanya via WhatsApp
              </a>

              <button
                type="button"
                onClick={shareProduct}
                data-testid="storefront-product-detail-share"
                style={{
                  border: "1px solid rgba(15,23,42,0.14)",
                  borderRadius: 999,
                  padding: "12px 18px",
                  background: "#fff",
                  color: "#1f2933",
                  fontWeight: 950,
                  cursor: "pointer",
                }}
              >
                Share Produk
              </button>
            </div>

            {/* LAPAKIN_HIDE_PRODUCT_LINK_TEXT_V2: visible product link hidden; use Share Produk button instead. */}
          </div>
        </div>
      </div>
    </div>
  );
}


function getCartTotal(cartItems) {
  return cartItems.reduce((sum, item) => {
    return sum + (Number(item.product?.price || 0) * Number(item.qty || 0));
  }, 0);
}

// LAPAKIN_TEMPLATE_WHATSAPP_CHECKOUT_G1B
const TEMPLATE_DEFAULT_WHATSAPP_CHECKOUT_TEMPLATE = `Halo {shop_name}, saya mau pesan:

{items}

Total: {total}
{customer_name_line}
{customer_phone_line}
{fulfillment_method_line}
{notes_line}

{payment_instruction}`;

function compactTemplateWhatsappMessage(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function renderTemplateWhatsappMessage(template, variables) {
  let text = String(template || TEMPLATE_DEFAULT_WHATSAPP_CHECKOUT_TEMPLATE || "");

  Object.entries(variables || {}).forEach(([key, value]) => {
    const pattern = new RegExp(`\\{${key}\\}`, "g");
    text = text.replace(pattern, value == null ? "" : String(value));
  });

  return compactTemplateWhatsappMessage(text);
}

function getTemplateCartProductName(product) {
  return String(product?.name || product?.product_name || product?.title || "Produk").trim();
}

function getTemplateCartProductPrice(product) {
  const raw = product?.price ?? product?.selling_price ?? product?.final_price ?? 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function getTemplateCheckoutItemsText(cartItems) {
  return (cartItems || [])
    .map((item, index) => {
      const product = item.product || {};
      const qty = Math.max(1, Number(item.qty || 0));
      const price = getTemplateCartProductPrice(product);
      const subtotal = price * qty;
      const name = getTemplateCartProductName(product);

      return `${index + 1}. ${name} x${qty} - ${formatPrice(subtotal)}`;
    })
    .filter(Boolean)
    .join("\n");
}

function getTemplatePaymentInstructionText(shop) {
  if (!shouldShowPaymentInstruction(shop)) return "";

  return [
    `Metode pembayaran: ${getPaymentMethodLabel(shop)}`,
    getPaymentInstruction(shop),
    getPaymentConfirmationText(shop),
  ].filter(Boolean).join("\n");
}

function getTemplateFulfillmentMethodLabel(value) {
  const raw = String(value || "").trim();

  if (raw === "pickup") return "Ambil di tempat";
  if (raw === "delivery") return "Kirim/delivery";
  if (raw === "discuss") return "Diskusikan via WhatsApp";

  return raw;
}

function buildDefaultCartWhatsappMessage(shopName, items, total, lead, paymentInstruction) {
  return compactTemplateWhatsappMessage([
    `Halo ${shopName}, saya mau pesan:`,
    "",
    items || "-",
    "",
    `Total: ${total}`,
    lead.customer_name ? `Nama: ${lead.customer_name}` : "",
    lead.customer_phone ? `No HP: ${lead.customer_phone}` : "",
    lead.fulfillment_method ? `Metode: ${getTemplateFulfillmentMethodLabel(lead.fulfillment_method)}` : "",
    lead.notes ? `Catatan: ${lead.notes}` : "",
    "",
    paymentInstruction,
  ].filter((line) => line !== null && line !== undefined).join("\n"));
}

function checkoutMessageContainsCartItems(message, cartItems) {
  const firstItem = (cartItems || []).find((item) => item?.product);
  if (!firstItem) return true;

  const firstName = getTemplateCartProductName(firstItem.product);
  if (!firstName) return true;

  return String(message || "").includes(firstName);
}

function checkoutMessageContainsTotal(message, total) {
  const raw = String(message || "");
  return raw.includes("Total") && raw.includes(String(total || "").replace(/\s+/g, " ").trim().split(" ")[0]);
}

function buildCartWhatsappMessage(shop, cartItems, lead = {}) {
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "toko");
  const items = getTemplateCheckoutItemsText(cartItems);
  const total = formatPrice(getCartTotal(cartItems));
  const paymentInstruction = getTemplatePaymentInstructionText(shop);

  const variables = {
    shop_name: shopName,

    customer_name: lead.customer_name || "",
    customer_phone: lead.customer_phone || "",
    fulfillment_method: getTemplateFulfillmentMethodLabel(lead.fulfillment_method || ""),
    notes: lead.notes || "",

    customer_name_line: lead.customer_name ? `Nama: ${lead.customer_name}` : "",
    customer_phone_line: lead.customer_phone ? `No HP: ${lead.customer_phone}` : "",
    fulfillment_method_line: lead.fulfillment_method ? `Metode: ${getTemplateFulfillmentMethodLabel(lead.fulfillment_method)}` : "",
    notes_line: lead.notes ? `Catatan: ${lead.notes}` : "",

    items,
    total,
    payment_instruction: paymentInstruction,
    campaign_slug: getCampaignSlugFromUrl(),
  };

  const customTemplate = String(shop?.storefront_whatsapp_checkout_template || "").trim();
  const defaultMessage = buildDefaultCartWhatsappMessage(shopName, items, total, lead, paymentInstruction);

  if (!customTemplate) {
    return defaultMessage;
  }

  const rendered = renderTemplateWhatsappMessage(customTemplate, variables);

  if (!rendered) {
    return defaultMessage;
  }

  const hasItems = checkoutMessageContainsCartItems(rendered, cartItems);
  const hasTotal = String(rendered || "").includes("Total");

  if (!hasItems || !hasTotal) {
    return compactTemplateWhatsappMessage([
      rendered,
      "",
      "Ringkasan pesanan:",
      items || "-",
      "",
      `Total: ${total}`,
      paymentInstruction,
    ].filter(Boolean).join("\n"));
  }

  return rendered;
}

function buildCartWhatsappLink(shop, cartItems, lead = {}) {
  const phone = normalizeWhatsapp(
    getValue(shop, [
      "whatsapp",
      "whatsapp_number",
      "phone",
      "phone_number",
      "contact_phone",
      "wa_number",
    ])
  );

  if (!phone) return "#";

  const message = buildCartWhatsappMessage(shop, cartItems, lead);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}


// LAPAKIN_PRODUCT_POPUP_ONLY_V1
function getTemplateProductPermalink(product, index = 0) {
  const productId = getProductId(product, index);

  if (typeof window === "undefined") {
    return `?product=${encodeURIComponent(productId)}`;
  }

  try {
    const url = new URL(window.location.href);
    url.searchParams.set("product", productId);
    return url.toString();
  } catch {
    return `?product=${encodeURIComponent(productId)}`;
  }
}

function shouldIgnoreTemplateProductPopupClick(event) {
  const target = event?.target;
  if (!target?.closest) return false;

  return Boolean(
    target.closest("a, button, input, select, textarea, [data-no-product-popup='true']")
  );
}

function ProductQuickViewModal({
  open,
  product,
  shop,
  index = 0,
  onClose,
  onAddToCart,
}) {
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !product) return null;

  const name = getProductName(product);
  const description = getProductDescription(product);
  const category = getProductCategory(product);
  const image = getProductImage(product);
  const price = getProductPrice(product);
  const outOfStock = isTemplateProductOutOfStock(product);
  const whatsappHref = buildWhatsappLink(shop, product);
  const productLink = getTemplateProductPermalink(product, index);
  const displayProductLink =
    typeof window !== "undefined"
      ? productLink.replace(window.location.origin, "")
      : productLink;

  const handleShare = async () => {
    const copied = await copyStorefrontProductShareLink(productLink);
    if (copied) {
      showStorefrontProductShareToast("Link produk sudah disalin");
    }
  };

  return (
    <div
      className="ltr-product-modal-backdrop"
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(15, 23, 42, 0.45)",
        display: "grid",
        placeItems: "center",
        padding: 18,
      }}
    >
      <div
        className="ltr-product-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Detail ${name}`}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(860px, 100%)",
          maxHeight: "calc(100vh - 36px)",
          overflow: "auto",
          borderRadius: 28,
          background: "#fff",
          boxShadow: "0 30px 80px rgba(15, 23, 42, 0.28)",
          padding: 22,
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup detail produk"
          data-no-product-popup="true"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 38,
            height: 38,
            borderRadius: 999,
            border: 0,
            background: "#f59e0b",
            color: "#111827",
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 10px 24px rgba(15, 23, 42, 0.18)",
          }}
        >
          ×
        </button>

        <div
          className="ltr-product-modal-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 28,
            alignItems: "center",
          }}
        >
          <div
            style={{
              borderRadius: 18,
              overflow: "hidden",
              background: "#f8fafc",
              minHeight: 280,
              display: "grid",
              placeItems: "center",
            }}
          >
            {image ? (
              <img
                src={image}
                alt={name}
                style={{
                  width: "100%",
                  height: "100%",
                  maxHeight: 420,
                  objectFit: "cover",
                  display: "block",
                }}
              />
            ) : (
              <strong style={{ fontSize: 72 }}>
                {name.slice(0, 1).toUpperCase()}
              </strong>
            )}
          </div>

          <div>
            <div
              style={{
                display: "inline-flex",
                borderRadius: 999,
                background: "#fff7ed",
                color: "#ea580c",
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 900,
                textTransform: "uppercase",
                marginBottom: 12,
              }}
            >
              {outOfStock ? "Habis" : category || "Pilihan"}
            </div>

            <h2
              style={{
                margin: 0,
                color: "#1f2937",
                fontSize: "clamp(26px, 4vw, 34px)",
                lineHeight: 1.1,
                fontWeight: 950,
              }}
            >
              {name}
            </h2>

            <p
              style={{
                margin: "12px 0 16px",
                color: "#c2410c",
                fontSize: 26,
                fontWeight: 900,
              }}
            >
              {formatPrice(price)}
            </p>

            {description ? (
              <p
                style={{
                  margin: "0 0 20px",
                  color: "#475569",
                  lineHeight: 1.65,
                  borderLeft: "5px solid #fb923c",
                  paddingLeft: 12,
                  background: "#fff",
                }}
              >
                {description}
              </p>
            ) : null}

            <div style={{ display: "grid", gap: 10 }}>
              <button
                type="button"
                disabled={outOfStock}
                data-no-product-popup="true"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddToCart?.(product, index);
                }}
                style={{
                  border: 0,
                  borderRadius: 999,
                  padding: "14px 18px",
                  fontWeight: 900,
                  cursor: outOfStock ? "not-allowed" : "pointer",
                  background: outOfStock
                    ? "#cbd5e1"
                    : "linear-gradient(90deg, #f97316, #facc15)",
                  color: "#111827",
                }}
              >
                {outOfStock ? "Stok Habis" : "Tambah ke Keranjang"}
              </button>

              <a
                href={whatsappHref}
                data-no-product-popup="true"
                data-whatsapp-context="product_detail"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose?.();
                }}
                style={{
                  borderRadius: 999,
                  padding: "14px 18px",
                  fontWeight: 900,
                  textAlign: "center",
                  textDecoration: "none",
                  background: "linear-gradient(90deg, #f97316, #facc15)",
                  color: "#111827",
                }}
              >
                Tanya via WhatsApp
              </a>

              <button
                type="button"
                data-no-product-popup="true"
                onClick={(event) => {
                  event.stopPropagation();
                  handleShare();
                }}
                style={{
                  border: 0,
                  borderRadius: 999,
                  padding: "14px 18px",
                  fontWeight: 900,
                  cursor: "pointer",
                  background: "linear-gradient(90deg, #f97316, #facc15)",
                  color: "#111827",
                }}
              >
                Share Produk
              </button>
            </div>

            {/* LAPAKIN_HIDE_PRODUCT_LINK_TEXT_V2: quick-view visible product link hidden; use Share Produk button instead. */}
          </div>
        </div>
      </div>
    </div>
  );
}


function ProductImage({ product, className }) {
  const image = getProductImage(product);
  const name = getProductName(product);

  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className={cx("ltr-product-image", className)}
        loading="lazy"
      />
    );
  }

  return (
    <div className={cx("ltr-product-image ltr-product-image-placeholder", className)}>
      <span>{name.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}


// LAPAKIN_TEMPLATE_CATEGORY_FILTER_C
function CategoryChips({
  products,
  allProducts,
  template,
  productSearch = "",
  setProductSearch,
  categoryFilter = "all",
  setCategoryFilter,
  showControls = false,
}) {
  const sourceProducts =
    Array.isArray(allProducts) && allProducts.length ? allProducts : products;

  const categories = getCategories(sourceProducts);
  const filteredCount = Array.isArray(products) ? products.length : 0;
  const totalCount = Array.isArray(sourceProducts) ? sourceProducts.length : filteredCount;

  if (!showControls && !categories.length) return null;

  return (
    <div
      className="ltr-category-filter-panel"
      data-testid={showControls ? "storefront-template-category-search-filter" : undefined}
      data-small-catalog={totalCount <= 6 ? "true" : "false"}
      style={{ display: "grid", gap: totalCount <= 6 ? 8 : 14 }}
    >
      {showControls ? (
        <div
          style={{
            display: "grid",
            gap: 12,
            border: "1px solid rgba(15, 23, 42, 0.10)",
            borderRadius: 22,
            padding: 16,
            background: "rgba(255, 255, 255, 0.88)",
            boxShadow: "0 14px 40px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            <input
              value={productSearch}
              onChange={(event) => setProductSearch?.(event.target.value)}
              placeholder="Cari produk, menu, atau layanan..."
              data-testid="storefront-template-product-search"
              style={{
                /* LAPAKIN_HIDE_EMPTY_CATEGORY_DROPDOWN_V2: search spans full width when category dropdown is hidden. */
                gridColumn: categories.length ? undefined : "1 / -1",
                minWidth: 0,
                height: 44,
                borderRadius: 14,
                border: "1px solid rgba(15, 23, 42, 0.12)",
                padding: "0 12px",
              }}
            />

            {categories.length ? (
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter?.(event.target.value)}
                data-testid="storefront-template-category-filter"
                style={{
                  height: 44,
                  borderRadius: 14,
                  border: "1px solid rgba(15, 23, 42, 0.12)",
                  padding: "0 12px",
                  fontWeight: 800,
                  background: "#fff",
                }}
              >
                <option value="all">Semua kategori</option>
                {categories.map((category) => (
                  <option key={category} value={category.toLowerCase()}>
                    {category}
                  </option>
                ))}
              </select>
            ) : null /* LAPAKIN_HIDE_EMPTY_CATEGORY_DROPDOWN_V2: hide empty category dropdown. */}
          </div>

          <small style={{ color: "#64748b" }}>
            Menampilkan {filteredCount} dari {totalCount} item
          </small>
        </div>
      ) : null}

      {categories.length ? (
        <div className="ltr-category-chips" data-template-nav={template?.categoryNav}>
          <button
            type="button"
            className="ltr-chip"
            onClick={() => setCategoryFilter?.("all")}
            data-active={categoryFilter === "all" ? "true" : "false"}
            style={
              categoryFilter === "all"
                ? { borderColor: "transparent", background: "#fbbf24", color: "#111827" }
                : undefined
            }
            data-testid="storefront-template-category-chip-all"
          >
            Semua
          </button>

          {categories.map((category) => {
            const active = categoryFilter === category.toLowerCase();

            return (
              <button
                key={category}
                type="button"
                className="ltr-chip"
                onClick={() => setCategoryFilter?.(category.toLowerCase())}
                data-active={active ? "true" : "false"}
                style={
                  active
                    ? { borderColor: "transparent", background: "#fbbf24", color: "#111827" }
                    : undefined
                }
                data-testid="storefront-template-category-chip"
              >
                {category}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SocialLinks
({ shop }) {
  const links = getSocialLinks(shop);

  if (!links.length) return null;

  return (
    <div className="ltr-social-links">
      {links.map((link) => (
        <a
          key={link.key}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className={`ltr-social-link ltr-social-${link.key}`}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function HeroSection({ shop, products, template }) {
  const variant = getBusinessTemplateVariant(shop, template);
  const mode = getModeFromTemplate(template);
  const copy = getHeroCopy(mode, template);
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");
  const rawCustomHeroTitle = getValue(shop, ["storefront_hero_title"], "");
  // LAPAKIN_RESPECT_CUSTOM_HERO_TITLE_V1
  const cleanedCustomHeroTitle = cleanStorefrontHeroTitle(rawCustomHeroTitle, shopName, mode);
  const customHeroTitle = String(rawCustomHeroTitle || "").trim() || cleanedCustomHeroTitle;
  // LAPAKIN_STOREFRONT_INFO_VISIBILITY_V1
  const heroTagline = getValue(shop, ["tagline", "tagline_extra"], "");
  const description =
    getValue(shop, ["storefront_hero_subtitle"], "") ||
    getValue(shop, ["description", "bio", "about"], "") ||
    copy.subtitle;
  const ctaLabel = getValue(shop, ["storefront_cta_label"], "") || variant.orderLabel || copy.cta;
  const logo = getValue(shop, ["logo_url", "logo", "avatar_url", "image_url"], "");
  const featured = products[0];
  const fulfillmentOptions = getTemplateFulfillmentOptions(shop);
  const serviceArea = getTemplateServiceArea(shop);

  return (
    <section className={cx("ltr-hero", `ltr-hero-${template.hero}`)}>
      <div className="ltr-hero-content">
        <div className="ltr-eyebrow" data-testid="storefront-business-variant-eyebrow">
          {variant.heroEyebrow || copy.eyebrow}
        </div>
        <h1>
          {customHeroTitle ? (
            customHeroTitle
          ) : mode === "food_menu" && shopName ? (
            <>
              <span>Masakan</span> Rumahan {shopName}
            </>
          ) : (
            <>
              {copy.titlePrefix} <span>{shopName}</span>
            </>
          )}
        </h1>

        {heroTagline && heroTagline !== description ? (
          <div
            data-testid="storefront-hero-tagline"
            style={{
              display: "inline-flex",
              width: "fit-content",
              maxWidth: "100%",
              borderRadius: 999,
              padding: "0.45rem 0.75rem",
              background: "rgba(255,255,255,0.72)",
              color: "var(--lapakin-template-ink, #431407)",
              fontSize: "0.86rem",
              fontWeight: 800,
              boxShadow: "0 10px 30px rgba(67, 20, 7, 0.08)",
            }}
          >
            {heroTagline}
          </div>
        ) : null}

        <p>{description}</p>

        {(fulfillmentOptions.length > 0 || serviceArea) ? (
          <div
            data-testid="storefront-hero-service-chips"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              marginTop: "0.75rem",
            }}
          >
            {fulfillmentOptions.map((option) => (
              <span
                key={option}
                style={{
                  borderRadius: 999,
                  padding: "0.42rem 0.7rem",
                  background: "rgba(255,255,255,0.68)",
                  color: "var(--lapakin-template-ink, #431407)",
                  fontSize: "0.78rem",
                  fontWeight: 900,
                }}
              >
                {option}
              </span>
            ))}
            {serviceArea ? (
              <span
                style={{
                  borderRadius: 999,
                  padding: "0.42rem 0.7rem",
                  background: "rgba(255,255,255,0.68)",
                  color: "var(--lapakin-template-ink, #431407)",
                  fontSize: "0.78rem",
                  fontWeight: 900,
                }}
              >
                Area: {serviceArea}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="ltr-hero-actions">
          <a className="ltr-primary-cta" href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
            {ctaLabel}
          </a>
        </div>

        <div className="ltr-hero-stats">
          <div>
            <strong>{products.length || 0}</strong>
            <span>{mode === "services" ? "Layanan" : mode === "food_menu" ? "Menu" : "Produk"}</span>
          </div>
          <div>
            <strong>{getCategories(products).length || 1}</strong>
            <span>Kategori</span>
          </div>
          <div>
            <strong>WA</strong>
            <span>Order cepat</span>
          </div>
        </div>
      </div>

      <div className="ltr-hero-visual">
        {logo ? (
          <img src={logo} alt={shopName} className="ltr-hero-logo" />
        ) : featured ? (
          <ProductImage product={featured} className="ltr-hero-product" />
        ) : (
          <div className="ltr-hero-logo ltr-product-image-placeholder">
            <span>{shopName.slice(0, 1).toUpperCase()}</span>
          </div>
        )}

        <div className="ltr-hero-card">
          <span>{mode === "food_menu" ? "Rekomendasi" : mode === "services" ? "Layanan Populer" : "Produk Pilihan"}</span>
          <strong>{featured ? getProductName(featured) : shopName}</strong>
          {featured && <small>{formatPrice(getProductPrice(featured))}</small>}
        </div>
      </div>
    </section>
  );
}


function PaymentInstructionBox({ shop }) {
  if (!shouldShowPaymentInstruction(shop)) return null;

  const qrisImage = String(shop?.storefront_qris_image || "").trim();

  return (
    <div
      className="ltr-payment-instruction"
      data-testid="storefront-payment-instruction"
      style={{
        border: "1px solid rgba(192, 74, 59, 0.22)",
        borderRadius: 18,
        padding: 14,
        background: "rgba(255, 248, 242, 0.95)",
        display: "grid",
        gap: 12,
      }}
    >
      <div>
        <span style={{ display: "block", fontSize: 12, fontWeight: 900, color: "#C04A3B", textTransform: "uppercase", letterSpacing: 0.6 }}>
          Pembayaran Manual
        </span>
        <strong style={{ display: "block", marginTop: 2, color: "#1f2933" }}>
          {getPaymentMethodLabel(shop)}
        </strong>
      </div>

      {qrisImage ? (
        <img
          src={qrisImage}
          alt={`QRIS ${getValue(shop, ["name", "shop_name", "store_name"], "toko")}`}
          data-testid="storefront-qris-image"
          style={{ width: "100%", maxWidth: 220, borderRadius: 16, border: "1px solid #eadfd2", background: "#fff", padding: 8 }}
        />
      ) : null}

      <p style={{ margin: 0, color: "#475569", lineHeight: 1.5, whiteSpace: "pre-line" }}>
        {getPaymentInstruction(shop)}
      </p>

      <small style={{ color: "#64748b", lineHeight: 1.45 }}>
        {getPaymentConfirmationText(shop)}
      </small>
    </div>
  );
}


function TemplateCartDrawer({
  shop,
  cartItems,
  cartOpen,
  onClose,
  onIncrease,
  onDecrease,
  onRemove,
  onClear,
}) {
  if (!cartOpen) return null;

  const total = getCartTotal(cartItems);
  const checkoutHref = buildCartWhatsappLink(shop, cartItems);

  return (
    <div className="ltr-cart-overlay" data-testid="storefront-template-cart-drawer">
      <button className="ltr-cart-backdrop" type="button" onClick={onClose} aria-label="Tutup keranjang" />

      <aside className="ltr-cart-drawer">
        <div className="ltr-cart-header">
          <div>
            <span>Keranjang</span>
            <h2>Cek pesanan kamu</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup keranjang">
            ×
          </button>
        </div>

        {cartItems.length ? (
          <>
            <div className="ltr-cart-items">
              {cartItems.map((item) => {
                const product = item.product || {};
                const qty = Number(item.qty || 0);

                return (
                  <div key={product.id} className="ltr-cart-item">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} />
                    ) : (
                      <div className="ltr-cart-item-placeholder">
                        {String(product.name || "P").slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <div className="ltr-cart-item-body">
                      <h3>{product.name}</h3>
                      <p>{formatPrice(product.price)}</p>

                      <div className="ltr-cart-qty">
                        <button type="button" onClick={() => onDecrease(product.id)}>
                          −
                        </button>
                        <strong>{qty}</strong>
                        <button type="button" onClick={() => onIncrease(product.id)}>
                          +
                        </button>
                        <button type="button" onClick={() => onRemove(product.id)}>
                          Hapus
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="ltr-cart-footer">
              <div>
                <span>Total</span>
                <strong>{formatPrice(total)}</strong>
              </div>

              <PaymentInstructionBox shop={shop} />

              <a
                href={checkoutHref}
                target="_blank"
                rel="noreferrer"
                data-testid="storefront-checkout-whatsapp-link"
                data-whatsapp-context="cart_checkout"
              >
                Checkout WhatsApp
              </a>

              <button type="button" onClick={onClear}>
                Kosongkan Keranjang
              </button>
            </div>
          </>
        ) : (
          <div className="ltr-cart-empty">
            <h3>Keranjang masih kosong</h3>
            <p>Pilih produk lalu tekan Tambah ke Keranjang.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function FloatingCartButton({ count, onOpen }) {
  if (!count) return null;

  return (
    <button
      type="button"
      className="ltr-floating-cart"
      onClick={onOpen}
      data-testid="storefront-template-floating-cart"
    >
      <span>Keranjang</span>
      <strong>{count}</strong>
    </button>
  );
}

function ProductCard({ product, shop, template, index, onAddToCart, onOpenProduct }) {
  const mode = getModeFromTemplate(template);
  const variant = template.productCard;
  const name = getProductName(product);
  const description = getProductDescription(product);
  const price = getProductPrice(product);
  const category = getProductCategory(product);
  const outOfStock = isTemplateProductOutOfStock(product);
  const isService = mode === "services";
  const isFood = mode === "food_menu";

  return (
    <article
      data-product-id={getProductId(product, index)}
      className={cx("ltr-product-card", `ltr-card-${variant}`, {
        "ltr-product-card-featured": index === 0,
      })}
      onClick={(event) => {
        const target = event.target;
        if (
          target?.closest?.(
            "a, button, input, select, textarea, [data-no-product-popup='true']"
          )
        ) {
          return;
        }

        onOpenProduct?.(product, index);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;

        const target = event.target;
        if (
          target?.closest?.(
            "a, button, input, select, textarea, [data-no-product-popup='true']"
          )
        ) {
          return;
        }

        event.preventDefault();
        onOpenProduct?.(product, index);
      }}
      role="button"
      tabIndex={0}
      data-lapakin-patch="LAPAKIN_FIX_STOREFRONT_POPUP_AFTER_INSPECT_V1">
      <ProductImage product={product} />

      <div className="ltr-product-body">
        <div className="ltr-product-meta">
          <span>{category}</span>
          {outOfStock && (
            <span
              data-testid={`storefront-template-product-out-of-stock-${getProductId(product, index)}`}
              style={{
                borderRadius: 999,
                background: "#fffbeb",
                border: "1px solid #fde68a",
                color: "#b45309",
                padding: "2px 8px",
                fontWeight: 900,
                fontSize: 11,
              }}
            >
              Habis
            </span>
          )}
          {isFood && <span>Siap pesan</span>}
          {isService && <span>Konsultasi</span>}
        </div>

        <h3>{name}</h3>

        {description && <p>{description}</p>}

        <div className="ltr-product-footer">
          <strong>
            {isService && price > 0 ? "Mulai dari " : ""}
            {formatPrice(price)}
          </strong>

          <div className="ltr-product-actions">
            <button
              type="button"
              className="ltr-add-cart-btn"
              onClick={(event) => {
          event.stopPropagation();
          onAddToCart?.(product, index);
        }}
              data-testid="storefront-template-add-cart"
              aria-label={`Tambah ${name} ke keranjang`}
              title="Tambah ke keranjang"
             disabled={outOfStock} aria-disabled={outOfStock}>
              <svg
                className="ltr-add-cart-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M7 18.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM6.2 6l.34 2H20a1 1 0 0 1 .97 1.24l-1.35 5.4A3 3 0 0 1 16.7 17H8.1a3 3 0 0 1-2.96-2.5L3.72 6H2.5a1 1 0 1 1 0-2h2.06a1 1 0 0 1 .99.84L5.75 6h.45Zm.68 4 .7 4.17a1 1 0 0 0 .99.83h8.13a1 1 0 0 0 .97-.76L18.73 10H6.88Z" />
              </svg>
              <span>Keranjang</span>
            </button>

            <a href={buildWhatsappLink(shop, product)} target="_blank" rel="noreferrer" data-no-product-popup="true" onClick={(event) => event.stopPropagation()}>
              {isService ? "Tanya" : isFood ? "Pesan" : "Order"}
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}


function getSelectedFeaturedProductIds(shop) {
  const ids = shop?.storefront_featured_product_ids;

  if (!Array.isArray(ids)) return [];

  return ids
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function getSelectedFeaturedProducts(shop, products) {
  const selectedIds = getSelectedFeaturedProductIds(shop);
  if (!selectedIds.length) return [];

  const selectedSet = new Set(selectedIds);
  const selectedProducts = [];

  (products || []).forEach((product, index) => {
    const possibleIds = [
      getProductId(product, index),
      product?.product_id,
      product?.id,
      product?._id,
    ].map((item) => String(item || "").trim()).filter(Boolean);

    if (possibleIds.some((id) => selectedSet.has(id))) {
      selectedProducts.push(product);
    }
  });

  selectedProducts.sort((a, b) => {
    const aId = String(a?.product_id || a?.id || a?._id || "").trim();
    const bId = String(b?.product_id || b?.id || b?._id || "").trim();

    return selectedIds.indexOf(aId) - selectedIds.indexOf(bId);
  });

  return selectedProducts;
}


function formatCompactProductPrice(product) {
  const value = Number(product?.price || product?.sale_price || product?.base_price || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value).replace("IDR", "Rp").trim();
}

function getCompactProductName(product) {
  return String(product?.name || product?.title || "Produk").trim();
}

function getCompactProductDescription(product) {
  return String(product?.description || product?.short_description || product?.caption || "").trim();
}

function getCompactProductCategory(product) {
  return String(product?.category_name || product?.category || "").trim();
}

function CompactProductCard({ product, shop, template, index, onAddToCart, onOpenProduct, featured = false }) {
  const name = getCompactProductName(product);
  const description = getCompactProductDescription(product);
  const price = formatCompactProductPrice(product);
  const category = getCompactProductCategory(product);
  const waHref = buildWhatsappLink(shop, product);

  return (
    <article
      className="lpk-tile"
      data-featured={featured ? "true" : "false"}
      data-testid={featured ? "storefront-featured-menu-tile" : "storefront-main-menu-tile"}
      role="button"
      tabIndex={0}
      onClick={() => onOpenProduct?.(product, index)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenProduct?.(product, index);
        }
      }}
      title={`Lihat detail ${name}`}
    >
      <div className="lpk-tile-media">
        <ProductImage product={product} className="lpk-tile-img" />
      </div>

      <div className="lpk-tile-body">
        <div className="lpk-tile-badges">
          {category ? <span>{category}</span> : null}
          {!featured ? <span>Siap pesan</span> : null}
        </div>

        <h3>{name}</h3>

        {!featured && description ? (
          <p>{description}</p>
        ) : null}

        {price ? <strong>{price}</strong> : null}
      </div>

      <div className="lpk-tile-actions">
        <button
          type="button"
          className="lpk-tile-cart"
          onClick={(event) => {
          event.stopPropagation();
          onAddToCart?.(product, index);
        }}
          aria-label={`Tambah ${name} ke keranjang`}
        >
          +
        </button>

        <a className="lpk-tile-order" href={waHref} target="_blank" rel="noreferrer" data-no-product-popup="true" onClick={(event) => event.stopPropagation()}>
          Pesan
        </a>
      </div>
    </article>
  );
}

function ProductSection({
  title,
  products,
  shop,
  template,
  limit,
  titleOverride,
  onAddToCart,
  // LAPAKIN_FIX_ONOPENPRODUCT_SCOPE_V1
  onOpenProduct,
  preferSelectedFeatured = false,
  allProducts,
  productSearch = "",
  setProductSearch,
  categoryFilter = "all",
  setCategoryFilter,
  showControls = false,
}) {
  const lapakinSectionTitle = String(titleOverride || title || "").trim();
  const lapakinIsFeaturedMenuSection =
    getModeFromTemplate(template) === "food_menu" &&
    /menu favorit|favorit hari ini|unggulan|signature/i.test(lapakinSectionTitle);
  const lapakinIsMainMenuSection =
    getModeFromTemplate(template) === "food_menu" &&
    /pilihan menu|semua menu|daftar menu/i.test(lapakinSectionTitle);

  const pickedFeaturedProducts = preferSelectedFeatured
    ? getSelectedFeaturedProducts(shop, products)
    : [];

  const sourceProducts = pickedFeaturedProducts.length ? pickedFeaturedProducts : (products || []);
  const productSectionType = lapakinIsFeaturedMenuSection
    ? "featured-menu"
    : lapakinIsMainMenuSection
      ? "main-menu"
      : "default";

  const density = String(shop?.storefront_product_density || "compact").trim();
  const useCompactCards = density !== "comfortable" && getModeFromTemplate(template) === "food_menu";

  const featuredLimit = limit || 4;
  const initialMainCount = 20;
  const [visibleCount, setVisibleCount] = useState(initialMainCount);

  useEffect(() => {
    setVisibleCount(initialMainCount);
  }, [productSearch, categoryFilter]);

  const computedLimit = lapakinIsFeaturedMenuSection
    ? Math.min(featuredLimit, sourceProducts.length)
    : lapakinIsMainMenuSection
      ? Math.min(visibleCount, sourceProducts.length)
      : (limit ? Math.min(Number(limit), sourceProducts.length) : sourceProducts.length);

  const visibleProducts = sourceProducts.slice(0, computedLimit);
  const finalTitle = titleOverride || title;
  const shouldShowMenuFilters = lapakinIsMainMenuSection && showControls;
  const hasMoreProducts = lapakinIsMainMenuSection && visibleProducts.length < sourceProducts.length;

  if (!visibleProducts.length) {
    return (
      <section className="ltr-section" data-lapakin-product-section={productSectionType}>
        <div className="ltr-section-heading">
          <span>Segera hadir</span>
          <h2>{finalTitle}</h2>
          <p>Belum ada item yang ditampilkan untuk bagian ini.</p>
        </div>

        {shouldShowMenuFilters ? (
          <CategoryChips
            products={visibleProducts}
            allProducts={allProducts || sourceProducts}
            template={template}
            showControls
            productSearch={productSearch}
            setProductSearch={setProductSearch}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="ltr-section" data-lapakin-product-section={productSectionType}>
      <div className="ltr-section-heading">
        {/* LAPAKIN_HIDE_MAIN_MENU_TEMPLATE_LABEL_V2: hide template label above main menu title. */}
        {lapakinIsFeaturedMenuSection ? (
          <span>Menu Unggulan</span>
        ) : null}
        <h2>{finalTitle}</h2>
        <p>
          {lapakinIsFeaturedMenuSection
            ? "Pilihan favorit yang paling cepat dipilih pelanggan."
            : template.description}
        </p>
      </div>

      {shouldShowMenuFilters ? (
        <CategoryChips
          products={visibleProducts}
          allProducts={allProducts || sourceProducts}
          template={template}
          showControls
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
        />
      ) : null}

      <div
        className={
          useCompactCards
            ? `lpk-tile-grid ${lapakinIsFeaturedMenuSection ? "lpk-tile-grid-featured" : "lpk-tile-grid-main"}`
            : cx("ltr-products-grid", `ltr-products-${template.productCard}`)
        }
      >
        {visibleProducts.map((product, index) => (
          useCompactCards ? (
            <CompactProductCard
              key={getProductId(product, index)}
              product={product}
              shop={shop}
              template={template}
              index={index}
              onAddToCart={onAddToCart}
              onOpenProduct={onOpenProduct}
              featured={lapakinIsFeaturedMenuSection}
            />
          ) : (
            <ProductCard
              key={getProductId(product, index)}
              product={product}
              shop={shop}
              template={template}
              index={index}
              onAddToCart={onAddToCart}
              onOpenProduct={onOpenProduct}
            />
          )
        ))}
      </div>

      {hasMoreProducts ? (
        <div className="ltr-load-more-wrap">
          {/* LAPAKIN_HIDE_STOREFRONT_BOTTOM_MENU_COUNT_V1: count already shown in filter panel above. */}
          <button
            type="button"
            onClick={() => setVisibleCount((current) => current + initialMainCount)}
          >
            Lihat menu lainnya
          </button>
        </div>
      ) : null /* LAPAKIN_HIDE_STOREFRONT_BOTTOM_MENU_COUNT_V1: bottom count hidden because filter panel already shows item count. */}
    </section>
  );
}

function PromoBanner({ shop, template }) {
  const mode = getModeFromTemplate(template);
  const title =
    mode === "food_menu"
      ? "Promo hari ini bisa langsung ditanyakan lewat WhatsApp."
      : mode === "services"
        ? "Butuh layanan khusus? Konsultasikan kebutuhan kamu."
        : "Ada produk yang cocok? Hubungi toko untuk cek stok.";

  return (
    <section className="ltr-promo">
      <div>
        <span>{template.mood}</span>
        <h2>{title}</h2>
      </div>
      <a href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
        Chat Toko
      </a>
    </section>
  );
}

function BrandStory({ shop, template }) {
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");
  const about = getValue(
    shop,
    ["about", "description", "bio", "tagline", "story", "business_description"],
    `${shopName} hadir untuk membantu pelanggan menemukan pilihan terbaik dengan proses order yang mudah.`
  );

  return (
    <section className="ltr-story" data-testid="storefront-about-section">
      <span>Tentang Kami</span>
      <h2>{getValue(shop, ["storefront_about_title"], "") || `Kenal lebih dekat dengan ${shopName}`}</h2>
      <p>{about}</p>
      <SocialLinks shop={shop} />
    </section>
  );
}

function Benefits({ template }) {
  const mode = getModeFromTemplate(template);
  const items =
    mode === "food_menu"
      ? ["Pesan mudah via WhatsApp", "Menu jelas dan cepat dipilih", "Cocok untuk order harian"]
      : mode === "services"
        ? ["Konsultasi langsung", "Pilihan layanan jelas", "Proses mudah dari awal"]
        : ["Katalog rapi", "Harga mudah dicek", "Order langsung ke toko"];

  return (
    <section className="ltr-section">
      <div className="ltr-section-heading">
        <span>Keunggulan</span>
        <h2>Kenapa pelanggan suka?</h2>
      </div>

      <div className="ltr-benefits">
        {items.map((item) => (
          <div key={item}>
            <strong>{item}</strong>
            <p>Dibuat agar pengalaman pelanggan terasa sederhana dan nyaman.</p>
          </div>
        ))}
      </div>
    </section>
  );
}



function normalizePromoFinalSectionOrder(shop, sections) {
  const list = Array.isArray(sections) ? [...sections] : [];

  if (!shouldShowPromoBanner(shop)) {
    return list.filter((section) => section !== "promo" && !isLegacyPromoLikeSection(section));
  }

  const withoutPromo = list.filter((section) => section !== "promo" && !isLegacyPromoLikeSection(section));

  // In the current template order, "categories" appears right after the featured section.
  // So inserting promo before categories places it directly below Produk/Menu/Layanan Unggulan.
  const categoriesIndex = withoutPromo.indexOf("categories");
  if (categoriesIndex >= 0) {
    withoutPromo.splice(categoriesIndex, 0, "promo");
    return withoutPromo;
  }

  // Fallback: put promo before the full product/menu listing.
  const fullListingKeys = [
    "all_products",
    "products",
    "product_grid",
    "product_list",
    "menu",
    "menu_grid",
    "services",
    "service_grid",
  ];

  for (const key of fullListingKeys) {
    const index = withoutPromo.indexOf(key);
    if (index >= 0) {
      withoutPromo.splice(index, 0, "promo");
      return withoutPromo;
    }
  }

  // Fallback: before story/about/contact.
  const storyKeys = ["about", "brand_story", "story", "about_us", "contact"];
  for (const key of storyKeys) {
    const index = withoutPromo.indexOf(key);
    if (index >= 0) {
      withoutPromo.splice(index, 0, "promo");
      return withoutPromo;
    }
  }

  withoutPromo.push("promo");
  return withoutPromo;
}


function PromoBannerSection({ shop }) {
  return (
    <section id="promo" className="ltr-promo-banner" data-testid="storefront-promo-banner" data-campaign-slug={getPromoSlug(shop)}>
      <div>
        <span>Promo</span>
        <h2>{getPromoTitle(shop)}</h2>
        <p>{getPromoText(shop)}</p>
      </div>

      <a href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
        {getPromoCtaLabel(shop)}
      </a>
    </section>
  );
}



function getStorefrontSocialLinks(shop) {
  const links = [];

  const instagram = String(shop?.instagram || "")
    .trim()
    .replace(/^@+/, "");
  const tiktok = String(shop?.tiktok || "")
    .trim()
    .replace(/^@+/, "");
  const shopee = String(shop?.shopee_url || shop?.shopee || "")
    .trim();

  if (instagram) {
    links.push({
      key: "instagram",
      label: "Instagram",
      short: "IG",
      href: `https://instagram.com/${instagram}`,
    });
  }

  if (tiktok) {
    links.push({
      key: "tiktok",
      label: "TikTok",
      short: "TT",
      href: `https://www.tiktok.com/@${tiktok}`,
    });
  }

  if (shopee) {
    links.push({
      key: "shopee",
      label: "Shopee",
      short: "SP",
      href: shopee.startsWith("http") ? shopee : `https://shopee.co.id/${shopee}`,
    });
  }

  return links;
}



// LAPAKIN_TEMPLATE_BUSINESS_HOURS_DISPLAY
const LAPAKIN_DAYS = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
];


function getTemplateFulfillmentOptions(shop) {
  const options = [];
  if (shop?.pickup_available) options.push("Pickup tersedia");
  if (shop?.delivery_available) options.push("Delivery tersedia");
  return options;
}

function getTemplateServiceArea(shop) {
  return String(shop?.service_area || "").trim();
}

function shouldShowOperationalInfo(shop) {
  return Boolean(
    shop?.order_whatsapp_enabled !== false ||
    shop?.pickup_available ||
    shop?.delivery_available ||
    getTemplateServiceArea(shop) ||
    shouldShowPaymentInstruction(shop) ||
    getLocationAddress(shop) ||
    getGoogleMapsUrl(shop)
  );
}

function OperationalInfoSection({ shop }) {
  if (!shouldShowOperationalInfo(shop)) return null;

  const fulfillmentOptions = getTemplateFulfillmentOptions(shop);
  const serviceArea = getTemplateServiceArea(shop);
  const address = getLocationAddress(shop);
  const mapsUrl = getGoogleMapsUrl(shop);
  const orderEnabled = shop?.order_whatsapp_enabled !== false;

  return (
    <section className="ltr-section ltr-operational-info" data-testid="storefront-template-operational-info">
      <div className="ltr-section-heading">
        <span>Info Order</span>
        <h2>Cara order & layanan toko</h2>
        <p>Cek cara order, pembayaran, area layanan, dan lokasi sebelum checkout.</p>
      </div>

      <div
        className="ltr-operational-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        <div className="ltr-operational-card" style={{ border: "1px solid rgba(15,23,42,.10)", borderRadius: 18, padding: 16, background: "rgba(255,255,255,.78)" }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Order</span>
          <strong style={{ display: "block", marginTop: 4, color: "#0f172a" }}>
            {orderEnabled ? "Order via WhatsApp" : "Order WhatsApp nonaktif"}
          </strong>
          <p style={{ margin: "6px 0 0", color: "#64748b", lineHeight: 1.5 }}>
            {orderEnabled ? "Pesanan diarahkan ke WhatsApp toko." : "Hubungi toko untuk info cara order."}
          </p>
        </div>

        <div className="ltr-operational-card" style={{ border: "1px solid rgba(15,23,42,.10)", borderRadius: 18, padding: 16, background: "rgba(255,255,255,.78)" }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Pickup / Delivery</span>
          <strong style={{ display: "block", marginTop: 4, color: "#0f172a" }}>
            {fulfillmentOptions.length ? fulfillmentOptions.join(" · ") : "Konfirmasi ke toko"}
          </strong>
          <p style={{ margin: "6px 0 0", color: "#64748b", lineHeight: 1.5 }}>
            {serviceArea ? `Area layanan: ${serviceArea}` : "Tanyakan opsi pengambilan atau pengiriman ke toko."}
          </p>
        </div>

        {shouldShowPaymentInstruction(shop) ? (
          <div className="ltr-operational-card" style={{ border: "1px solid rgba(15,23,42,.10)", borderRadius: 18, padding: 16, background: "rgba(255,255,255,.78)" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Pembayaran</span>
            <strong style={{ display: "block", marginTop: 4, color: "#0f172a" }}>{getPaymentMethodLabel(shop)}</strong>
            <p style={{ margin: "6px 0 0", color: "#64748b", lineHeight: 1.5, whiteSpace: "pre-line" }}>
              {getPaymentInstruction(shop)}
            </p>
            {shop?.storefront_qris_image ? (
              <small style={{ display: "block", marginTop: 8, color: "#0f172a", fontWeight: 800 }}>QRIS tersedia.</small>
            ) : null}
          </div>
        ) : null}

        {(address || mapsUrl) ? (
          <div className="ltr-operational-card" style={{ border: "1px solid rgba(15,23,42,.10)", borderRadius: 18, padding: 16, background: "rgba(255,255,255,.78)" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Lokasi</span>
            <strong style={{ display: "block", marginTop: 4, color: "#0f172a" }}>{address || "Lokasi toko"}</strong>
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="storefront-template-google-maps-link"
                style={{ display: "inline-flex", marginTop: 8, fontSize: 14, fontWeight: 900, color: "#C04A3B", textDecoration: "none" }}
              >
                Buka Google Maps →
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}


function shouldShowBusinessHours(shop) {
  return Boolean(
    String(shop?.hours || "").trim() ||
    shop?.sells_by === "hours" ||
    shop?.auto_schedule_enabled ||
    Array.isArray(shop?.schedule) ||
    shop?.schedule_status
  );
}

function formatScheduleTime(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  return raw.slice(0, 5);
}

function getScheduleEntryLabel(entry) {
  if (!entry) return "Tutup";

  if (entry.closed === true || entry.is_closed === true || entry.open === false || entry.enabled === false) {
    return "Tutup";
  }

  const shifts = Array.isArray(entry.shifts) ? entry.shifts : [];
  if (shifts.length) {
    const rendered = shifts
      .map((shift) => {
        const open = formatScheduleTime(shift.open || shift.start || shift.from || shift.open_time);
        const close = formatScheduleTime(shift.close || shift.end || shift.to || shift.close_time);
        return open && close ? `${open} - ${close}` : "";
      })
      .filter(Boolean);

    return rendered.length ? rendered.join(", ") : "Tutup";
  }

  const open = formatScheduleTime(entry.open || entry.start || entry.from || entry.open_time);
  const close = formatScheduleTime(entry.close || entry.end || entry.to || entry.close_time);

  if (open && close) return `${open} - ${close}`;

  return "Tutup";
}

function getBusinessHoursStatus(shop) {
  const scheduleStatus = shop?.schedule_status || {};
  const sellsBy = shop?.sells_by || "stock";
  const isHoursMode = sellsBy === "hours";

  const auto = Boolean(scheduleStatus.auto || shop?.auto_schedule_enabled);
  const isOpenNow =
    typeof scheduleStatus.is_open_now === "boolean"
      ? scheduleStatus.is_open_now
      : typeof shop?.is_open === "boolean"
        ? shop.is_open
        : null;

  if (!isHoursMode && isOpenNow === null) {
    return {
      label: "Jam operasional",
      detail: String(shop?.hours || "").trim() || "Hubungi toko untuk memastikan jam buka.",
      open: null,
    };
  }

  if (isOpenNow === true) {
    return {
      label: "Buka sekarang",
      detail: auto && scheduleStatus.closes_at
        ? `Tutup hari ini jam ${scheduleStatus.closes_at} WIB`
        : String(shop?.hours || "").trim() || "Toko sedang buka.",
      open: true,
    };
  }

  if (isOpenNow === false) {
    return {
      label: "Tutup sekarang",
      detail: auto && scheduleStatus.opens_at
        ? `Buka lagi ${scheduleStatus.opens_at} WIB`
        : String(shop?.hours || "").trim() || "Cek kembali nanti atau hubungi toko via WhatsApp.",
      open: false,
    };
  }

  return {
    label: "Jam operasional",
    detail: String(shop?.hours || "").trim() || "Hubungi toko untuk memastikan jam buka.",
    open: null,
  };
}

function BusinessHoursSection({ shop }) {
  const [expanded, setExpanded] = useState(false);

  if (!shouldShowBusinessHours(shop)) return null;

  const status = getBusinessHoursStatus(shop);
  const schedule = Array.isArray(shop?.schedule) ? shop.schedule : [];
  const hasStructuredSchedule = schedule.some(Boolean);
  const hoursText = String(shop?.hours || "").trim();
  const sectionTitle = hoursText || "Kapan toko buka?";

  return (
    <section
      className="ltr-section ltr-business-hours"
      data-testid="storefront-business-hours-section"
    >
      <div className="ltr-section-heading">
        <span>Jam Operasional</span>
        <h2>{sectionTitle}</h2>
      </div>

      <div
        className="ltr-business-hours-card"
        style={{
          border: "1px solid rgba(15, 23, 42, 0.10)",
          borderRadius: 22,
          padding: 18,
          background: "rgba(255, 255, 255, 0.88)",
          boxShadow: "0 14px 40px rgba(15, 23, 42, 0.06)",
          display: "grid",
          gap: expanded ? 14 : 10,
        }}
      >
        <div
          className="ltr-business-hours-status"
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong
              data-testid="storefront-business-hours-status"
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 999,
                padding: "7px 11px",
                background: status.open === true
                  ? "rgba(22, 163, 74, 0.12)"
                  : status.open === false
                    ? "rgba(220, 38, 38, 0.10)"
                    : "rgba(15, 23, 42, 0.08)",
                color: status.open === true
                  ? "#15803d"
                  : status.open === false
                    ? "#b91c1c"
                    : "#334155",
                fontSize: 13,
                fontWeight: 900,
              }}
            >
              {status.label}
            </strong>

            {status.detail ? (
              <p style={{ margin: "10px 0 0", color: "#475569", lineHeight: 1.55 }}>
                {status.detail}
              </p>
            ) : null}
          </div>

          {(hasStructuredSchedule || hoursText) ? (
            <button
              type="button"
              data-testid="storefront-business-hours-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              style={{
                border: "1px solid rgba(15, 23, 42, 0.10)",
                borderRadius: 999,
                background: expanded ? "#1f2937" : "#fff",
                color: expanded ? "#fff" : "#1f2937",
                padding: "8px 12px",
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 8px 18px rgba(15, 23, 42, 0.06)",
              }}
            >
              {expanded ? "Sembunyikan jadwal" : "Lihat jadwal"}
            </button>
          ) : null}
        </div>

        {expanded && hasStructuredSchedule ? (
          <div
            className="ltr-business-hours-grid"
            data-testid="storefront-business-hours-schedule"
            style={{
              display: "grid",
              gap: 8,
            }}
          >
            {LAPAKIN_DAYS.map((day, idx) => {
              const entry = schedule[idx];
              const label = getScheduleEntryLabel(entry);
              const closed = label === "Tutup";

              return (
                <div
                  key={day}
                  className="ltr-business-hours-row"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "9px 0",
                    borderTop: idx === 0 ? 0 : "1px solid rgba(15, 23, 42, 0.08)",
                    color: closed ? "#94a3b8" : "#334155",
                  }}
                >
                  <span style={{ fontWeight: 800 }}>{day}</span>
                  <span style={{ textAlign: "right" }}>{label}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {expanded && !hasStructuredSchedule && hoursText ? (
          <p
            data-testid="storefront-business-hours-text"
            style={{ margin: 0, color: "#334155", lineHeight: 1.6 }}
          >
            {hoursText}
          </p>
        ) : null}
      </div>
    </section>
  );
}
// /LAPAKIN_TEMPLATE_BUSINESS_HOURS_DISPLAY


function getGoogleMapsEmbedUrl(shop) {
  const explicit = String(
    shop?.storefront_location_embed_url ||
    shop?.storefront_google_maps_embed_url ||
    shop?.google_maps_embed_url ||
    shop?.maps_embed_url ||
    ""
  ).trim();

  if (explicit) return explicit;

  const address = getLocationAddress(shop);
  if (!address) return "";

  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
}


function getLocationTitle(shop) {
  return String(shop?.storefront_location_title || "").trim() || `Lokasi ${getValue(shop, ["name", "shop_name", "store_name"], "Toko")}`;
}

function getLocationAddress(shop) {
  return String(
    shop?.storefront_location_address ||
    shop?.store_address ||
    shop?.address ||
    shop?.location_address ||
    shop?.location ||
    ""
  ).trim();
}


function getGoogleMapsUrl(shop) {
  const explicit = String(
    shop?.storefront_google_maps_url ||
    shop?.google_maps_url ||
    shop?.google_maps_link ||
    ""
  ).trim();
  if (explicit) return explicit;

  const address = getLocationAddress(shop);
  if (!address) return "";

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}


function getLocationEmbedUrl(shop) {
  const explicit = String(
    shop?.storefront_location_embed_url ||
    shop?.storefront_google_maps_embed_url ||
    ""
  ).trim();
  if (explicit) return explicit;

  const address = getLocationAddress(shop);
  if (!address) return "";
  return `https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
}


function shouldShowLocationMap(shop) {
  const locationEnabled = Boolean(
    shop?.storefront_show_location_map ||
    shop?.has_offline_store ||
    shop?.show_location
  );

  if (!locationEnabled) return false;

  return Boolean(getLocationAddress(shop) || getGoogleMapsUrl(shop) || getLocationEmbedUrl(shop));
}


function normalizeTestimonials(shop) {
  const raw = Array.isArray(shop?.storefront_testimonials)
    ? shop.storefront_testimonials
    : [];

  return raw
    .map((item) => ({
      name: String(item?.name || item?.customer_name || "").trim(),
      text: String(item?.text || item?.comment || item?.message || "").trim(),
      rating: Math.max(1, Math.min(5, Number(item?.rating || 5))),
    }))
    .filter((item) => item.name || item.text)
    .slice(0, 3);
}

function shouldShowTestimonials(shop) {
  return Boolean(shop?.storefront_show_testimonials && normalizeTestimonials(shop).length);
}

function TestimonialStars({ rating }) {
  const value = Math.max(1, Math.min(5, Number(rating || 5)));
  return (
    <span aria-label={`${value} dari 5 bintang`} title={`${value} dari 5 bintang`}>
      {"★★★★★".slice(0, value)}
      <span style={{ opacity: 0.25 }}>{"★★★★★".slice(value)}</span>
    </span>
  );
}

function TestimonialsSection({ shop }) {
  const testimonials = normalizeTestimonials(shop);
  if (!shop?.storefront_show_testimonials || testimonials.length === 0) return null;

  const mode = String(shop?.storefront_mode || "").trim();
  const heading =
    mode === "services"
      ? "Apa kata klien kami"
      : mode === "food_menu"
        ? "Kata pelanggan"
        : "Ulasan pembeli";

  return (
    <section
      className="ltr-section ltr-testimonials"
      data-testid="storefront-testimonials-section"
    >
      <div className="ltr-section-heading">
        <span>Testimoni</span>
        <h2>{heading}</h2>
      </div>

      <div
        className="ltr-testimonials-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        {testimonials.map((item, index) => (
          <article
            key={`${item.name || "testimonial"}-${index}`}
            className="ltr-testimonial-card"
            data-testid="storefront-testimonial-card"
            style={{
              border: "1px solid rgba(15, 23, 42, 0.10)",
              borderRadius: 22,
              padding: 18,
              background: "rgba(255, 255, 255, 0.88)",
              boxShadow: "0 14px 40px rgba(15, 23, 42, 0.06)",
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                color: "#f59e0b",
                fontWeight: 900,
                letterSpacing: 1,
                fontSize: 15,
              }}
            >
              <TestimonialStars rating={item.rating} />
            </div>

            {item.text ? (
              <p style={{ margin: 0, color: "#334155", lineHeight: 1.6 }}>
                “{item.text}”
              </p>
            ) : null}

            <strong style={{ color: "#1f2937" }}>
              {item.name || "Pelanggan"}
            </strong>
          </article>
        ))}
      </div>
    </section>
  );
}
// /LAPAKIN_TESTIMONIAL_SECTION_MVP

function LocationMapSection({ shop }) {
  const [expanded, setExpanded] = useState(false);

  if (!shouldShowLocationMap(shop)) return null;

  const title = getLocationTitle(shop);
  const address = getLocationAddress(shop);
  const mapsUrl = getGoogleMapsUrl(shop);
  const embedUrl = getGoogleMapsEmbedUrl(shop);
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");

  return (
    <section
      className="ltr-section ltr-location-map"
      data-testid="storefront-location-map-section"
    >
      <div className="ltr-section-heading">
        <span>Lokasi</span>
        <h2>{title}</h2>
      </div>

      <div
        className="ltr-location-map-card"
        style={{
          border: "1px solid rgba(15, 23, 42, 0.10)",
          borderRadius: 22,
          padding: 18,
          background: "rgba(255, 255, 255, 0.88)",
          boxShadow: "0 14px 40px rgba(15, 23, 42, 0.06)",
          display: "grid",
          gap: 14,
        }}
      >
        <div
          className="ltr-location-map-summary"
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", color: "#1f2937", fontSize: 16 }}>
              {shopName}
            </strong>

            {address ? (
              <p
                data-testid="storefront-location-address"
                style={{ margin: "8px 0 0", color: "#475569", lineHeight: 1.55 }}
              >
                {address}
              </p>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {embedUrl ? (
              <button
                type="button"
                data-testid="storefront-location-map-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
                style={{
                  border: "1px solid rgba(15, 23, 42, 0.10)",
                  borderRadius: 999,
                  background: expanded ? "#1f2937" : "#fff",
                  color: expanded ? "#fff" : "#1f2937",
                  padding: "8px 12px",
                  fontWeight: 800,
                  cursor: "pointer",
                  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.06)",
                }}
              >
                {expanded ? "Sembunyikan peta" : "Lihat peta"}
              </button>
            ) : null}

            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="storefront-location-map-link"
                style={{
                  borderRadius: 999,
                  background: "#C04A3B",
                  color: "#fff",
                  padding: "8px 12px",
                  fontWeight: 800,
                  textDecoration: "none",
                  boxShadow: "0 8px 18px rgba(192, 74, 59, 0.18)",
                }}
              >
                Buka Maps
              </a>
            ) : null}
          </div>
        </div>

        {expanded && embedUrl ? (
          <div
            className="ltr-location-map-frame"
            data-testid="storefront-location-map-frame"
            style={{
              overflow: "hidden",
              borderRadius: 18,
              border: "1px solid rgba(15, 23, 42, 0.10)",
              background: "#f8fafc",
            }}
          >
            <iframe
              title={`Lokasi ${shopName}`}
              src={embedUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{
                display: "block",
                width: "100%",
                minHeight: 280,
                border: 0,
              }}
              allowFullScreen
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ContactSection({ shop, template }) {
  const variant = getBusinessTemplateVariant(shop, template);
  const mode = getModeFromTemplate(template);
  const socialLinks = getStorefrontSocialLinks(shop);
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");
  const address = getValue(shop, ["store_address", "storefront_location_address", "address", "location_address", "location"], "");
  const ctaLabel =
    getValue(shop, ["storefront_cta_label"], "") ||
    variant.orderLabel ||
    (mode === "services" ? "Konsultasi Sekarang" : "Chat WhatsApp");

  return (
    <section className="ltr-contact" data-testid="storefront-contact-section">
      <div>
        <span>Order via WhatsApp</span>
        <h2>Hubungi {shopName}</h2>

        {address && <p>{address}</p>}

        <div data-testid="storefront-contact-socials">
          {socialLinks.length > 0 && (
            <div className="ltr-social-links">
              {socialLinks.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{item.short}</span> {item.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <a href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
        {ctaLabel}
      </a>
    </section>
  );
}



function FaqSection({ template }) {
  const mode = getModeFromTemplate(template);
  const faqs =
    mode === "services"
      ? [
          ["Bagaimana cara booking?", "Hubungi toko via WhatsApp untuk jadwal dan kebutuhan layanan."],
          ["Apakah bisa konsultasi dulu?", "Bisa, pelanggan dapat bertanya terlebih dahulu sebelum memilih layanan."],
        ]
      : [
          ["Bagaimana cara order?", "Pilih item lalu klik tombol WhatsApp untuk menghubungi toko."],
          ["Apakah harga selalu update?", "Harga mengikuti informasi terbaru dari toko."],
        ];

  return (
    <section className="ltr-section">
      <div className="ltr-section-heading">
        <span>FAQ</span>
        <h2>Pertanyaan Umum</h2>
      </div>

      <div className="ltr-faq">
        {faqs.map(([question, answer]) => (
          <div key={question}>
            <strong>{question}</strong>
            <p>{answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function renderSection(section, context) {
  const { shop, products, allProducts, template, onAddToCart, onOpenProduct, productSearch, setProductSearch, categoryFilter, setCategoryFilter } = context;
  const mode = getModeFromTemplate(template);
  const title = getSectionTitle(section, mode);
  const featured = products.filter((product) => product?.featured || product?.is_featured);
  const fallbackFeatured = featured.length ? featured : products.slice(0, 4);

  switch (section) {
    case "hero":
      return <HeroSection key={section} shop={shop} products={allProducts || products} template={template} />;

    case "categories":
      // In food menu templates, category/search belongs inside "Pilihan Menu".
      // Avoid showing a duplicate standalone Kategori section.
      if (mode === "food_menu") return null;

      return (
        <section key={section} className="ltr-section ltr-category-section">
          <div className="ltr-section-heading">
            <span>Jelajahi</span>
            <h2>{title}</h2>
          </div>
          <CategoryChips
            products={products}
            allProducts={allProducts}
            template={template}
            showControls
            productSearch={productSearch}
            setProductSearch={setProductSearch}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
          />
        </section>
      );

    case "featured_products":
    case "signature_menu":
    case "today_menu":
    case "collections":
      return (
        <ProductSection
          key={section}
          title={title}
          products={fallbackFeatured}
          shop={shop}
          template={template}
          onAddToCart={onAddToCart}
          onOpenProduct={onOpenProduct}
          limit={3}
          titleOverride={getValue(shop, ["storefront_featured_title"], "")}
          preferSelectedFeatured={true}
        />
      );

    case "all_products":
    case "menu_list":
    case "menu_grid":
    case "service_list":
      return (
        <ProductSection
          key={section}
          title={title}
          products={products}
          allProducts={allProducts}
          shop={shop}
          template={template}
          onAddToCart={onAddToCart}
          onOpenProduct={onOpenProduct}
          showControls
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
        />
      );

    case "promo_banner":
      return <PromoBanner key={section} shop={shop} template={template} />;

    case "brand_story":
    case "about":
      return <BrandStory key={section} shop={shop} template={template} />;

    case "benefits":
      return <Benefits key={section} template={template} />;

    case "testimonials":
      return <TestimonialsSection key={section} shop={shop} />;

    case "faq":
      return <FaqSection key={section} template={template} />;

    case "promo":
      return <PromoBannerSection shop={shop} />;

    case "business_hours":
      return <BusinessHoursSection key={section} shop={shop} />;

    case "location_map":
      return <LocationMapSection key={section} shop={shop} />;

    case "contact":
      return <ContactSection key={section} shop={shop} template={template} />;

    default:
      return null;
  }
}


function MobileStickyOrderBar({ shop, template, cartCount, onOpenCart }) {
  const mode = getModeFromTemplate(template);
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");

  const label =
    mode === "services"
      ? "Konsultasi via WhatsApp"
      : mode === "food_menu"
        ? "Pesan Menu via WhatsApp"
        : "Order via WhatsApp";

  return (
    <div className="ltr-mobile-sticky-order" data-testid="storefront-mobile-sticky-order">
      <div>
        <span>{shopName}</span>
        <strong>{label}</strong>
      </div>
      {cartCount > 0 ? (
        <button type="button" onClick={onOpenCart}>
          Keranjang ({cartCount})
        </button>
      ) : (
        <a href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
          Chat
        </a>
      )}
    </div>
  );
}



function LeadCaptureModal({ open, onClose, onSkip, onContinue, cartItems = [], showCartSummary = false }) {
  const [form, setForm] = useState({ customer_name: "", customer_phone: "", fulfillment_method: "discuss", notes: "" });
  useEffect(() => { if (open) setForm({ customer_name: "", customer_phone: "", fulfillment_method: "discuss", notes: "" }); }, [open]);
  if (!open) return null;

  const fieldStyle = {
    width: "100%",
    border: "1px solid #d8cfc3",
    borderRadius: 14,
    padding: "10px 12px",
    font: "inherit",
    color: "#1f2933",
    background: "#fff",
  };

  // LAPAKIN_LEAD_MODAL_CART_SUMMARY_V1
  const modalCartItems = showCartSummary
    ? (cartItems || []).filter((item) => item?.product && Number(item.qty || 0) > 0)
    : [];
  const modalCartTotal = getCartTotal(modalCartItems);

  return (
    <div
      data-testid="storefront-lead-capture-modal"
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(15, 23, 42, 0.56)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          borderRadius: 24,
          background: "#fff",
          padding: 22,
          boxShadow: "0 24px 80px rgba(15, 23, 42, 0.28)",
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <span style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#C04A3B", letterSpacing: 0.8, textTransform: "uppercase" }}>Data Pesanan</span>
          <div className="ltr-order-modal-title-row">
  <h2 style={{ margin: "4px 0 6px", fontSize: 22, fontWeight: 900, color: "#1f2933" }}>Lengkapi sebelum lanjut WhatsApp</h2>
  <button
    type="button"
    className="ltr-order-modal-close"
    aria-label="Tutup popup pesanan"
    title="Tutup"
    onClick={onClose}
  >
    ×
  </button>
</div>
{/* LAPAKIN_HIDE_CART_INTRO_IN_LEAD_MODAL_V2 */}
          {!showCartSummary && (
            <>
              {/* LAPAKIN_HIDE_CART_INTRO_IN_LEAD_MODAL_V3 */}

              {!showCartSummary && (

                <>

                  <p className="rounded-2xl border border-brand-line bg-brand-off/60 px-4 py-3 text-sm text-brand-mute">Pengaturan dasar untuk kontak dan metode order. Auto-reply, inbox chat, FAQ percakapan, dan handoff akan dikelola di Lapakin Asisten.</p>

                  <p style={{ margin: 0, color: "#64748b", lineHeight: 1.45 }}>Biar penjual lebih mudah follow up pesanan kamu.</p>

                </>

              )}
            </>
          )}
        </div>

        {modalCartItems.length > 0 && (
          <div
            data-testid="lead-capture-cart-summary"
            style={{
              border: "1px solid #f3d9bf",
              borderRadius: 18,
              background: "#fff7ed",
              padding: 14,
              margin: "0 0 14px",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "#c2410c", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Ringkasan pesanan
              </span>
              <strong style={{ color: "#431407", fontSize: 14 }}>{formatPrice(modalCartTotal)}</strong>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {modalCartItems.map((item, index) => {
                const product = item.product || {};
                const qty = Math.max(1, Number(item.qty || 0));
                const subtotal = Number(getProductPrice(product) || 0) * qty;

                return (
                  <div
                    key={`${getProductId(product, index)}-${index}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                      color: "#431407",
                      fontSize: 13,
                      lineHeight: 1.35,
                    }}
                  >
                    <span style={{ fontWeight: 800 }}>
                      {getProductName(product)} <small style={{ color: "#9a3412", fontWeight: 900 }}>x{qty}</small>
                    </span>
                    <strong style={{ whiteSpace: "nowrap" }}>{formatPrice(subtotal)}</strong>
                  </div>
                );
              })}
            </div>

            <p style={{ margin: 0, color: "#9a3412", fontSize: 12, lineHeight: 1.35 }}>
              Pesanan ini akan ikut masuk ke pesan WhatsApp setelah kamu klik Lewati atau Lanjut WhatsApp.
            </p>
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, fontWeight: 800, color: "#1f2933" }}>
            <span>Nama</span>
            <input value={form.customer_name} onChange={(event) => setForm((prev) => ({ ...prev, customer_name: event.target.value }))} placeholder="Nama kamu" style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800, color: "#1f2933" }}>
            <span>Nomor HP opsional</span>
            <input value={form.customer_phone} onChange={(event) => setForm((prev) => ({ ...prev, customer_phone: event.target.value }))} placeholder="08xxxxxxxxxx" style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800, color: "#1f2933" }}>
            <span>Metode</span>
            <select value={form.fulfillment_method} onChange={(event) => setForm((prev) => ({ ...prev, fulfillment_method: event.target.value }))} style={fieldStyle}>
              <option value="discuss">Diskusikan via WhatsApp</option>
              <option value="pickup">Ambil di tempat</option>
              <option value="delivery">Kirim/delivery</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 800, color: "#1f2933" }}>
            <span>Catatan opsional</span>
            <textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Contoh: kirim jam 5 sore, pedas sedang, dll." rows={3} style={{ ...fieldStyle, resize: "vertical" }} />
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <button data-lapakin-order-skip="true" type="button" onClick={onSkip} data-testid="lead-capture-skip" style={{ border: "1px solid #d8cfc3", borderRadius: 999, padding: "10px 14px", background: "#fff", color: "#475569", fontWeight: 800, cursor: "pointer" }}>Lewati</button>
          <button type="button" onClick={() => onContinue(form)} disabled={!form.customer_name.trim()} data-testid="lead-capture-continue-whatsapp" style={{ border: 0, borderRadius: 999, padding: "10px 16px", background: form.customer_name.trim() ? "#16a34a" : "#94a3b8", color: "#fff", fontWeight: 900, cursor: form.customer_name.trim() ? "pointer" : "not-allowed" }}>Lanjut WhatsApp</button>
        </div>
      </div>
    </div>
  );
}

export default function StorefrontTemplateRenderer({ data, template }) {
  const shop = getShop(data);
  const products = getProducts(data);
  const mode = getModeFromTemplate(template);
  const cartKey = getCartStorageKey(shop);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProductDetail, setSelectedProductDetail] = useState(null);
  // LAPAKIN_PRODUCT_DETAIL_PRESERVE_SCROLL_V1
  const productDetailScrollYRef = useRef(0);
  const [productSearch, setProductSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [cart, setCart] = useState(() => {
    if (typeof window === "undefined") return {};

    try {
      const raw = window.localStorage.getItem(cartKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      // ignore localStorage failures
    }
  }, [cart, cartKey]);

  const productMap = useMemo(() => {
    const map = {};
    products.forEach((product, index) => {
      const snapshot = getProductSnapshot(product, index);
      map[snapshot.id] = snapshot;
    });
    return map;
  }, [products]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([id, item]) => {
        const product = productMap[id] || item.product;
        const qty = Number(item.qty || 0);

        if (!product || !qty) return null;

        return {
          product,
          qty,
        };
      })
      .filter(Boolean);
  }, [cart, productMap]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const productId = url.searchParams.get("product");

    if (!productId) return;

    const foundIndex = products.findIndex((product, index) => getProductId(product, index) === productId);
    if (foundIndex < 0) return;

    const foundProduct = products[foundIndex];
    if (!foundProduct || isTemplateProductHidden(foundProduct)) return;

    setSelectedProductDetail({ product: foundProduct, index: foundIndex });
  }, [products]);


  const cartCount = cartItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);

  const addToCart = (product, index = 0) => {
    if (isTemplateProductOutOfStock(product) || isTemplateProductHidden(product)) {
      return;
    }

    const snapshot = getProductSnapshot(product, index);

    setCart((prev) => ({
      ...prev,
      [snapshot.id]: {
        product: snapshot,
        qty: Number(prev?.[snapshot.id]?.qty || 0) + 1,
      },
    }));

  };

  const openProductDetail = (product, index = 0, options = {}) => {
    if (!product || isTemplateProductHidden(product)) return;

    if (typeof window !== "undefined") {
      productDetailScrollYRef.current = window.scrollY || window.pageYOffset || 0;
    }

    setSelectedProductDetail({ product, index });

    // LAPAKIN_PRODUCT_DETAIL_NO_URL_ON_CLICK_V1
    // Klik normal tetap terasa seperti popup. Deep link hanya dipakai saat user share link produk.
    if (options.syncUrl === true) {
      syncProductDetailUrl(product, index);
    }
  };

  const closeProductDetail = () => {
    setSelectedProductDetail(null);
    clearProductDetailUrl();

    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        window.scrollTo({
          top: productDetailScrollYRef.current || 0,
          left: 0,
          behavior: "auto",
        });
      });
    }
  };

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined" || !selectedProductDetail) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    const scrollY = window.scrollY || window.pageYOffset || productDetailScrollYRef.current || 0;

    productDetailScrollYRef.current = scrollY;
    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      window.scrollTo(0, scrollY);
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.scrollBehavior = previousScrollBehavior;

      requestAnimationFrame(() => {
        window.scrollTo(0, productDetailScrollYRef.current || scrollY);
      });
    };
  }, [selectedProductDetail]);


  const increaseCartItem = (id) => {
    setCart((prev) => {
      const current = prev[id];
      if (!current) return prev;

      return {
        ...prev,
        [id]: {
          ...current,
          qty: Number(current.qty || 0) + 1,
        },
      };
    });
  };

  const decreaseCartItem = (id) => {
    setCart((prev) => {
      const current = prev[id];
      if (!current) return prev;

      const nextQty = Number(current.qty || 0) - 1;
      if (nextQty <= 0) {
        const next = { ...prev };
        delete next[id];
        return next;
      }

      return {
        ...prev,
        [id]: {
          ...current,
          qty: nextQty,
        },
      };
    });
  };

  const removeCartItem = (id) => {
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const baseSections = template?.sectionOrder?.length
    ? [...template.sectionOrder]
    : ["hero", "categories", "all_products", "contact"];

  let sections = [...baseSections];

  if (
    hasAboutContent(shop) &&
    !sections.includes("about") &&
    !sections.includes("brand_story")
  ) {
    const contactIndex = sections.indexOf("contact");
    if (contactIndex >= 0) {
      sections.splice(contactIndex, 0, "about");
    } else {
      sections.push("about");
    }
  }

  if (shouldShowPromoBanner(shop)) {
    for (let i = sections.length - 1; i >= 0; i -= 1) {
      if (isLegacyPromoLikeSection(sections[i])) {
        sections.splice(i, 1);
      }
    }
  }

  if (shouldShowPromoBanner(shop) && !sections.includes("promo")) {
    const productLikeKeys = [
      "featured",
      "featured_products",
      "featuredProducts",
      "featured_products_section",
      "products",
      "all_products",
      "product_grid",
      "product_list",
      "menu",
      "menu_grid",
      "services",
      "service_grid",
    ];

    let productIndex = -1;

    for (const key of productLikeKeys) {
      const index = sections.indexOf(key);
      if (index > productIndex) {
        productIndex = index;
      }
    }

    if (productIndex >= 0) {
      sections.splice(productIndex + 1, 0, "promo");
    } else {
      const beforeStoryKeys = [
        "about",
        "brand_story",
        "story",
        "about_us",
        "contact",
      ];

      let beforeStoryIndex = -1;

      for (const key of beforeStoryKeys) {
        const index = sections.indexOf(key);
        if (index >= 0 && (beforeStoryIndex === -1 || index < beforeStoryIndex)) {
          beforeStoryIndex = index;
        }
      }

      if (beforeStoryIndex >= 0) {
        sections.splice(beforeStoryIndex, 0, "promo");
      } else {
        sections.push("promo");
      }
    }
  }

  if (shouldShowBusinessHours(shop) && !sections.includes("business_hours")) {
    const locationIndex = sections.indexOf("location_map");
    const contactIndex = sections.indexOf("contact");

    if (locationIndex >= 0) {
      sections.splice(locationIndex + 1, 0, "business_hours");
    } else if (contactIndex >= 0) {
      sections.splice(contactIndex, 0, "business_hours");
    } else {
      sections.push("business_hours");
    }
  }

  // LAPAKIN_TESTIMONIAL_SECTION_ORDER_MVP
  if (shouldShowTestimonials(shop) && !sections.includes("testimonials")) {
    const afterKeys = [
      "about",
      "brand_story",
      "story",
      "benefits",
      "featured_products",
      "featured_products_section",
      "all_products",
      "menu_list",
      "menu_grid",
      "service_list",
      "categories",
    ];

    let inserted = false;

    for (const key of afterKeys) {
      const index = sections.indexOf(key);
      if (index >= 0) {
        sections.splice(index + 1, 0, "testimonials");
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      const beforeKeys = ["location_map", "business_hours", "contact"];
      const beforeIndex = sections.findIndex((key) => beforeKeys.includes(key));

      if (beforeIndex >= 0) {
        sections.splice(beforeIndex, 0, "testimonials");
      } else {
        sections.push("testimonials");
      }
    }
  }

  // Keep small UMKM storefronts focused: avoid repeating the same short catalog.
  if (Array.isArray(products) && products.length <= 6) {
    const categoriesIndex = sections.indexOf("categories");
    if (categoriesIndex >= 0) {
      sections.splice(categoriesIndex, 1);
    }

    const modeForPrune = getModeFromTemplate(template);
    const hasFoodMenuHighlight = sections.some((key) =>
      ["featured_products", "today_menu", "menu_list", "menu_grid", "signature_menu"].includes(key)
    );

    if (modeForPrune === "food_menu" && hasFoodMenuHighlight) {
      const allProductsIndex = sections.indexOf("all_products");
      if (allProductsIndex >= 0) {
        sections.splice(allProductsIndex, 1);
      }
    }
  }

  if (shouldShowOperationalInfo(shop) && !sections.includes("operational_info")) {
    const contactIndex = sections.indexOf("contact");
    const locationIndex = sections.indexOf("location_map");
    const businessHoursIndex = sections.indexOf("business_hours");

    if (locationIndex >= 0) {
      sections.splice(locationIndex, 0, "operational_info");
    } else if (businessHoursIndex >= 0) {
      sections.splice(businessHoursIndex, 0, "operational_info");
    } else if (contactIndex >= 0) {
      sections.splice(contactIndex, 0, "operational_info");
    } else {
      sections.push("operational_info");
    }
  }

  sections = ensureSmallFoodMenuCategories(sections, products, template);

  if (shouldShowLocationMap(shop) && !sections.includes("location_map")) {
    const businessHoursIndex = sections.indexOf("business_hours");
    const contactIndex = sections.indexOf("contact");

    if (businessHoursIndex >= 0) {
      sections.splice(businessHoursIndex, 0, "location_map");
    } else if (contactIndex >= 0) {
      sections.splice(contactIndex, 0, "location_map");
    } else {
      sections.push("location_map");
    }
  }

  if (!sections.includes("contact")) {
    sections.push("contact");
  }

  const finalSections = normalizePromoFinalSectionOrder(
    shop,
    sections
  );

  // LAPAKIN_GROWTH_SPRINT_V2_TEMPLATE_STATE
  const promoViewedRef = useRef(false);
  const [leadCapture, setLeadCapture] = useState({ open: false, href: "", context: {} });

  useEffect(() => {
    if (typeof document === "undefined" || promoViewedRef.current) return;
    const promoNode = document.getElementById("promo") || document.querySelector('[data-testid="storefront-promo-banner"]');
    if (!promoNode) return;
    const markPromoViewed = () => { if (promoViewedRef.current) return; promoViewedRef.current = true; trackTemplateEvent(shop, "promo_view"); };
    if (!("IntersectionObserver" in window)) { markPromoViewed(); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { markPromoViewed(); observer.disconnect(); } }, { threshold: 0.35 });
    observer.observe(promoNode);
    return () => observer.disconnect();
  }, [shop, finalSections]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleClick = (event) => {
      const target = event.target;
      if (!target || !target.closest) return;
      const productCard = target.closest(".ltr-product-card");
      if (productCard) trackTemplateEvent(shop, "product_click", { product_id: productCard.getAttribute("data-product-id") || undefined, metadata: { label: String(productCard.textContent || "").trim().slice(0, 120) } });
      const promoLink = target.closest('#promo a, #promo button, [data-testid="storefront-promo-banner"] a, [data-testid="storefront-promo-banner"] button');
      if (promoLink) trackTemplateEvent(shop, "promo_cta_click");
      const whatsappLink = target.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href*="whatsapp.com/send"]');
      if (!whatsappLink) return;
      const href = whatsappLink.getAttribute("href");
      if (!href || href === "#") return;
      event.preventDefault();
      trackTemplateEvent(shop, "whatsapp_checkout_click", { metadata: { label: String(whatsappLink.textContent || "").trim().slice(0, 120) } });
      setLeadCapture({
        open: true,
        href,
        context: {
          source_label: String(whatsappLink.textContent || "").trim().slice(0, 120),
          type: whatsappLink.getAttribute("data-whatsapp-context") || "",
        },
      });
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [shop]);

  const closeLeadAndOpenWhatsapp = (href) => { setLeadCapture({ open: false, href: "", context: {} }); openWhatsappHref(href); };

  // LAPAKIN_CART_SKIP_SAVE_LEAD_V1
  const buildStorefrontLeadPayload = (form = {}, extraMetadata = {}) => ({
    ...getAnalyticsBasePayload(shop),
    customer_name: form.customer_name || "",
    customer_phone: form.customer_phone || "",
    fulfillment_method: form.fulfillment_method || "discuss",
    notes: form.notes || "",
    items: cartItems.map((item) => ({
      product_id: item.product?.product_id || item.product?.id,
      name: item.product?.name,
      price: item.product?.price,
      qty: item.qty,
    })),
    total: getCartTotal(cartItems),
    metadata: {
      ...(leadCapture.context || {}),
      ...extraMetadata,
    },
  });

  const saveStorefrontLead = async (form = {}, extraMetadata = {}) => {
    try {
      await postStorefrontJson("/storefront/leads", buildStorefrontLeadPayload(form, extraMetadata));
    } catch {
      // Public lead capture is best-effort. WhatsApp checkout must continue.
    }
  };

  const skipLeadToWhatsapp = async () => {
    const href = leadCapture.href;

    if (leadCapture.context?.type === "cart_checkout" && cartItems.length > 0) {
      await saveStorefrontLead(
        {
          customer_name: "",
          customer_phone: "",
          fulfillment_method: "discuss",
          notes: "",
        },
        {
          lead_capture_action: "skip",
          skipped_lead_capture: true,
        }
      );
    }

    closeLeadAndOpenWhatsapp(href);
  };

  const continueLeadToWhatsapp = async (form) => {
    const href =
      leadCapture.context?.type === "cart_checkout"
        ? buildCartWhatsappLink(shop, cartItems, form)
        : enrichWhatsappHrefWithLead(leadCapture.href, form);

    await saveStorefrontLead(form, { lead_capture_action: "continue" });
    closeLeadAndOpenWhatsapp(href);
  };


  const templateCategories = Array.from(
    new Set((products || []).map(getProductCategory).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "id"));

  const visibleStorefrontProducts = (products || []).filter(
    (product) => !isTemplateProductHidden(product)
  );

  const productsForSections = visibleStorefrontProducts.filter((product) => {
    const categoryOk =
      categoryFilter === "all" ||
      getProductCategoryKey(product) === String(categoryFilter || "").toLowerCase();

    return categoryOk && productMatchesTemplateSearch(product, productSearch);
  });

    // LAPAKIN_BUSINESS_VARIANT_ROOT_CLASS_V1
  const businessVariant = getBusinessTemplateVariant(shop, template);

  return (
    <main
      className={cx(
        "ltr-page",
        `ltr-template-${template.templateKey}`,
        `ltr-mode-${mode}`,
        `ltr-density-${template.density}`,
        `ltr-card-layout-${template.productCard}`
      , businessVariant.rootClass)}
      data-testid="storefront-template-renderer" data-business-variant={businessVariant.key}
      data-template-key={template.templateKey}
    >
      <div className="ltr-background-orb ltr-background-orb-one" />
      <div className="ltr-background-orb ltr-background-orb-two" />

      <div className="ltr-container">
        {/* LAPAKIN_TESTIMONIAL_RENDER_FALLBACK */}
        {(() => {
          const sectionsToRender = Array.isArray(finalSections) ? [...finalSections] : [];

          if (shouldShowTestimonials(shop) && !sectionsToRender.includes("testimonials")) {
            const beforeIndex = sectionsToRender.findIndex((key) =>
              ["location_map", "business_hours", "contact"].includes(key)
            );

            if (beforeIndex >= 0) {
              sectionsToRender.splice(beforeIndex, 0, "testimonials");
            } else {
              sectionsToRender.push("testimonials");
            }
          }

          return sectionsToRender.map((section) =>
            renderSection(section, { shop, products: productsForSections, allProducts: visibleStorefrontProducts, template, onAddToCart: addToCart, onOpenProduct: openProductDetail, productSearch, setProductSearch, categoryFilter, setCategoryFilter })
          );
        })()}
      </div>

      <FloatingCartButton count={cartCount} onOpen={() => setCartOpen(true)} />

      <ProductDetailModal
        open={!!selectedProductDetail}
        product={selectedProductDetail?.product}
        index={selectedProductDetail?.index || 0}
        shop={shop}
        onClose={closeProductDetail}
        onAddToCart={addToCart}
      />

      <TemplateCartDrawer
        shop={shop}
        cartItems={cartItems}
        cartOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        onIncrease={increaseCartItem}
        onDecrease={decreaseCartItem}
        onRemove={removeCartItem}
        onClear={() => setCart({})}
      />

<LeadCaptureModal
        open={leadCapture.open}
        showCartSummary={leadCapture.context?.type === "cart_checkout"}
        cartItems={leadCapture.context?.type === "cart_checkout" ? cartItems : []}
        onClose={() => setLeadCapture((current) => ({ ...current, open: false }))}
        onSkip={skipLeadToWhatsapp}
        onContinue={continueLeadToWhatsapp}
      />

      <MobileStickyOrderBar
        shop={shop}
        template={template}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
      />
    </main>
  );
}


class StorefrontTemplateRendererErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, info) {
    // Keep this log for renderer preview debugging.
    console.error("Storefront template renderer error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || "Unknown renderer error";

      return (
        <main className="min-h-screen bg-red-50 p-6 text-red-950">
          <div className="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-black uppercase tracking-wide text-red-600">
              Renderer Preview Error
            </p>
            <h1 className="mt-2 text-2xl font-black">
              Layout renderer gagal dimuat.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-red-800">
              Website normal tetap aman. Hapus query <code>?renderer=1</code> untuk kembali ke layout lama.
            </p>
            <pre className="mt-4 overflow-auto rounded-2xl bg-red-950 p-4 text-xs text-red-50">
              {String(message)}
            </pre>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export function SafeStorefrontTemplateRenderer(props) {
  return (
    <StorefrontTemplateRendererErrorBoundary>
      <StorefrontTemplateRenderer {...props} />
    </StorefrontTemplateRendererErrorBoundary>
  );
}
