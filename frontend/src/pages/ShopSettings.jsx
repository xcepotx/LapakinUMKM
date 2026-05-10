import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Wand2, Upload, X, ImagePlus, Trash2, QrCode, RefreshCw, Users, UserPlus, ShieldCheck, MessageCircle, Truck, Store, WalletCards, MapPin, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";


// LAPAKIN_WHATSAPP_TEMPLATE_G1A
const DEFAULT_WHATSAPP_CHECKOUT_TEMPLATE = `Halo {shop_name}, saya mau pesan:

{items}

Total: {total}
Nama: {customer_name}
Catatan: {notes}
{payment_instruction}`;

const DEFAULT_WHATSAPP_PRODUCT_TEMPLATE = `Halo {shop_name}, saya mau tanya produk:

{product_name}
Harga: {product_price}

Apakah masih tersedia?`;

const WHATSAPP_TEMPLATE_VARIABLES = [
  "{shop_name}",
  "{customer_name}",
  "{items}",
  "{total}",
  "{notes}",
  "{payment_instruction}",
  "{campaign_slug}",
  "{product_name}",
  "{product_price}",
];
import { resolveStorefrontTemplate } from "../storefront/templates";
import StorefrontSeoEditor from "@/components/StorefrontSeoEditor";



const SHOP_SETTINGS_SECTION_TEXT = {
  contact: ["whatsapp", "nomor whatsapp", "kontak", "order & kontak"],
  order: ["metode order", "pickup", "delivery", "cod", "online-only"],
  payment: ["pembayaran", "qris", "rekening", "transfer", "payment"],
  location: ["lokasi", "alamat", "google maps", "maps"],
};

function findShopSettingsSectionElement(section) {
  const terms = SHOP_SETTINGS_SECTION_TEXT[section] || [];
  if (!terms.length || typeof document === "undefined") return null;

  const candidates = Array.from(
    document.querySelectorAll("label, h1, h2, h3, h4, legend, button, [data-section], [data-testid]")
  );

  for (const el of candidates) {
    const explicit =
      String(el.getAttribute("data-section") || "").toLowerCase() === section ||
      String(el.getAttribute("data-testid") || "").toLowerCase().includes(section);

    const text = String(el.textContent || "").toLowerCase();
    const matched = explicit || terms.some((term) => text.includes(term));

    if (matched) {
      return el.closest("section, form, fieldset, .rounded-3xl, .rounded-2xl, .card, [class*='border']") || el;
    }
  }

  return null;
}

function scrollToShopSettingsSection(section) {
  const target = findShopSettingsSectionElement(section);
  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("ring-2", "ring-brand", "ring-offset-2");

  window.setTimeout(() => {
    target.classList.remove("ring-2", "ring-brand", "ring-offset-2");
  }, 2200);

  const input = target.querySelector("input, textarea, select, button");
  if (input && typeof input.focus === "function") {
    window.setTimeout(() => input.focus({ preventScroll: true }), 500);
  }

  return true;
}

const LAPAKIN_WA_TEMPLATE_PREVIEW_SAMPLE = {
  shop_name: "Warung Bu Sari",
  customer_name: "Siti",
  items: "2x Bakso Spesial - Rp 50.000\n1x Es Teh Manis - Rp 5.000",
  total: "Rp 55.000",
  notes: "Pedas sedang, tanpa sambal terpisah",
  payment_instruction: "Transfer/QRIS sesuai instruksi toko, lalu kirim bukti pembayaran.",
  campaign_slug: "promo-minggu-ini",
  product_name: "Bakso Spesial",
  product_price: "Rp 25.000",
};

function renderLapakinWhatsAppTemplatePreview(template = "", overrides = {}) {
  const sample = { ...LAPAKIN_WA_TEMPLATE_PREVIEW_SAMPLE, ...overrides };
  const source = String(template || "").trim();
  if (!source) return "Template masih kosong. Isi template untuk melihat preview.";
  return source.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(sample, key)) return sample[key];
    return match;
  });
}

function LapakinWhatsAppTemplatePreview({ title, template, overrides }) {
  const preview = renderLapakinWhatsAppTemplatePreview(template, overrides);
return (
    <div className="mt-3 rounded-2xl border border-brand-line bg-white/70 p-4 shadow-sm" data-testid="whatsapp-template-preview">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-brand-ink">{title}</p>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-primary">
          Preview sample
        </span>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-50">
        {preview}
      </pre>
      <p className="mt-2 text-xs text-brand-mute">
        Sample memakai Warung Bu Sari, customer Siti, item bakso/es teh, total, notes, payment instruction, campaign slug, dan data produk contoh.
      </p>
    </div>
  );
}


const BUSINESS_TYPES = [
  { id: "kuliner", label: "Kuliner / Makanan" },
  { id: "kopi", label: "Kopi / Minuman" },
  { id: "fashion", label: "Fashion" },
  { id: "kerajinan", label: "Kerajinan / Handmade" },
  { id: "kecantikan", label: "Kecantikan" },
  { id: "lainnya", label: "Lainnya" },
];



// LAPAKIN_GROWTH_SPRINT_V2_SETTINGS_HELPERS
function formatGrowthNumber(value) { return Number(value || 0).toLocaleString("id-ID"); }
function formatGrowthCurrency(value) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function formatGrowthDate(value) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }); } catch { return value; }
}
// /LAPAKIN_GROWTH_SPRINT_V2_SETTINGS_HELPERS

const COVER_STYLES = [
  { id: "warm", label: "Hangat / Earthy" },
  { id: "minimal", label: "Minimal / Bersih" },
  { id: "vibrant", label: "Cerah / Vibrant" },
];

export default function ShopSettings({ settingsView = "shop" } = {}) {
  
  const orderContactLocation = useLocation();

const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const isWebsiteSettings = settingsView === "website";

  const updateShopField = (field, value) => {
    setShop((prev) => ({ ...(prev || {}), [field]: value }));
  };

  const updateShopCheckbox = (field, event) => {
    updateShopField(field, Boolean(event?.target?.checked));
  };

  const [storefrontPickerProducts, setStorefrontPickerProducts] = useState([]);
  // storefront-featured-products-loader
  useEffect(() => {
    let alive = true;

    api.get("/products")
      .then((response) => {
        const data = response?.data;
        const items = Array.isArray(data)
          ? data
          : data?.products || data?.items || data?.data || [];

        if (alive) {
          setStorefrontPickerProducts(Array.isArray(items) ? items : []);
        }
      })
      .catch(() => {
        if (alive) {
          setStorefrontPickerProducts([]);
        }
      });
return () => {
      alive = false;
    };
  }, []);


  const [settingsCurrentUserForTier, setSettingsCurrentUserForTier] = useState(null);
  // settings-current-user-tier-loader
  useEffect(() => {
    let alive = true;

    api.get("/auth/me")
      .then((response) => {
        if (alive) {
          setSettingsCurrentUserForTier(response?.data || null);
        }
      })
      .catch(() => {
        if (alive) {
          setSettingsCurrentUserForTier(null);
        }
      });

  

  return () => {
      alive = false;
    };
  }, []);


  const [enhancingStorefrontCopy, setEnhancingStorefrontCopy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingAbout, setGeneratingAbout] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverStyle, setCoverStyle] = useState("warm");
  const [team, setTeam] = useState(null);
  const [teamEmail, setTeamEmail] = useState("");
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [branchInfo, setBranchInfo] = useState(null);
  const [branchName, setBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  // LAPAKIN_GROWTH_SPRINT_V2_SETTINGS_STATE
  const [storefrontAnalytics, setStorefrontAnalytics] = useState(null);
  const [storefrontLeads, setStorefrontLeads] = useState([]);
  const [storefrontGrowthError, setStorefrontGrowthError] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/shops/me");
      if (!data) { navigate("/onboarding"); return; }
      setShop(data);
    })();
  }, [navigate]);


  // LAPAKIN_GROWTH_SPRINT_V2_SETTINGS_LOADER
  useEffect(() => {
    if (!isWebsiteSettings || !shop?.shop_id) return;
    let alive = true;
    async function loadStorefrontGrowthData() {
      try {
        const [analyticsResponse, leadsResponse] = await Promise.all([api.get("/shops/storefront-analytics?days=30"), api.get("/shops/storefront-leads?limit=5")]);
        if (!alive) return;
        setStorefrontAnalytics(analyticsResponse?.data || null);
        setStorefrontLeads(leadsResponse?.data?.leads || []);
        setStorefrontGrowthError("");
      } catch (error) {
        if (!alive) return;
        setStorefrontAnalytics(null);
        setStorefrontLeads([]);
        setStorefrontGrowthError("Analytics website belum tersedia.");
      }
    }
    loadStorefrontGrowthData();
    return () => { alive = false; };
  }, [isWebsiteSettings, shop?.shop_id]);

  const loadTeam = async () => {
    setTeamLoading(true);
    setTeamError("");
    try {
      const { data } = await api.get("/team/members");
      setTeam(data);
    } catch (e) {
      setTeam(null);
      setTeamError(formatApiError(e.response?.data?.detail) || "Gagal memuat anggota tim");
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    if (shop?.shop_id) loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop?.shop_id]);

  const loadBranches = async () => {
    try {
      const { data } = await api.get("/shops/mine");
      setBranchInfo(data);
    } catch (e) {
      setBranchInfo(null);
    }
  };

  useEffect(() => {
    if (shop?.shop_id) loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop?.shop_id]);

  const createBranch = async () => {
    const name = branchName.trim();
    if (!name) { toast.error("Isi nama cabang dulu"); return; }

    setCreatingBranch(true);
    try {
      const payload = { ...shop, name };
      [
        "shop_id", "slug", "owner_user_id", "created_at", "updated_at",
        "status", "featured", "custom_domain", "custom_domain_verified",
        "custom_domain_requested_at", "custom_domain_verified_at",
        "instagram_connected", "instagram_user_id", "instagram_access_token",
        "instagram_connected_at", "instagram_connected_by",
        "instagram_last_publish_at", "instagram_last_media_id",
      ].forEach((k) => delete payload[k]);

      await api.post("/shops/branches", payload);
      toast.success("Cabang baru dibuat");
      window.location.href = "/dashboard/settings";
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal membuat cabang");
    } finally {
      setCreatingBranch(false);
    }
  };

  const addTeamMember = async () => {
    const email = teamEmail.trim().toLowerCase();
    if (!email) { toast.error("Isi email anggota dulu"); return; }

    setAddingMember(true);
    try {
      const { data } = await api.post("/team/members", { email });
      setTeamEmail("");
      toast.success(
        data?.status === "pending_invite"
          ? "Undangan tersimpan. Minta anggota daftar dengan email itu."
          : "Anggota tim ditambahkan"
      );
      await loadTeam();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal tambah anggota");
    } finally {
      setAddingMember(false);
    }
  };

  const removeTeamMember = async (member) => {
    if (!window.confirm(`Hapus ${member.name || member.email} dari tim?`)) return;

    try {
      await api.delete(`/team/members/${member.user_id}`);
      toast.success("Anggota dihapus dari tim");
      await loadTeam();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal hapus anggota");
    }
  };

  const revokeTeamInvite = async (invite) => {
    if (!window.confirm(`Batalkan undangan untuk ${invite.email}?`)) return;

    try {
      await api.delete(`/team/invites/${invite.invite_id}`);
      toast.success("Undangan dibatalkan");
      await loadTeam();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal batalkan undangan");
    }
  };

  if (!shop) {
    return <DashboardLayout title={isWebsiteSettings ? "Tampilan Website" : "Pengaturan Toko"}><div className="text-brand-mute">Memuat…</div></DashboardLayout>;
  }

  const update = (k, v) => setShop((s) => ({ ...s, [k]: v }));


  const resetStorefrontTemplateContent = () => {

    const ok = window.confirm(

      "Reset konten template ke otomatis? Judul, subtitle, CTA, judul section, dan produk unggulan pilihan akan dikosongkan. Mode, style, renderer, dan data toko tidak berubah."

    );

  

    if (!ok) return;

  

    setShop((prev) => ({

      ...prev,

      storefront_hero_title: "",

      storefront_hero_subtitle: "",

      storefront_cta_label: "",

      storefront_featured_title: "",

      storefront_about_title: "",

      storefront_featured_product_ids: [],
      storefront_show_testimonials: false,
      storefront_testimonials: [],
    storefront_show_promo: false,
    storefront_promo_title: "",
    storefront_promo_text: "",
    storefront_promo_cta_label: "",
    storefront_promo_slug: "",

    }));

  };

  const autoGenerateStorefrontTemplateFromBusiness = async () => {
    if (enhancingStorefrontCopy) return;

    if (!storefrontTemplateFeatures.ai) {
      alert("Auto-generate template tersedia mulai paket Pro.");
      return;
    }

    const ok = window.confirm(
      "Auto-generate template dari data toko dan produk? Mode, style, copy, produk unggulan, dan promo banner akan diisi otomatis. Kamu tetap bisa edit manual sebelum menyimpan."
    );

    if (!ok) return;

    const products = Array.isArray(storefrontPickerProducts)
      ? storefrontPickerProducts
      : [];

    const shopName = shop.name || shop.shop_name || shop.store_name || "Toko Kamu";
    const shopDescription =
      shop.description ||
      shop.about ||
      shop.bio ||
      shop.tagline ||
      "";

    const productText = products
      .slice(0, 40)
      .map((product) =>
        [
          product.name,
          product.title,
          product.category,
          product.product_category,
          product.description,
          product.type,
          product.product_mode,
        ]
          .filter(Boolean)
          .join(" ")
      )
      .join(" ");

    const businessText = [
      shopName,
      shopDescription,
      shop.business_category,
      shop.category,
      shop.store_category,
      productText,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const hasAnyKeyword = (keywords) =>
      keywords.some((keyword) => businessText.includes(keyword));

    const foodKeywords = [
      "makanan",
      "minuman",
      "food",
      "drink",
      "warung",
      "menu",
      "nasi",
      "ayam",
      "bakso",
      "mie",
      "kopi",
      "cafe",
      "resto",
      "kuliner",
      "snack",
      "kue",
      "roti",
      "catering",
    ];

    const serviceKeywords = [
      "jasa",
      "layanan",
      "service",
      "konsultasi",
      "studio",
      "foto",
      "desain",
      "design",
      "video",
      "branding",
      "printing",
      "laundry",
      "salon",
      "barber",
      "repair",
      "bengkel",
      "kelas",
      "kursus",
    ];

    const inferredMode = hasAnyKeyword(serviceKeywords)
      ? "services"
      : hasAnyKeyword(foodKeywords)
        ? "food_menu"
        : "catalog";

    const inferredStyle =
      inferredMode === "services"
        ? "premium"
        : inferredMode === "food_menu"
          ? "playful"
          : "modern";

    const ctaLabel =
      inferredMode === "services"
        ? "Konsultasi Sekarang"
        : inferredMode === "food_menu"
          ? "Pesan Sekarang"
          : "Chat & Order Sekarang";

    const featuredTitle =
      inferredMode === "services"
        ? "Layanan Unggulan"
        : inferredMode === "food_menu"
          ? "Menu Favorit Hari Ini"
          : "Produk Favorit";

    const heroTitle =
      inferredMode === "services"
        ? `Layanan terpercaya dari ${shopName}`
        : inferredMode === "food_menu"
          ? `Menu favorit dari ${shopName}, siap menemani harimu`
          : `Temukan pilihan terbaik dari ${shopName}`;

    const heroSubtitle =
      shopDescription ||
      (inferredMode === "services"
        ? "Lihat pilihan layanan, konsultasikan kebutuhanmu, lalu hubungi kami langsung via WhatsApp."
        : inferredMode === "food_menu"
          ? "Pilih menu favorit, cek harga, lalu pesan praktis lewat WhatsApp."
          : "Lihat produk pilihan, cek detail dan harga, lalu order langsung lewat WhatsApp.");

    const aboutTitle =
      inferredMode === "services"
        ? `Kenal lebih dekat dengan ${shopName}`
        : inferredMode === "food_menu"
          ? `Cerita rasa dari ${shopName}`
          : `Cerita di balik ${shopName}`;

    const productIdOf = (product) =>
      String(product?.product_id || product?.id || product?._id || "");

    const activeProducts = products.filter((product) => {
      if (!product) return false;
      if (product.active === false || product.is_active === false || product.visible === false) {
        return false;
      }
      return Boolean(productIdOf(product));
    });

    const featuredLimit = storefrontTemplateFeatures.featuredLimit || 0;

    const selectedProductIds = [...activeProducts]
      .sort((a, b) => {
        const aFeatured = a.featured || a.is_featured ? 1 : 0;
        const bFeatured = b.featured || b.is_featured ? 1 : 0;
        return bFeatured - aFeatured;
      })
      .slice(0, Math.max(0, Math.min(featuredLimit || 0, inferredMode === "food_menu" ? 6 : 4)))
      .map(productIdOf)
      .filter(Boolean);

    const promoTitle =
      inferredMode === "services"
        ? "Konsultasi kebutuhanmu minggu ini"
        : inferredMode === "food_menu"
          ? "Promo Minggu Ini"
          : "Promo Spesial Minggu Ini";

    const promoText =
      inferredMode === "services"
        ? "Ceritakan kebutuhanmu dan dapatkan rekomendasi layanan yang paling sesuai."
        : inferredMode === "food_menu"
          ? "Pesan menu favorit minggu ini dan tanyakan promo terbaru langsung via WhatsApp."
          : "Tanyakan stok, rekomendasi produk, dan promo terbaru langsung via WhatsApp.";

    const promoCta =
      inferredMode === "services"
        ? "Konsultasi Promo"
        : inferredMode === "food_menu"
          ? "Ambil Promo"
          : "Cek Promo";

    setEnhancingStorefrontCopy(true);

    let aiCopy = {};

    try {
      const response = await api.post("/shops/storefront-copy-ai", {
        shop_name: shopName,
        shop_description: shopDescription,
        business_category:
          shop.business_category ||
          shop.category ||
          shop.store_category ||
          inferredMode,
        instagram: shop.instagram || "",
        tiktok: shop.tiktok || "",
        storefront_mode: inferredMode,
        storefront_style: inferredStyle,
        current: {
          storefront_hero_title: heroTitle,
          storefront_hero_subtitle: heroSubtitle,
          storefront_cta_label: ctaLabel,
          storefront_featured_title: featuredTitle,
          storefront_about_title: aboutTitle,
        },
      });

      aiCopy = response?.data?.copy || {};
    } catch (err) {
      console.warn("Auto-generate template AI fallback used", err);
      aiCopy = {};
    } finally {
      setEnhancingStorefrontCopy(false);
    }

    setShop((prev) => ({
      ...prev,
      storefront_renderer: "template",
      storefront_mode: inferredMode,
      storefront_style: inferredStyle,
      storefront_hero_title: aiCopy.storefront_hero_title || heroTitle,
      storefront_hero_subtitle: aiCopy.storefront_hero_subtitle || heroSubtitle,
      storefront_cta_label: aiCopy.storefront_cta_label || ctaLabel,
      storefront_featured_title: aiCopy.storefront_featured_title || featuredTitle,
      storefront_about_title: aiCopy.storefront_about_title || aboutTitle,
      storefront_featured_product_ids: selectedProductIds,
      storefront_show_promo: true,
      storefront_promo_title: promoTitle,
      storefront_promo_text: promoText,
      storefront_promo_cta_label: promoCta,
      storefront_promo_slug: makeStorefrontCampaignSlug(promoTitle),
    }));

    alert("Template berhasil dibuat otomatis. Cek preview, lalu klik Simpan Semua Perubahan.");
  };



  const getStorefrontTemplateFeatureConfig = (tierValue) => {
    const normalizedTier = String(tierValue || "free").toLowerCase();

    if (normalizedTier === "business") {
      return {
        tier: "business",
        templates: true,
        editor: true,
        ai: true,
        advanced: true,
        promo: true,
        allowedStyles: ["classic", "modern", "compact", "premium", "playful"],
        aiLimit: 200,
        featuredLimit: 12,
      };
    }

    if (normalizedTier === "pro") {
      return {
        tier: "pro",
        templates: true,
        editor: true,
        ai: true,
        advanced: false,
        promo: true,
        allowedStyles: ["classic", "modern", "compact", "premium", "playful"],
        aiLimit: 30,
        featuredLimit: 6,
      };
    }

    if (normalizedTier === "starter") {
      return {
        tier: "starter",
        templates: true,
        editor: true,
        ai: false,
        advanced: false,
        promo: false,
        allowedStyles: ["classic", "modern", "compact"],
        aiLimit: 0,
        featuredLimit: 3,
      };
    }

    return {
      tier: "free",
      templates: false,
      editor: false,
      ai: false,
      advanced: false,
      allowedStyles: ["classic"],
      aiLimit: 0,
      featuredLimit: 0,
    };
  };

  const currentUserForStorefrontTier =
    settingsCurrentUserForTier ||
    (typeof user !== "undefined" ? user : null);

  const storefrontTier =
    currentUserForStorefrontTier?.tier ||
    currentUserForStorefrontTier?.plan ||
    currentUserForStorefrontTier?.subscription_tier ||
    shop?.tier ||
    shop?.plan ||
    shop?.subscription_tier ||
    "free";

  const storefrontTemplateFeatures = getStorefrontTemplateFeatureConfig(storefrontTier);
  const storefrontTemplateLocked = !storefrontTemplateFeatures.templates;
  const storefrontEditorLocked = !storefrontTemplateFeatures.editor;
  const storefrontAiLocked = !storefrontTemplateFeatures.ai;
  const storefrontPromoLocked = !storefrontTemplateFeatures.promo;

  const makeStorefrontCampaignSlug = (value) => {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
  };

  const activeCampaignSlug =
    makeStorefrontCampaignSlug(shop.storefront_promo_slug) ||
    makeStorefrontCampaignSlug(shop.storefront_promo_title) ||
    "promo";

  const activeShopSlug = shop.slug || shop.shop_slug || shop.store_slug || "";
  const storefrontCampaignRenderer = shop.storefront_renderer || "legacy";
  const storefrontCampaignQuery =
    storefrontCampaignRenderer === "template"
      ? `?promo=${encodeURIComponent(activeCampaignSlug)}`
      : `?renderer=1&promo=${encodeURIComponent(activeCampaignSlug)}`;

  const storefrontCampaignHost =
    typeof window !== "undefined" ? window.location.hostname : "";

  const isProductionMainDomain =
    storefrontCampaignHost === "lapakin.my.id" ||
    storefrontCampaignHost.endsWith(".lapakin.my.id");

  const isDevOrLocalDomain =
    storefrontCampaignHost === "dev.lapakin.my.id" ||
    storefrontCampaignHost.endsWith(".dev.lapakin.my.id") ||
    storefrontCampaignHost === "localhost" ||
    storefrontCampaignHost === "127.0.0.1";

  const storefrontCampaignPath = activeShopSlug
    ? `/toko/${activeShopSlug}${storefrontCampaignQuery}#promo`
    : "";

  const storefrontCampaignUrl =
    typeof window !== "undefined" && activeShopSlug
      ? isProductionMainDomain && !isDevOrLocalDomain
        ? `${window.location.protocol}//${activeShopSlug}.lapakin.my.id${storefrontCampaignQuery}#promo`
        : `${window.location.origin}${storefrontCampaignPath}`
      : storefrontCampaignPath;

  const copyStorefrontCampaignLink = async () => {
    if (!storefrontCampaignUrl) return;

    try {
      await navigator.clipboard.writeText(storefrontCampaignUrl);
      alert("Link promo berhasil disalin.");
    } catch {
      window.prompt("Salin link promo:", storefrontCampaignUrl);
    }
  };


  const storefrontFeaturedLimit = storefrontTemplateFeatures.featuredLimit || 0;
  const selectedFeaturedProductIds = Array.isArray(shop.storefront_featured_product_ids)
    ? shop.storefront_featured_product_ids
    : [];
  const selectedFeaturedProductSet = new Set(selectedFeaturedProductIds);

  const getStorefrontProductId = (product) =>
    String(product?.product_id || product?.id || product?._id || "");

  const toggleStorefrontFeaturedProduct = (productId) => {
    if (!productId || storefrontTemplateLocked || storefrontFeaturedLimit <= 0) return;

    setShop((prev) => {
      const current = Array.isArray(prev.storefront_featured_product_ids)
        ? prev.storefront_featured_product_ids
        : [];
      const exists = current.includes(productId);

      if (exists) {
        return {
          ...prev,
          storefront_featured_product_ids: current.filter((id) => id !== productId),
        };
      }

      if (current.length >= storefrontFeaturedLimit) {
        return prev;
      }

      return {
        ...prev,
        storefront_featured_product_ids: [...current, productId],
      };
    });
  };



  const enhanceStorefrontCopy = async () => {

    if (enhancingStorefrontCopy) return;


    setEnhancingStorefrontCopy(true);


    try {

      const response = await api.post("/shops/storefront-copy-ai", {

        shop_name: shop.name || shop.shop_name || "",

        shop_description: shop.description || shop.bio || shop.about || "",

        business_category: shop.business_category || shop.category || "",

        instagram: shop.instagram || "",

        tiktok: shop.tiktok || "",

        storefront_mode: shop.storefront_mode || "catalog",

        storefront_style: shop.storefront_style || "classic",

        current: {

          storefront_hero_title: shop.storefront_hero_title || "",

          storefront_hero_subtitle: shop.storefront_hero_subtitle || "",

          storefront_cta_label: shop.storefront_cta_label || "",

          storefront_featured_title: shop.storefront_featured_title || "",

          storefront_about_title: shop.storefront_about_title || "",

        },

      });


      const copy = response?.data?.copy || {};


      setShop((prev) => ({

        ...prev,

        storefront_hero_title: copy.storefront_hero_title || prev.storefront_hero_title || "",

        storefront_hero_subtitle: copy.storefront_hero_subtitle || prev.storefront_hero_subtitle || "",

        storefront_cta_label: copy.storefront_cta_label || prev.storefront_cta_label || "",

        storefront_featured_title: copy.storefront_featured_title || prev.storefront_featured_title || "",

        storefront_about_title: copy.storefront_about_title || prev.storefront_about_title || "",

      }));

    } catch (err) {

      console.error("AI storefront copy failed", err);

      alert("AI Enhance belum berhasil. Coba lagi beberapa saat lagi.");

    } finally {

      setEnhancingStorefrontCopy(false);

    }

  };

  const onCoverFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast.error("Max 8MB"); return; }
    const r = new FileReader();
    r.onload = () => update("cover_image", r.result);
    r.readAsDataURL(f);
    e.target.value = "";
  };

  const generateAbout = async () => {
    setGeneratingAbout(true);
    try {
      const { data } = await api.post("/ai/generate-about", {
        shop_name: shop.name, business_type: shop.business_type,
        tagline: shop.tagline || "", description: shop.description || "",
      });
      update("about", data.about);
      toast.success("Cerita 'Tentang Kami' dibuat AI!");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal"); }
    finally { setGeneratingAbout(false); }
  };

  const generateCover = async () => {
    setGeneratingCover(true);
    try {
      const { data } = await api.post("/ai/generate-cover", {
        shop_name: shop.name, business_type: shop.business_type, style: coverStyle,
      });
      update("cover_image", `data:${data.mime_type || "image/png"};base64,${data.image_base64}`);
      toast.success("Cover banner AI siap!");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal"); }
    finally { setGeneratingCover(false); }
  };

  // ----- Story Reel -----
  const onStoryFile = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remain = 5 - (shop.story?.length || 0);
    if (remain <= 0) { toast.error("Maksimal 5 foto story"); return; }
    Promise.all(files.slice(0, remain).map((f) => new Promise((res) => {
      if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} > 5MB`); res(null); return; }
      const r = new FileReader(); r.onload = () => res({ image: r.result, caption: "" }); r.readAsDataURL(f);
    }))).then((arr) => {
      update("story", [...(shop.story || []), ...arr.filter(Boolean)]);
    });
    e.target.value = "";
  };
  const removeStory = (i) => update("story", (shop.story || []).filter((_, idx) => idx !== i));
  const setStoryCaption = (i, txt) => update("story", (shop.story || []).map((s, idx) => idx === i ? { ...s, caption: txt } : s));

  const onStorefrontQrisFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("File QRIS harus berupa gambar.");
      event.target.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Ukuran gambar QRIS maksimal 2MB.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      update("storefront_qris_image", reader.result);
      toast.success("Gambar QRIS siap disimpan.");
    };
    reader.onerror = () => toast.error("Gagal membaca gambar QRIS.");
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...shop };
      delete payload.shop_id; delete payload.slug; delete payload.owner_user_id;
      delete payload.created_at; delete payload.updated_at; delete payload.status; delete payload.featured;
      payload.payment_instruction = shop.payment_instruction || shop.storefront_payment_instruction || shop.payment_notes || "";
      payload.storefront_payment_instruction = payload.payment_instruction;
      const { data } = await api.post("/shops/me", payload);
      setShop(data);
      toast.success("Tersimpan");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan"); }
    finally { setSaving(false); }
  };

  
  if (isWebsiteSettings) {
    return (
      <DashboardLayout
        shop={shop}
        title="Tampilan Website"
        subtitle="Atur tampilan website publik, template, produk unggulan, promo, dan link campaign."
      >

          <div
            className="rounded-3xl border border-brand-line bg-white p-5 shadow-card"
            data-testid="website-settings-shop-data-notice"
          >
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-mute">
              Data toko
            </p>
            <h2 className="mt-1 font-heading text-xl font-extrabold text-brand-ink">
              Kontak, pembayaran, dan lokasi dikelola di Pengaturan Toko
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-brand-mute">
              Nomor WhatsApp, instruksi pembayaran, status toko offline, Google Maps,
              pickup, delivery, dan area layanan tetap dipakai oleh storefront, tetapi
              pengisiannya sekarang dipusatkan di halaman Pengaturan Toko.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => navigate("/dashboard/settings")}
            >
              Buka Pengaturan Toko
            </Button>
          </div>




        <div className="space-y-6">
<Section title="Tampilan Website" desc="Pilih mode dan gaya visual website publik toko.">
            <div className="grid md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-bold text-brand-ink">Mode Website</span>
                <select
                  value={shop.storefront_mode || "catalog"}
                  onChange={(e) => update("storefront_mode", e.target.value)}
                  className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                  disabled={storefrontTemplateLocked}
                  data-testid="storefront-mode-select"
                >
                  <option value="catalog">Katalog Produk</option>
                  <option value="food_menu">Menu Makanan / Minuman</option>
                  <option value="services">Jasa & Layanan</option>
                </select>
                <span className="mt-1 block text-xs text-brand-mute">
                  Mode menentukan struktur utama storefront sesuai jenis usaha.
                </span>
              </label>

              <label className="block">
                <span className="text-sm font-bold text-brand-ink">Style Website</span>
                <select
                  value={shop.storefront_style || "classic"}
                  onChange={(e) => update("storefront_style", e.target.value)}
                  className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                  disabled={storefrontTemplateLocked}
                  data-testid="storefront-style-select"
                >
                  <option value="classic">Classic</option>
                  <option value="modern">Modern</option>
                  <option value="compact">Compact</option>
                  <option value="premium" disabled={!storefrontTemplateFeatures.allowedStyles.includes("premium")}>Premium (Pro)</option>
                  <option value="playful" disabled={!storefrontTemplateFeatures.allowedStyles.includes("playful")}>Playful (Pro)</option>
                </select>
                <span className="mt-1 block text-xs text-brand-mute">
                  Style menentukan nuansa visual website toko.
                </span>
              </label>
            </div>


            <div className="mt-4 rounded-2xl border border-brand-line bg-brand-off p-4">
              <label className="block">
                <span className="text-sm font-bold text-brand-ink">Renderer Website</span>
                <select
                  value={shop.storefront_renderer || "legacy"}
                  onChange={(e) => update("storefront_renderer", e.target.value)}
                  className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                  disabled={storefrontTemplateLocked}
                  data-testid="storefront-renderer-select"
                >
                  <option value="legacy">Legacy Aman</option>
                  <option value="template">Template Baru</option>
                </select>
                <span className="mt-1 block text-xs text-brand-mute">
                  Legacy menjaga tampilan lama. Template Baru memakai layout renderer mode/style yang lebih imajinatif.
                </span>
              </label>
            </div>



            <div
              className={`mt-4 rounded-2xl border p-4 ${
                storefrontTemplateLocked
                  ? "border-amber-200 bg-amber-50"
                  : storefrontAiLocked
                    ? "border-blue-200 bg-blue-50"
                    : "border-emerald-200 bg-emerald-50"
              }`}
              data-testid="storefront-template-tier-gate"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-brand-ink">
                    Fitur template untuk paket kamu
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-brand-mute">
                    {storefrontTemplateLocked
                      ? "Paket Free memakai website legacy. Upgrade ke Starter untuk membuka mode/template website."
                      : storefrontAiLocked
                        ? "Paket kamu sudah bisa memakai Template Baru dan Editor Konten. AI Enhance tersedia mulai Pro."
                        : `Paket kamu membuka semua template dan AI Enhance (${storefrontTemplateFeatures.aiLimit}x/bulan).`}
                  </p>
                </div>

                <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand-ink shadow-sm">
                  {String(storefrontTemplateFeatures.tier).toUpperCase()}
                </span>
              </div>
            </div>


            {(() => {
              const activeRenderer = shop.storefront_renderer || "legacy";
              const isTemplateActive = activeRenderer === "template";
              const activeSlug = shop.slug || shop.shop_slug || shop.store_slug || "";

              return (
                <div
                  className={`mt-4 rounded-2xl border p-4 ${
                    isTemplateActive
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                  data-testid="storefront-template-active-status"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                            isTemplateActive
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-white text-slate-700"
                          }`}
                          data-testid="storefront-template-active-badge"
                        >
                          {isTemplateActive ? "Template Baru Aktif" : "Legacy Aman Aktif"}
                        </span>

                        <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand-ink shadow-sm">
                          Website Publik
                        </span>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-brand-mute">
                        {isTemplateActive
                          ? "Website toko publik sedang memakai renderer Template Baru sesuai mode, style, konten, dan produk unggulan yang dipilih."
                          : "Website toko publik masih memakai tampilan Legacy Aman. Template Baru tetap bisa dicek lewat tombol preview sebelum dijadikan tampilan utama."}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {activeSlug && (
                        <a
                          href={`/toko/${activeSlug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-extrabold text-brand-ink hover:bg-brand-off"
                          data-testid="storefront-active-live-link"
                        >
                          Lihat Website Aktif
                        </a>
                      )}

                      {activeSlug && (
                        <a
                          href={`/toko/${activeSlug}?renderer=1`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-extrabold text-white shadow-sm hover:opacity-90"
                          data-testid="storefront-active-template-preview-link"
                        >
                          Preview Template Baru
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {(() => {
              const previewMode = shop.storefront_mode || "catalog";
              const previewStyle = shop.storefront_style || "classic";
              const previewRenderer = shop.storefront_renderer || "legacy";
              const previewTemplate = resolveStorefrontTemplate(previewMode, previewStyle);
              const previewTokens = previewTemplate.tokens || {};
              const previewSlug = shop.slug || shop.shop_slug || shop.store_slug || "";

              const modeLabel = {
                catalog: "Katalog Produk",
                food_menu: "Menu Makanan / Minuman",
                services: "Jasa & Layanan",
              }[previewMode] || "Katalog Produk";

              const styleLabel = {
                classic: "Classic",
                modern: "Modern",
                compact: "Compact",
                premium: "Premium",
                playful: "Playful",
              }[previewStyle] || "Classic";

              const rendererLabel =
                previewRenderer === "template" ? "Template Baru" : "Legacy Aman";

              const rendererDescription =
                previewRenderer === "template"
                  ? "Website toko akan memakai layout template baru sesuai mode dan style yang dipilih."
                  : "Website toko tetap memakai tampilan lama. Template baru bisa dicoba lewat tombol preview.";

              const previewHref = previewSlug ? `/toko/${previewSlug}?renderer=1` : "";

              return (
                <div
                  className="mt-4 overflow-hidden rounded-3xl border border-brand-line bg-white shadow-sm"
                  data-testid="storefront-template-preview-card"
                >
                  <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                          previewRenderer === "template"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-700"
                        }`}>
                          {rendererLabel}
                        </span>
                        <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold text-brand-ink">
                          {modeLabel}
                        </span>
                        <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold text-brand-ink">
                          {styleLabel}
                        </span>
                      </div>

                      <h4 className="mt-4 text-lg font-black text-brand-ink">
                        Preview Tampilan Website
                      </h4>

                      <p className="mt-2 text-sm leading-relaxed text-brand-mute">
                        {rendererDescription}
                      </p>

                      <div className="mt-4 rounded-2xl bg-brand-off p-4">
                        <p className="text-xs font-black uppercase tracking-wide text-brand-mute">
                          Template terpilih
                        </p>
                        <p className="mt-1 text-base font-black text-brand-ink">
                          {previewTemplate.label}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-brand-mute">
                          {previewTemplate.description}
                        </p>
                        {previewTemplate.mood && (
                          <p className="mt-2 text-xs font-bold text-brand-ink">
                            Nuansa: {previewTemplate.mood}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {previewHref ? (
                          <a
                            href={previewHref}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-extrabold text-white shadow-sm hover:opacity-90"
                            data-testid="storefront-template-preview-link"
                          >
                            Preview Template Baru
                          </a>
                        ) : (
                          <span className="inline-flex items-center justify-center rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-500">
                            Simpan toko dulu untuk preview
                          </span>
                        )}

                        {previewSlug && (
                          <a
                            href={`/toko/${previewSlug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-extrabold text-brand-ink hover:bg-brand-off"
                            data-testid="storefront-active-preview-link"
                          >
                            Lihat Toko Aktif
                          </a>
                        )}
                      </div>
                    </div>

                    <div
                      className="min-h-[260px] p-5"
                      style={{
                        background:
                          previewStyle === "premium"
                            ? "radial-gradient(circle at top, rgba(217,119,6,.28), transparent 42%), #0c0a09"
                            : previewStyle === "playful"
                              ? "linear-gradient(135deg, #fff7ed, #ffedd5, #fef3c7)"
                              : previewStyle === "modern"
                                ? "linear-gradient(135deg, #f8fafc, #e2e8f0)"
                                : previewTokens.background || "#fbf6ee",
                        color: previewTokens.ink || "#2e2418",
                      }}
                    >
                      <div
                        className="h-full rounded-3xl border p-4 shadow-sm"
                        style={{
                          background:
                            previewStyle === "premium"
                              ? "rgba(28,25,23,.92)"
                              : previewTokens.surface || "#ffffff",
                          borderColor: previewTokens.accent || "#6B4F2A",
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div
                              className="inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase"
                              style={{
                                background: `${previewTokens.accent || "#6B4F2A"}22`,
                                color: previewTokens.accent || "#6B4F2A",
                              }}
                            >
                              {modeLabel}
                            </div>
                            <div
                              className="mt-3 h-7 w-44 rounded-xl"
                              style={{
                                background: previewTokens.ink || "#2e2418",
                                opacity: previewStyle === "premium" ? 0.9 : 0.14,
                              }}
                            />
                            <div
                              className="mt-2 h-3 w-56 rounded-full"
                              style={{
                                background: previewTokens.muted || "#7c6b5a",
                                opacity: 0.25,
                              }}
                            />
                          </div>

                          <div
                            className="grid h-16 w-16 place-items-center rounded-2xl text-xl font-black"
                            style={{
                              background: `${previewTokens.accent || "#6B4F2A"}22`,
                              color: previewTokens.accent || "#6B4F2A",
                            }}
                          >
                            {previewMode === "food_menu"
                              ? "M"
                              : previewMode === "services"
                                ? "J"
                                : "P"}
                          </div>
                        </div>

                        <div className={`mt-5 grid gap-3 ${
                          previewMode === "food_menu" || previewStyle === "compact"
                            ? "grid-cols-1"
                            : "grid-cols-2"
                        }`}>
                          {[1, 2, 3].map((item) => (
                            <div
                              key={item}
                              className={`rounded-2xl border p-3 ${
                                previewMode === "food_menu" || previewStyle === "compact"
                                  ? "flex items-center gap-3"
                                  : ""
                              }`}
                              style={{
                                background:
                                  previewStyle === "premium"
                                    ? "rgba(12,10,9,.52)"
                                    : "#ffffff",
                                borderColor: `${previewTokens.accent || "#6B4F2A"}44`,
                              }}
                            >
                              <div
                                className={`rounded-xl ${
                                  previewMode === "food_menu" || previewStyle === "compact"
                                    ? "h-12 w-12 shrink-0"
                                    : "h-20 w-full"
                                }`}
                                style={{
                                  background: `${previewTokens.accent || "#6B4F2A"}26`,
                                }}
                              />
                              <div className="flex-1">
                                <div
                                  className="h-3 w-20 rounded-full"
                                  style={{
                                    background: previewTokens.ink || "#2e2418",
                                    opacity: previewStyle === "premium" ? 0.6 : 0.18,
                                  }}
                                />
                                <div
                                  className="mt-2 h-2 w-14 rounded-full"
                                  style={{
                                    background: previewTokens.accent || "#6B4F2A",
                                    opacity: 0.45,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>

                        <div
                          className="mt-5 h-10 w-full rounded-2xl"
                          style={{
                            background:
                              previewTemplate.ctaStyle === "gradient"
                                ? `linear-gradient(135deg, ${previewTokens.accent || "#6B4F2A"}, #facc15)`
                                : previewTokens.accent || "#6B4F2A",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}


            <div
              className="mt-4 rounded-3xl border border-brand-line bg-white p-5 shadow-sm"
              data-testid="storefront-template-mini-editor"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-black text-brand-ink">
                    Editor Konten Template
                  </h4>
                  <p className="mt-1 text-sm leading-relaxed text-brand-mute">
                    Atur teks utama untuk template baru. Kosongkan field jika ingin memakai teks otomatis dari sistem.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold text-brand-ink">
                    Opsional
                  </span>
                  <button
                    type="button"
                    onClick={enhanceStorefrontCopy}
                    disabled={enhancingStorefrontCopy || storefrontAiLocked}
                    className="inline-flex items-center justify-center rounded-full bg-brand px-3 py-1 text-xs font-extrabold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="storefront-ai-enhance-copy-btn"
                  >
                    {enhancingStorefrontCopy ? "AI menulis..." : storefrontAiLocked ? "AI Pro" : "AI Enhance"}
                  </button>

                  <button
                    type="button"
                    onClick={resetStorefrontTemplateContent}
                    disabled={storefrontEditorLocked}
                    className="inline-flex items-center justify-center rounded-full border border-brand-line bg-white px-3 py-1 text-xs font-extrabold text-brand-ink shadow-sm transition hover:bg-brand-off disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="storefront-reset-template-content-btn"
                  >
                    Reset Konten
                  </button>

                  <button
                    type="button"
                    onClick={autoGenerateStorefrontTemplateFromBusiness}
                    disabled={enhancingStorefrontCopy || storefrontAiLocked}
                    className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="storefront-auto-generate-template-btn"
                  >
                    {enhancingStorefrontCopy ? "Membuat..." : storefrontAiLocked ? "Auto Pro" : "Auto Generate"}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <span className="text-sm font-bold text-brand-ink">Judul Hero</span>
                  <input
                    value={shop.storefront_hero_title || ""}
                    onChange={(e) => update("storefront_hero_title", e.target.value)}
                    placeholder="Contoh: Fashion lokal Bandung untuk gaya harianmu"
                    maxLength={90}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    disabled={storefrontEditorLocked}
                    data-testid="storefront-hero-title-input"
                  />
                  <span className="mt-1 block text-xs text-brand-mute">
                    Akan menggantikan judul besar di bagian atas website toko.
                  </span>
                </label>

                <label className="block md:col-span-2">
                  <span className="text-sm font-bold text-brand-ink">Subtitle Hero</span>
                  <textarea
                    value={shop.storefront_hero_subtitle || ""}
                    onChange={(e) => update("storefront_hero_subtitle", e.target.value)}
                    placeholder="Contoh: Pilih produk favorit, cek harga, lalu order langsung lewat WhatsApp."
                    maxLength={220}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    disabled={storefrontEditorLocked}
                    data-testid="storefront-hero-subtitle-input"
                  />
                  <span className="mt-1 block text-xs text-brand-mute">
                    Deskripsi pendek di bawah judul hero.
                  </span>
                </label>

                <label className="block">
                  <span className="text-sm font-bold text-brand-ink">Teks Tombol CTA</span>
                  <input
                    value={shop.storefront_cta_label || ""}
                    onChange={(e) => update("storefront_cta_label", e.target.value)}
                    placeholder="Contoh: Chat & Order Sekarang"
                    maxLength={36}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    disabled={storefrontEditorLocked}
                    data-testid="storefront-cta-label-input"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-bold text-brand-ink">Judul Section Unggulan</span>
                  <input
                    value={shop.storefront_featured_title || ""}
                    onChange={(e) => update("storefront_featured_title", e.target.value)}
                    placeholder="Contoh: Produk Favorit Minggu Ini"
                    maxLength={60}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    disabled={storefrontEditorLocked}
                    data-testid="storefront-featured-title-input"
                  />
                </label>

                <label className="block md:col-span-2">
                  <span className="text-sm font-bold text-brand-ink">Judul Tentang Kami</span>
                  <input
                    value={shop.storefront_about_title || ""}
                    onChange={(e) => update("storefront_about_title", e.target.value)}
                    placeholder="Contoh: Cerita di balik Kain Kita Bandung"
                    maxLength={80}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    disabled={storefrontEditorLocked}
                    data-testid="storefront-about-title-input"
                  />
                </label>
              </div>


              <div
                className={`mt-5 rounded-2xl border p-4 ${
                  storefrontFeaturedLimit > 0
                    ? "border-brand-line bg-brand-off"
                    : "border-amber-200 bg-amber-50"
                }`}
                data-testid="storefront-featured-product-picker"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-brand-ink">
                      Produk/Menu/Layanan Unggulan
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-brand-mute">
                      Pilih item yang ingin ditonjolkan di section unggulan template. Jika kosong,
                      sistem akan memilih otomatis dari daftar produk.
                    </p>
                  </div>

                  <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand-ink shadow-sm">
                    {selectedFeaturedProductIds.length}/{storefrontFeaturedLimit || 0}
                  </span>
                </div>

                {storefrontFeaturedLimit <= 0 ? (
                  <div className="mt-3 rounded-xl bg-white/80 p-3 text-xs leading-relaxed text-amber-800">
                    Pilih produk unggulan tersedia mulai paket Starter.
                  </div>
                ) : storefrontPickerProducts.length ? (
                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    {storefrontPickerProducts.slice(0, 80).map((product) => {
                      const productId = getStorefrontProductId(product);
                      const checked = selectedFeaturedProductSet.has(productId);
                      const disabled =
                        storefrontTemplateLocked ||
                        (!checked && selectedFeaturedProductIds.length >= storefrontFeaturedLimit);
                      const productName = product.name || product.title || "Produk";
                      const price = Number(product.price || product.price_idr || 0);

                      return (
                        <label
                          key={productId || productName}
                          className={`flex items-start gap-3 rounded-xl border bg-white p-3 text-sm ${
                            checked
                              ? "border-brand text-brand-ink shadow-sm"
                              : "border-brand-line text-brand-ink"
                          } ${disabled ? "opacity-60" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleStorefrontFeaturedProduct(productId)}
                            className="mt-1 h-4 w-4"
                            data-testid="storefront-featured-product-checkbox"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-extrabold">
                              {productName}
                            </span>
                            <span className="mt-0.5 block text-xs text-brand-mute">
                              {product.category || product.product_category || "Tanpa kategori"}
                              {price > 0 ? ` · Rp ${price.toLocaleString("id-ID")}` : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-white p-3 text-xs leading-relaxed text-brand-mute">
                    Belum ada produk/menu/layanan yang bisa dipilih.
                  </div>
                )}
              </div>


              <div
                className={`mt-5 rounded-2xl border p-4 ${
                  storefrontPromoLocked
                    ? "border-amber-200 bg-amber-50"
                    : "border-brand-line bg-brand-off"
                }`}
                data-testid="storefront-promo-banner-editor"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-brand-ink">
                      Promo Banner
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-brand-mute">
                      Tampilkan banner promo sederhana di website template baru. Cocok untuk diskon,
                      paket menu, pre-order, campaign, atau penawaran jasa.
                    </p>
                  </div>

                  <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand-ink shadow-sm">
                    {storefrontPromoLocked ? "PRO" : "Aktif untuk paket kamu"}
                  </span>
                </div>

                {storefrontPromoLocked && (
                  <div className="mt-3 rounded-xl bg-white/80 p-3 text-xs leading-relaxed text-amber-800">
                    Promo Banner tersedia mulai paket Pro.
                  </div>
                )}

                <label className="mt-4 flex items-center gap-3 rounded-xl bg-white p-3 text-sm font-bold text-brand-ink">
                  <input
                    type="checkbox"
                    checked={Boolean(shop.storefront_show_promo)}
                    onChange={(e) => update("storefront_show_promo", e.target.checked)}
                    disabled={storefrontPromoLocked}
                    className="h-4 w-4"
                    data-testid="storefront-show-promo-toggle"
                  />
                  Tampilkan Promo Banner
                </label>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-bold text-brand-ink">Judul Promo</span>
                    <input
                      value={shop.storefront_promo_title || ""}
                      onChange={(e) => update("storefront_promo_title", e.target.value)}
                      disabled={storefrontPromoLocked}
                      placeholder="Contoh: Promo Minggu Ini"
                      maxLength={80}
                      className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                      data-testid="storefront-promo-title-input"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-bold text-brand-ink">Teks Tombol Promo</span>
                    <input
                      value={shop.storefront_promo_cta_label || ""}
                      onChange={(e) => update("storefront_promo_cta_label", e.target.value)}
                      disabled={storefrontPromoLocked}
                      placeholder="Contoh: Ambil Promo"
                      maxLength={36}
                      className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                      data-testid="storefront-promo-cta-input"
                    />
                  </label>

                  <label className="block md:col-span-2">
                    <span className="text-sm font-bold text-brand-ink">Deskripsi Promo</span>
                    <textarea
                      value={shop.storefront_promo_text || ""}
                      onChange={(e) => update("storefront_promo_text", e.target.value)}
                      disabled={storefrontPromoLocked}
                      placeholder="Contoh: Pesan paket menu minggu ini dan dapatkan bonus minuman."
                      maxLength={180}
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                      data-testid="storefront-promo-text-input"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-bold text-brand-ink">Slug Link Promo</span>
                    <input
                      value={shop.storefront_promo_slug || ""}
                      onChange={(e) =>
                        update(
                          "storefront_promo_slug",
                          String(e.target.value || "")
                            .toLowerCase()
                            .replace(/[^a-z0-9-]+/g, "-")
                            .replace(/-+/g, "-")
                            .slice(0, 48)
                        )
                      }
                      disabled={storefrontPromoLocked}
                      placeholder="Contoh: promo-minggu-ini"
                      maxLength={48}
                      className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                      data-testid="storefront-promo-slug-input"
                    />
                    <span className="mt-1 block text-xs text-brand-mute">
                      Dipakai untuk link campaign yang bisa dibagikan ke WhatsApp, Instagram, atau TikTok.
                    </span>
                  </label>

                  <div
                    className="block"
                    data-testid="storefront-campaign-share-link"
                  >
                    <span className="text-sm font-bold text-brand-ink">Link Share Promo</span>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        value={storefrontCampaignUrl}
                        readOnly
                        className="min-w-0 flex-1 rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                        data-testid="storefront-campaign-share-input"
                      />
                      <button
                        type="button"
                        onClick={copyStorefrontCampaignLink}
                        disabled={!storefrontCampaignUrl || storefrontPromoLocked}
                        className="inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid="storefront-campaign-copy-btn"
                      >
                        Salin Link
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl bg-brand-off p-4 text-xs leading-relaxed text-brand-mute">
                Tips: gunakan kata yang spesifik sesuai toko. Untuk makanan, bisa pakai “Menu favorit hari ini”.
                Untuk jasa, bisa pakai “Konsultasikan kebutuhanmu”.
              </div>
            </div>



            <div
              className="mt-4 rounded-3xl border border-brand-line bg-white p-4 shadow-sm sm:p-5"
              data-testid="storefront-whatsapp-template-editor"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-brand-ink">Template Pesan WhatsApp</p>
                  <p className="mt-1 text-xs leading-relaxed text-brand-mute">
                    Atur format pesan yang nanti dipakai saat pembeli lanjut ke WhatsApp. Variable akan diganti otomatis saat checkout.
                  </p>
                </div>
                <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold text-brand-ink">G1A Editor</span>
              </div>

              {storefrontTemplateLocked && (
                <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                  Template pesan WhatsApp dipakai di Template Baru. Aktifkan paket/template terlebih dahulu.
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {WHATSAPP_TEMPLATE_VARIABLES.map((variable) => (
                  <code
                    key={variable}
                    className="rounded-full border border-brand-line bg-brand-off px-2.5 py-1 text-[11px] font-extrabold text-brand-ink"
                  >
                    {variable}
                  </code>
                ))}
              </div>

              <div className="mt-4 grid gap-4">
                <label className="block">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-brand-ink">Template Checkout Cart</span>
                    <button
                      type="button"
                      onClick={() => update("storefront_whatsapp_checkout_template", DEFAULT_WHATSAPP_CHECKOUT_TEMPLATE)}
                      className="text-xs font-extrabold text-brand hover:underline"
                      data-testid="storefront-whatsapp-checkout-template-reset"
                    >
                      Reset default
                    </button>
                  </div>
                  <textarea
                    value={shop.storefront_whatsapp_checkout_template || DEFAULT_WHATSAPP_CHECKOUT_TEMPLATE}
                    onChange={(e) => update("storefront_whatsapp_checkout_template", e.target.value)}
                    disabled={storefrontTemplateLocked}
                    maxLength={1200}
                    rows={8}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 font-mono text-xs font-semibold leading-relaxed text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                    data-testid="storefront-whatsapp-checkout-template-input"
                  />

                <div data-preview-for="storefront_whatsapp_checkout_template" className="contents">
                  <LapakinWhatsAppTemplatePreview
                    title="Preview template checkout WhatsApp"
                    template={shop.storefront_whatsapp_checkout_template || ""}
                    overrides={{}}
                  />
                </div>

                  <p className="mt-1 text-xs text-brand-mute">
                    Cocok untuk cart checkout. Gunakan variable seperti {"{items}"}, {"{total}"}, dan {"{payment_instruction}"}.
                  </p>
                </label>

                <label className="block">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-brand-ink">Template Tanya Produk</span>
                    <button
                      type="button"
                      onClick={() => update("storefront_whatsapp_product_template", DEFAULT_WHATSAPP_PRODUCT_TEMPLATE)}
                      className="text-xs font-extrabold text-brand hover:underline"
                      data-testid="storefront-whatsapp-product-template-reset"
                    >
                      Reset default
                    </button>
                  </div>
                  <textarea
                    value={shop.storefront_whatsapp_product_template || DEFAULT_WHATSAPP_PRODUCT_TEMPLATE}
                    onChange={(e) => update("storefront_whatsapp_product_template", e.target.value)}
                    disabled={storefrontTemplateLocked}
                    maxLength={800}
                    rows={6}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 font-mono text-xs font-semibold leading-relaxed text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                    data-testid="storefront-whatsapp-product-template-input"
                  />

                <div data-preview-for="storefront_whatsapp_product_template" className="contents">
                  <LapakinWhatsAppTemplatePreview
                    title="Preview template tanya produk WhatsApp"
                    template={shop.storefront_whatsapp_product_template || ""}
                    overrides={{ items: "", total: "", notes: "Saya mau tanya stok dan varian produk ini.", payment_instruction: "" }}
                  />
                </div>

                  <p className="mt-1 text-xs text-brand-mute">
                    Dipakai nanti untuk tombol tanya produk atau CTA produk satuan.
                  </p>
                </label>
              </div>
            </div>


            <div
              className="mt-4 rounded-2xl border border-brand-line bg-white p-4"
              data-testid="storefront-location-map-editor"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-brand-ink">Lokasi Toko / Google Maps</p>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Lokasi sekarang dikelola dari Pengaturan Toko. Section web ini hanya untuk tampilan sementara dan akan dibersihkan setelah field baru stabil.
              </div>

                  <p className="mt-1 text-xs leading-relaxed text-brand-mute">
                    Tampilkan alamat, peta, dan tombol arahkan ke lokasi di website template. Untuk MVP, cukup paste link Google Maps atau isi alamat toko.
                  </p>
                </div>
                <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold text-brand-ink">MVP</span>
              </div>

        {(typeof isWebsiteSettings !== "undefined"
          ? isWebsiteSettings
          : (typeof settingsView !== "undefined" && settingsView === "website")) && (
          <details
            data-testid="storefront-testimonials-editor"
            className="rounded-2xl border border-brand-line bg-white p-4 sm:p-5 shadow-sm"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand-muted">Testimoni Pelanggan</p>
                  <h3 className="text-lg font-bold text-brand-dark">Tampilkan ulasan di website</h3>
                  <p className="text-sm text-brand-muted mt-1">
                    Klik untuk membuka editor testimoni. Maksimal 3 testimoni manual.
                  </p>
                </div>

                <span className="rounded-full border border-brand-line px-3 py-1.5 text-xs font-bold text-brand-dark bg-brand-soft">
                  Buka / tutup editor
                </span>
              </div>
            </summary>

            <div className="mt-4 space-y-4">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-brand-dark">
                <input
                  type="checkbox"
                  checked={!!shop.storefront_show_testimonials}
                  onChange={(e) => update("storefront_show_testimonials", e.target.checked)}
                  data-testid="storefront-show-testimonials-toggle"
                />
                Tampilkan testimoni di website
              </label>

              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, index) => {
                  const testimonials = Array.isArray(shop.storefront_testimonials)
                    ? shop.storefront_testimonials
                    : [];
                  const item = testimonials[index] || {};

                  const setTestimonial = (field, value) => {
                    const next = [...testimonials];
                    next[index] = {
                      ...(next[index] || {}),
                      [field]: value,
                    };
                    update("storefront_testimonials", next);
                  };

                  const clearTestimonial = () => {
                    const next = [...testimonials];
                    next[index] = {};
                    update("storefront_testimonials", next);
                  };

                  return (
                    <div
                      key={index}
                      className="rounded-xl border border-brand-line bg-brand-soft/40 p-3 space-y-3"
                      data-testid="storefront-testimonial-item"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <strong className="text-sm text-brand-dark">Testimoni {index + 1}</strong>
                        <button
                          type="button"
                          onClick={clearTestimonial}
                          className="text-xs font-semibold text-brand-muted hover:text-brand-dark"
                        >
                          Kosongkan
                        </button>
                      </div>

                      <div className="grid md:grid-cols-[1fr_140px] gap-3">
                        <label className="text-sm font-semibold text-brand-dark">
                          Nama pelanggan
                          <input
                            value={item.name || ""}
                            onChange={(e) => setTestimonial("name", e.target.value)}
                            placeholder="Contoh: Bu Rina"
                            className="mt-1 w-full rounded-xl border border-brand-line px-3 py-2"
                            data-testid="storefront-testimonial-name-input"
                          />
                        </label>

                        <label className="text-sm font-semibold text-brand-dark">
                          Rating
                          <select
                            value={item.rating || 5}
                            onChange={(e) => setTestimonial("rating", Number(e.target.value))}
                            className="mt-1 w-full rounded-xl border border-brand-line px-3 py-2"
                            data-testid="storefront-testimonial-rating-input"
                          >
                            <option value={5}>5 ★</option>
                            <option value={4}>4 ★</option>
                            <option value={3}>3 ★</option>
                            <option value={2}>2 ★</option>
                            <option value={1}>1 ★</option>
                          </select>
                        </label>
                      </div>

                      <label className="text-sm font-semibold text-brand-dark block">
                        Komentar
                        <textarea
                          value={item.text || ""}
                          onChange={(e) => setTestimonial("text", e.target.value)}
                          placeholder="Contoh: Menunya enak, cepat sampai, dan owner responsif."
                          rows={3}
                          className="mt-1 w-full rounded-xl border border-brand-line px-3 py-2"
                          data-testid="storefront-testimonial-text-input"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
        )}


              <label className="mt-4 flex items-center gap-3 rounded-xl bg-brand-off p-3 text-sm font-bold text-brand-ink">
                <input
                  type="checkbox"
                  checked={Boolean(shop.storefront_show_location_map)}
                  onChange={(e) => update("storefront_show_location_map", e.target.checked)}
                  className="h-4 w-4"
                  data-testid="storefront-show-location-map-toggle"
                />
                Tampilkan lokasi dan peta di website
              </label>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold text-brand-ink">Judul Section</span>
                  <input
                    value={shop.storefront_location_title || ""}
                    onChange={(e) => update("storefront_location_title", e.target.value)}
                    placeholder="Contoh: Lokasi Warung Bu Sari"
                    maxLength={80}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    data-testid="storefront-location-title-input"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-bold text-brand-ink">Link Google Maps</span>
                  <input
                    value={shop.storefront_google_maps_url || ""}
                    onChange={(e) => update("storefront_google_maps_url", e.target.value)}
                    placeholder="https://maps.app.goo.gl/... atau https://www.google.com/maps/..."
                    maxLength={1000}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    data-testid="storefront-google-maps-url-input"
                  />
                </label>

                <label className="block md:col-span-2">
                  <span className="text-sm font-bold text-brand-ink">Alamat yang Ditampilkan</span>
                  <textarea
                    value={shop.storefront_location_address || shop.address || ""}
                    onChange={(e) => update("storefront_location_address", e.target.value)}
                    placeholder="Contoh: Jl. Melati No. 10, Cibubur, Jakarta Timur"
                    maxLength={300}
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    data-testid="storefront-location-address-input"
                  />
                  <span className="mt-1 block text-xs text-brand-mute">
                    Kalau embed URL kosong, peta akan dibuat otomatis dari alamat ini.
                  </span>
                </label>

                <label className="block md:col-span-2">
                  <span className="text-sm font-bold text-brand-ink">Embed URL Google Maps opsional</span>
                  <input
                    value={shop.storefront_location_embed_url || ""}
                    onChange={(e) => update("storefront_location_embed_url", e.target.value)}
                    placeholder="https://www.google.com/maps/embed?..."
                    maxLength={1000}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                    data-testid="storefront-location-embed-url-input"
                  />
                  <span className="mt-1 block text-xs text-brand-mute">
                    Opsional. Pakai jika kamu mengambil kode embed dari Google Maps. Jika kosong, sistem pakai alamat toko.
                  </span>
                </label>
              </div>

              {(shop.storefront_show_location_map && (shop.storefront_location_address || shop.address || shop.storefront_google_maps_url || shop.storefront_location_embed_url)) ? (
                <div className="mt-4 rounded-2xl border border-brand-line bg-brand-off p-4 text-sm text-brand-mute" data-testid="storefront-location-map-preview">
                  <b className="text-brand-ink">Preview Lokasi:</b> {shop.storefront_location_title || shop.name || "Lokasi Toko"}<br />
                  {(shop.storefront_location_address || shop.address) ? <span>{shop.storefront_location_address || shop.address}</span> : <span>Alamat belum diisi.</span>}
                  {shop.storefront_google_maps_url ? (
                    <a href={shop.storefront_google_maps_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex font-extrabold text-brand hover:underline">
                      Buka Google Maps
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                { mode: "catalog", title: "Katalog", desc: "Untuk produk fisik dan toko umum." },
                { mode: "food_menu", title: "Menu", desc: "Untuk makanan, minuman, dan menu harian." },
                { mode: "services", title: "Jasa", desc: "Untuk layanan, booking, dan konsultasi." },
              ].map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => update("storefront_mode", item.mode)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    (shop.storefront_mode || "catalog") === item.mode
                      ? "border-brand bg-brand text-white shadow-sm"
                      : "border-brand-line bg-white hover:bg-brand-off"
                  }`}
                  data-testid={`storefront-mode-card-${item.mode}`}
                >
                  <div className="text-sm font-extrabold">{item.title}</div>
                  <div className={`mt-1 text-xs leading-relaxed ${
                    (shop.storefront_mode || "catalog") === item.mode ? "text-white/85" : "text-brand-mute"
                  }`}>
                    {item.desc}
                  </div>
                </button>
              ))}
            </div>
          </Section>
        


          {/* LAPAKIN_GROWTH_SPRINT_V2_SETTINGS_CARDS */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Analytics Website" desc="Ringkasan 30 hari terakhir dari website dan campaign promo.">
              <div data-testid="storefront-analytics-card" className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Kunjungan website", storefrontAnalytics?.totals?.page_view],
                    ["Klik promo", storefrontAnalytics?.totals?.promo_cta_click],
                    ["Klik WhatsApp/order", storefrontAnalytics?.totals?.whatsapp_checkout_click],
                    ["Leads masuk", storefrontAnalytics?.totals?.lead_created],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-brand-line bg-white p-4">
                      <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">{label}</div>
                      <div className="mt-1 text-2xl font-extrabold text-brand-ink">{formatGrowthNumber(value)}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl bg-brand-off p-4 text-sm text-brand-mute">
                  Campaign aktif: <b className="text-brand-ink">{storefrontAnalytics?.campaign_slug || shop.storefront_promo_slug || "Belum ada"}</b><br />
                  Produk paling sering diklik: <b className="text-brand-ink">{storefrontAnalytics?.top_products?.[0]?.name || "Belum ada data"}</b>
                </div>
                {storefrontGrowthError && <div className="rounded-xl bg-yellow-50 p-3 text-sm font-semibold text-yellow-800">{storefrontGrowthError}</div>}
              </div>
            </Section>
            <Section title="Lead Terbaru" desc="Calon pembeli yang lanjut ke WhatsApp lewat website.">

              <StorefrontSeoEditor shop={shop} setShop={setShop} />

              <div data-testid="storefront-leads-card" className="space-y-3">
                {storefrontLeads.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-brand-line bg-white p-4 text-sm text-brand-mute">Belum ada lead dari website.</div>
                ) : (
                  storefrontLeads.map((lead) => (
                    <div key={lead.lead_id || lead.created_at} className="rounded-2xl border border-brand-line bg-white p-4">
                      <div className="font-extrabold text-brand-ink">{lead.customer_name || "Tanpa nama"}{lead.customer_phone ? <span className="ml-2 text-sm font-semibold text-brand-mute">{lead.customer_phone}</span> : null}</div>
                      <div className="mt-1 text-xs leading-relaxed text-brand-mute">Total: {formatGrowthCurrency(lead.total)} · Campaign: {lead.campaign_slug || "-"} · {formatGrowthDate(lead.created_at)}</div>
                      {lead.notes ? <div className="mt-2 text-sm text-brand-mute">Catatan: {lead.notes}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </Section>
          </div>
          {/* /LAPAKIN_GROWTH_SPRINT_V2_SETTINGS_CARDS */}

          <div className="sticky bottom-4 z-20 mt-6 rounded-2xl border border-brand-line bg-white/95 p-4 shadow-xl backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-relaxed text-brand-mute">
                Setelah mengubah tampilan website, klik simpan agar perubahan tampil di website publik.
              </p>


              <Button
                type="button"
                onClick={save}
                disabled={saving}
                className="w-full sm:w-auto"

                data-testid="website-settings-save-btn"
              >
                {saving ? "Menyimpan..." : "Simpan Semua Perubahan"}
              </Button>
            </div>
          </div>
</div>
      </DashboardLayout>
    );
  }

return (
    <DashboardLayout shop={shop} title="Pengaturan Toko" subtitle="Lengkapi profil toko biar pelanggan makin percaya."
      actions={
        <Button onClick={() => navigate("/dashboard/qr")}
          variant="outline"
          className="rounded-xl border-brand-line"
          data-testid="settings-qr-btn">
          <QrCode className="w-4 h-4 mr-2" /> QR Lapak Saya
        </Button>
      }>
        <div className="mx-auto max-w-6xl space-y-6 pb-36" data-testid="settings-page-stack">


          {/* IDENTITY */}
          <Section
            title="Identitas Toko"
            eyebrow="Profil dasar"
            badge="Tampil di website"
            desc="Info dasar yang tampil di header website, SEO/meta, dan kartu share toko."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Nama Toko</Label>
                <Input value={shop.name} onChange={(e) => update("name", e.target.value)}
                  className="mt-2 h-12 rounded-xl border-brand-line bg-white" data-testid="settings-name" />
              </div>
              <div>
                <Label>Tagline</Label>
                <Input value={shop.tagline || ""} onChange={(e) => update("tagline", e.target.value)}
                  className="mt-2 h-12 rounded-xl border-brand-line bg-white" data-testid="settings-tagline" />
              </div>
              <div>
                <Label>Deskripsi Singkat</Label>
                <Textarea rows={2} value={shop.description || ""} onChange={(e) => update("description", e.target.value)}
                  className="mt-1 rounded-xl border-brand-line" data-testid="settings-description" />
              </div>
              <div>
                <Label>Jenis Bisnis</Label>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {BUSINESS_TYPES.map((b) => (
                    <button key={b.id} type="button" onClick={() => update("business_type", b.id)}
                      className={`min-h-[52px] rounded-2xl border px-4 py-3 text-sm font-extrabold transition ${shop.business_type === b.id ? "border-brand bg-brand text-white shadow-sm" : "border-brand-line bg-white text-brand-ink hover:-translate-y-0.5 hover:border-brand hover:shadow-sm"}`}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <section
            id="order-contact"
            data-section="order-contact"
            data-testid="shop-settings-order-payment-location"
            className="space-y-5 rounded-[2rem] border border-brand-line bg-white p-5 shadow-card sm:p-6"
          >
            <div className="rounded-3xl border border-brand-line bg-gradient-to-br from-brand-off via-white to-brand-soft/30 p-4 sm:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-mute">Pengaturan Toko</p>
                  <h2 className="font-heading text-xl font-extrabold text-brand-ink">Order, Pembayaran & Lokasi</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-brand-mute">
                    Lengkapi cara pelanggan order, bayar, ambil barang, dan menemukan toko. Data ini dipakai storefront, Website Readiness, dan Lapakin Asisten.
                  </p>
                </div>
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand-ink shadow-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 text-brand" />
                  Basic readiness
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm">
                  <p className="text-[11px] font-black uppercase tracking-wide text-brand-mute">Kontak order</p>
                  <p className="mt-1 text-sm font-extrabold text-brand-ink">
                    {shop?.whatsapp || shop?.whatsapp_number ? "WhatsApp siap" : "Isi nomor WA"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm">
                  <p className="text-[11px] font-black uppercase tracking-wide text-brand-mute">Metode jualan</p>
                  <p className="mt-1 text-sm font-extrabold text-brand-ink">
                    {shop?.pickup_available || shop?.delivery_available ? "Pickup/delivery aktif" : "Atur pickup/delivery"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm">
                  <p className="text-[11px] font-black uppercase tracking-wide text-brand-mute">Lokasi</p>
                  <p className="mt-1 text-sm font-extrabold text-brand-ink">
                    {shop?.has_offline_store || shop?.show_location ? "Toko offline aktif" : "Online-only boleh"}
                  </p>
                </div>
              </div>
            </div>

            <div id="contact" data-section="contact" className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <label className="text-sm font-extrabold text-brand-ink">Nomor WhatsApp toko</label>
                  <p className="mt-1 text-xs leading-relaxed text-brand-mute">
                    Nomor utama yang dipakai pelanggan untuk order dari storefront dan tombol checkout.
                  </p>
                  <input
                    className="mt-3 w-full rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm font-semibold text-brand-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft/70"
                    value={shop?.whatsapp || shop?.whatsapp_number || ""}
                    onChange={(event) => updateShopField("whatsapp", event.target.value)}
                    placeholder="62812xxxxxxx"
                  />
                </div>
              </div>
            </div>

            <div id="order" data-section="order" className="grid gap-4 md:grid-cols-3">
              <ToggleCard
                icon={MessageCircle}
                title="Order via WhatsApp"
                desc="Checkout diarahkan ke chat WA toko."
                checked={Boolean(shop?.order_whatsapp_enabled ?? true)}
                onChange={(event) => updateShopCheckbox("order_whatsapp_enabled", event)}
              />
              <ToggleCard
                icon={Store}
                title="Pickup tersedia"
                desc="Pelanggan bisa ambil pesanan di toko."
                checked={Boolean(shop?.pickup_available)}
                onChange={(event) => updateShopCheckbox("pickup_available", event)}
              />
              <ToggleCard
                icon={Truck}
                title="Delivery tersedia"
                desc="Toko melayani pengantaran pesanan."
                checked={Boolean(shop?.delivery_available)}
                onChange={(event) => updateShopCheckbox("delivery_available", event)}
              />
            </div>

            <div id="payment" data-section="payment" className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm sm:p-5">
              <label className="text-sm font-extrabold text-brand-ink">Instruksi pembayaran</label>
              <p className="mt-1 text-xs text-brand-mute">Contoh: QRIS tersedia, transfer BCA, COD, atau bayar di tempat.</p>
              <textarea
                className="mt-3 min-h-[100px] w-full rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm font-semibold text-brand-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft/70"
                value={shop?.payment_instruction || shop?.storefront_payment_instruction || shop?.payment_notes || ""}
                onChange={(event) => {
                    updateShopField("payment_instruction", event.target.value);
                    updateShopField("storefront_payment_instruction", event.target.value);
                  }}
                placeholder="Contoh: Bisa QRIS dan transfer. QRIS dikirim setelah pesanan dikonfirmasi."
              />
            </div>


            <div
              className="mt-4 rounded-2xl border border-brand-line bg-white p-4"

              data-testid="storefront-payment-instruction-editor"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-off text-brand">
                    <WalletCards className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-brand-ink">QRIS & Checkout Manual</p>
                    <p className="mt-1 text-xs leading-relaxed text-brand-mute">
                      Atur QRIS, label metode pembayaran, dan teks konfirmasi checkout. Instruksi pembayaran utama memakai field di atas.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold text-brand-ink">Tanpa Gateway</span>
              </div>

              {storefrontTemplateLocked && (
                <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                  Instruksi pembayaran tampil di Template Baru. Aktifkan paket/template terlebih dahulu.
                </div>
              )}

              <div className="mt-4">
                <ToggleCard
                  icon={WalletCards}
                  title="Tampilkan instruksi pembayaran di checkout"
                  desc="Aktifkan jika pelanggan perlu melihat instruksi bayar sebelum lanjut WhatsApp."
                  checked={Boolean(shop.storefront_show_payment_instruction)}
                  onChange={(e) => update("storefront_show_payment_instruction", e.target.checked)}
                  disabled={storefrontTemplateLocked}
                  data-testid="storefront-show-payment-instruction-toggle"
                />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold text-brand-ink">Label Metode Pembayaran</span>
                  <input
                    value={shop.storefront_payment_method_label || ""}
                    onChange={(e) => update("storefront_payment_method_label", e.target.value)}
                    disabled={storefrontTemplateLocked}
                    placeholder="Contoh: QRIS Warung Bu Sari"
                    maxLength={80}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                    data-testid="storefront-payment-method-label-input"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-bold text-brand-ink">Upload Gambar QRIS</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onStorefrontQrisFile}
                    disabled={storefrontTemplateLocked}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                    data-testid="storefront-qris-image-input"
                  />
                </label>


                <label className="block md:col-span-2">
                  <span className="text-sm font-bold text-brand-ink">Teks Konfirmasi WhatsApp</span>
                  <input
                    value={shop.storefront_payment_confirmation_text || ""}
                    onChange={(e) => update("storefront_payment_confirmation_text", e.target.value)}
                    disabled={storefrontTemplateLocked}
                    placeholder="Contoh: Saya akan kirim bukti pembayaran via WhatsApp."
                    maxLength={160}
                    className="mt-2 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink disabled:bg-gray-100 disabled:text-gray-500"
                    data-testid="storefront-payment-confirmation-text-input"
                  />
                </label>

                {shop.storefront_qris_image ? (
                  <div className="md:col-span-2 rounded-2xl border border-brand-line bg-brand-off p-4" data-testid="storefront-qris-image-preview">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <img src={shop.storefront_qris_image} alt="Preview QRIS" className="h-40 w-40 rounded-xl border border-brand-line bg-white object-contain p-2" />
                      <div className="flex-1 text-sm text-brand-mute">
                        <p className="font-bold text-brand-ink">Preview QRIS</p>
                        <p className="mt-1">Gambar ini akan tampil di drawer checkout website template.</p>
                        <button
                          type="button"
                          onClick={() => update("storefront_qris_image", "")}
                          className="mt-3 rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-extrabold text-brand-ink"
                          data-testid="storefront-qris-clear-btn"
                        >
                          Hapus QRIS
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div id="location" data-section="location" className="space-y-4 rounded-3xl border border-brand-line bg-white p-4 shadow-sm sm:p-5">
              <ToggleCard
                icon={MapPin}
                title="Saya punya toko offline / lokasi pickup"
                desc="Aktifkan jika pelanggan boleh datang ke toko, ambil pesanan, atau butuh link Google Maps."
                checked={Boolean(shop?.has_offline_store || shop?.show_location)}
                onChange={(event) => updateShopCheckbox("has_offline_store", event)}
              />
              <p className="rounded-2xl bg-brand-off px-4 py-3 text-xs leading-relaxed text-brand-mute">
                Alamat dan Google Maps tetap optional. Jika toko online-only, bagian ini boleh dikosongkan dan tidak akan jadi syarat wajib.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-extrabold text-brand-ink">Link Google Maps</label>
                  <input
                    className="mt-2 w-full rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm outline-none focus:border-brand"
                    value={shop?.google_maps_url || shop?.google_maps_link || ""}
                    onChange={(event) => updateShopField("google_maps_url", event.target.value)}
                    placeholder="https://maps.app.goo.gl/..."
                  />
                </div>
                <div>
                  <label className="text-sm font-extrabold text-brand-ink">Area layanan</label>
                  <input
                    className="mt-2 w-full rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm outline-none focus:border-brand"
                    value={shop?.service_area || ""}
                    onChange={(event) => updateShopField("service_area", event.target.value)}
                    placeholder="Contoh: Yogyakarta kota, sekitar kampus, Jabodetabek"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-extrabold text-brand-ink">Alamat yang ditampilkan</label>
                <textarea
                  className="mt-2 min-h-[90px] w-full rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm outline-none focus:border-brand"
                  value={shop?.store_address || shop?.address || shop?.location_address || ""}
                  onChange={(event) => updateShopField("store_address", event.target.value)}
                  placeholder="Alamat toko / lokasi pickup jika ada"
                />
              </div>
            </div>
          </section>

          <Section title="Social Media" desc="Tambahkan akun sosial media dan link marketplace toko.">
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold text-brand-ink">Instagram</Label>
                <Input
                  value={shop.instagram || ""}
                  onChange={(e) => update("instagram", e.target.value)}
                  placeholder="@warungbusari"
                  className="mt-2 h-12 rounded-xl border-brand-line bg-white"
                  data-testid="settings-instagram"
                />
              </div>

              <div>
                <Label className="text-sm font-semibold text-brand-ink">TikTok</Label>
                <Input
                  value={shop.tiktok || ""}
                  onChange={(e) => update("tiktok", e.target.value)}
                  placeholder="@namatoko"
                  className="mt-2 h-12 rounded-xl border-brand-line bg-white"
                  data-testid="settings-tiktok"
                />
              </div>

              <div>
                <Label>Shopee URL</Label>
                <Input
                  value={shop.shopee_url || ""}
                  onChange={(e) => update("shopee_url", e.target.value)}
                  placeholder="https://shopee.co.id/..."
                  className="mt-2 h-12 rounded-xl border-brand-line bg-white"
                  data-testid="settings-shopee"
                />
              </div>
            </div>
          </Section>


      <div className="space-y-6">
        {/* Main */}
        <div className="space-y-6">
          {/* MODE TOKO — Iteration 7 */}
          <Section title="Mode Jualan" desc="Pilih cara tokomu jualan. Sistem akan menyesuaikan tampilan stok & status buka.">
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { id: "stock",  emoji: "📦", title: "Stok",        desc: "Pakai jumlah stok per produk. Cocok fashion, kerajinan, aksesoris." },
                { id: "hours",  emoji: "🍜", title: "Jam Buka",    desc: "Tidak pakai stok. Toko bisa BUKA/TUTUP. Cocok kuliner, kopi, warteg." },
                { id: "always", emoji: "♾️", title: "Selalu Ada",  desc: "Tidak pakai stok & jam buka. Cocok jasa, digital, pre-order." },
              ].map((m) => (
                <button key={m.id} type="button"
                  onClick={() => update("sells_by", m.id)}
                  className={`text-left p-4 rounded-xl border-2 transition ${
                    (shop.sells_by || "stock") === m.id
                      ? "bg-brand text-white border-brand"
                      : "bg-white border-brand-line hover:border-brand"
                  }`}
                  data-testid={`mode-${m.id}`}>
                  <div className="text-2xl">{m.emoji}</div>
                  <div className="font-bold mt-1">{m.title}</div>
                  <div className={`text-xs mt-1 leading-snug ${(shop.sells_by || "stock") === m.id ? "text-white/85" : "text-brand-mute"}`}>{m.desc}</div>
                </button>
              ))}
            </div>
            {(shop.sells_by || "stock") === "hours" && (
              <>
                <div className="mt-4 p-4 rounded-xl bg-brand-off border border-brand-line">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        Status Toko Sekarang:{" "}
                        <span className={shop.is_open !== false ? "text-green-700" : "text-red-700"}>
                          {shop.is_open !== false ? "BUKA" : "TUTUP"}
                        </span>
                      </div>
                      <div className="text-xs text-brand-mute mt-0.5">
                        {shop.auto_schedule_enabled
                          ? "Jadwal otomatis tetap aktif. Owner/staff tetap bisa tutup toko sementara saat jadwal sedang buka."
                          : "Toggle ini juga ada di Beranda untuk akses cepat."}
                      </div>
                    </div>
                    <button type="button"
                      onClick={async () => {
                        const nextOpen = !(shop.is_open !== false);
                        try {
                          const { data } = await api.patch("/shops/me/open-status", { is_open: nextOpen });
                          setShop((prev) => ({ ...prev, ...data }));
                          toast.success(nextOpen ? "Toko dibuka kembali" : "Toko ditutup sementara");
                        } catch (e) {
                          toast.error(formatApiError(e.response?.data?.detail) || "Gagal mengubah status toko");
                        }
                      }}
                      className={`px-4 py-2 rounded-xl font-bold text-sm ${shop.is_open !== false ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}`}
                      data-testid="settings-toggle-open">
                      {shop.is_open !== false ? "Tutup Toko" : "Buka Toko"}
                    </button>
                  </div>
                </div>

                {/* AUTO-SCHEDULE EDITOR */}
                <div className="mt-4 p-4 rounded-xl bg-white border border-brand-line" data-testid="schedule-editor">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1 w-4 h-4 accent-brand"
                      checked={!!shop.auto_schedule_enabled}
                      onChange={(e) => update("auto_schedule_enabled", e.target.checked)}
                      data-testid="auto-schedule-toggle" />
                    <div>
                      <div className="font-semibold">Auto Buka/Tutup Sesuai Jadwal ⏰</div>
                      <div className="text-xs text-brand-mute mt-0.5">
                        Toko otomatis BUKA dan TUTUP berdasarkan jadwal di bawah (zona waktu WIB / Jakarta).
                      </div>
                    </div>
                  </label>

                  <div className={`mt-4 space-y-2 ${shop.auto_schedule_enabled ? "" : "opacity-50 pointer-events-none"}`}>
                    {[
                      { idx: 0, label: "Senin" },
                      { idx: 1, label: "Selasa" },
                      { idx: 2, label: "Rabu" },
                      { idx: 3, label: "Kamis" },
                      { idx: 4, label: "Jumat" },
                      { idx: 5, label: "Sabtu" },
                      { idx: 6, label: "Minggu" },
                    ].map((day) => {
                      const entry = (shop.schedule || [])[day.idx];
                      // Normalize to shifts array (legacy {open,close} → 1-shift)
                      const shifts = (() => {
                        if (!entry) return [];
                        if (Array.isArray(entry.shifts) && entry.shifts.length) return entry.shifts;
                        if (entry.open && entry.close) return [{ open: entry.open, close: entry.close }];
                        return [];
                      })();
                      const isOpenDay = shifts.length > 0;
                      const writeShifts = (next) => {
                        const arr = [...(shop.schedule || [])];
                        while (arr.length < 7) arr.push(null);
                        if (!next || next.length === 0) {
                          arr[day.idx] = null;
                        } else if (next.length === 1) {
                          // Keep legacy single-shift format for backward compat
                          arr[day.idx] = { open: next[0].open, close: next[0].close };
                        } else {
                          arr[day.idx] = { shifts: next };
                        }
                        update("schedule", arr);
                      };
                      const setShift = (i, key, val) => {
                        const next = [...shifts];
                        next[i] = { ...next[i], [key]: val };
                        writeShifts(next);
                      };
                      const addShift = () => writeShifts([...shifts, { open: "17:00", close: "21:00" }]);
                      const removeShift = (i) => writeShifts(shifts.filter((_, idx) => idx !== i));

                      return (
                        <div key={day.idx} className="rounded-lg border border-brand-line bg-white/60 p-2.5" data-testid={`schedule-row-${day.idx}`}>
                          <div className="flex items-center gap-2 sm:gap-3">
                            <div className="w-20 sm:w-24 font-semibold text-sm">{day.label}</div>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input type="checkbox" className="w-3.5 h-3.5 accent-brand"
                                checked={isOpenDay}
                                onChange={(e) => writeShifts(e.target.checked ? [{ open: "08:00", close: "21:00" }] : [])}
                                data-testid={`schedule-open-${day.idx}`} />
                              Buka
                            </label>
                            {!isOpenDay && <span className="text-xs text-brand-mute italic">Libur</span>}
                          </div>
                          {isOpenDay && (
                            <div className="mt-2 ml-22 sm:ml-26 space-y-1.5">
                              {shifts.map((sh, i) => (
                                <div key={i} className="flex items-center gap-2 flex-wrap" data-testid={`schedule-shift-${day.idx}-${i}`}>
                                  <span className="text-[10px] uppercase tracking-wider font-bold text-brand-mute w-12">
                                    {shifts.length > 1 ? (i === 0 ? "Shift 1" : `Shift ${i + 1}`) : "Jam"}
                                  </span>
                                  <input type="time"
                                    value={sh.open || ""}
                                    onChange={(e) => setShift(i, "open", e.target.value)}
                                    className="rounded-lg border border-brand-line h-9 px-2 text-sm bg-white"
                                    data-testid={`schedule-open-time-${day.idx}${i > 0 ? `-${i}` : ""}`} />
                                  <span className="text-brand-mute text-sm">–</span>
                                  <input type="time"
                                    value={sh.close || ""}
                                    onChange={(e) => setShift(i, "close", e.target.value)}
                                    className="rounded-lg border border-brand-line h-9 px-2 text-sm bg-white"
                                    data-testid={`schedule-close-time-${day.idx}${i > 0 ? `-${i}` : ""}`} />
                                  {shifts.length > 1 && (
                                    <button type="button" onClick={() => removeShift(i)}
                                      className="text-xs text-red-500 hover:text-red-700 font-semibold"
                                      data-testid={`schedule-remove-shift-${day.idx}-${i}`}>
                                      Hapus
                                    </button>
                                  )}
                                </div>
                              ))}
                              {shifts.length < 2 && (
                                <button type="button" onClick={addShift}
                                  className="text-xs text-brand font-semibold hover:underline ml-14"
                                  data-testid={`schedule-add-shift-${day.idx}`}>
                                  + Tambah shift kedua (mis. dinner)
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* PRE-ORDER CUTOFF */}
                  <div className="mt-5 pt-4 border-t border-brand-line">
                    <label className="block">
                      <div className="font-semibold text-sm">⏱️ Last Order Sebelum Tutup</div>
                      <div className="text-xs text-brand-mute mt-0.5 mb-2">
                        Stop terima order N menit sebelum jam tutup. Contoh: tutup 21:00, last order 30 menit = stop pesanan jam 20:30.
                        Berguna biar dapur sempat siap-siap.
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {[0, 15, 30, 45, 60].map((m) => (
                          <button key={m} type="button"
                            onClick={() => update("last_order_minutes_before_close", m)}
                            className={`rounded-lg px-3 h-9 text-sm font-semibold border transition ${
                              (shop.last_order_minutes_before_close || 0) === m
                                ? "bg-brand text-white border-brand"
                                : "bg-white text-brand-ink border-brand-line hover:bg-brand-sand"
                            }`}
                            data-testid={`last-order-cutoff-${m}`}>
                            {m === 0 ? "Tidak" : `${m} mnt`}
                          </button>
                        ))}
                      </div>
                    </label>
                  </div>
                </div>
              </>
            )}
          </Section>

          {/* COVER BANNER */}
          <Section title="Cover Banner" desc="Foto besar di puncak toko (16:6). Upload sendiri atau biarkan AI bikin.">
            <div className="aspect-[16/6] rounded-xl bg-brand-off border border-brand-line overflow-hidden relative">
              {shop.cover_image ? (
                <>
                  <img src={shop.cover_image} alt="cover" className="w-full h-full object-cover" data-testid="cover-preview" />
                  <button onClick={() => update("cover_image", "")}
                    className="absolute top-2 right-2 bg-white/90 rounded-full p-1.5 hover:bg-white"
                    data-testid="cover-remove-btn">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <div className="w-full h-full grid place-items-center text-brand-mute">
                  Belum ada cover
                </div>
              )}
            </div>
            <div className="mt-3">
              <Label className="text-xs">Gaya Cover AI</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {COVER_STYLES.map((s) => (
                  <button key={s.id} type="button" onClick={() => setCoverStyle(s.id)}
                    className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${coverStyle === s.id ? "bg-brand text-white border-brand" : "bg-white border-brand-line"}`}
                    data-testid={`cover-style-${s.id}`}>{s.label}</button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Button onClick={generateCover} disabled={generatingCover}
                className="bg-brand hover:bg-brand-hover text-white rounded-xl btn-press"
                data-testid="cover-generate-btn">
                {generatingCover ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> AI bikin cover…</> : <><Wand2 className="w-4 h-4 mr-2" /> Generate Cover dengan AI</>}
              </Button>
              <label className="rounded-xl border border-brand-line bg-white px-4 py-2 cursor-pointer text-sm font-semibold flex items-center gap-2 hover:bg-brand-off">
                <Upload className="w-4 h-4" /> Upload Sendiri
                <input type="file" accept="image/*" className="hidden" onChange={onCoverFile} data-testid="cover-upload-input" />
              </label>
            </div>
          </Section>


          {/* ABOUT US */}
          <Section title="Tentang Kami" desc="Cerita singkat tentang toko. Klik AI biar dibuatkan otomatis.">
            <Textarea rows={5} value={shop.about || ""} onChange={(e) => update("about", e.target.value)}
              placeholder="Cerita toko kamu… atau klik 'AI Tulis Cerita' di bawah."
              className="rounded-xl border-brand-line" data-testid="settings-about" />
            <Button onClick={generateAbout} disabled={generatingAbout || !shop.name}
              variant="outline"
              className="mt-3 rounded-xl border-brand bg-brand-off text-brand hover:bg-brand hover:text-white btn-press"
              data-testid="about-generate-btn">
              {generatingAbout ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> AI menulis…</> : <><Wand2 className="w-4 h-4 mr-2" /> AI Tulis Cerita</>}
            </Button>
          </Section>

          {/* SHOP STORY REEL */}
          <Section title="Shop Story Reel" desc="3-5 foto behind-the-scenes (proses, suasana, kru). Tampil seperti IG Stories di toko.">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {(shop.story || []).map((s, i) => (
                <div key={i} className="space-y-2" data-testid={`story-item-${i}`}>
                  <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-brand-line">
                    <img src={s.image} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => removeStory(i)}
                      className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1"
                      data-testid={`story-remove-${i}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <Input value={s.caption} onChange={(e) => setStoryCaption(i, e.target.value)}
                    placeholder="Caption…" maxLength={60}
                    className="rounded-lg border-brand-line h-8 text-xs" />
                </div>
              ))}
              {(shop.story?.length || 0) < 5 && (
                <label className="aspect-[3/4] rounded-xl border-2 border-dashed border-brand-line bg-brand-off/40 cursor-pointer flex flex-col items-center justify-center text-brand-mute hover:border-brand hover:text-brand">
                  <ImagePlus className="w-6 h-6" />
                  <span className="text-xs mt-1">Tambah</span>
                  <input type="file" multiple accept="image/*" className="hidden" onChange={onStoryFile} data-testid="story-add-input" />
                </label>
              )}
            </div>
          </Section>
          {/* Cabang / Multi-toko */}
          <Section
            title="Cabang / Multi-toko"
            desc="Kelola beberapa toko atau cabang. Semua data dashboard mengikuti cabang aktif."
          >
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <div className="text-sm text-brand-mute">
                {branchInfo ? (
                  <span>
                    {branchInfo.used} dari {branchInfo.limit === "unlimited" ? "∞" : branchInfo.limit} cabang terpakai
                  </span>
                ) : (
                  <span>Memuat data cabang…</span>
                )}
              </div>
              {branchInfo?.tier && (
                <span className="text-xs font-bold uppercase rounded-full bg-brand-off border border-brand-line px-3 py-1 text-brand-mute">
                  Paket {branchInfo.tier}
                </span>
              )}
            </div>

            <div className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white overflow-hidden mb-4">
              {(branchInfo?.shops || []).map((b) => (
                <div key={b.shop_id} className="flex items-center justify-between gap-3 p-4" data-testid={`branch-row-${b.shop_id}`}>
                  <div className="min-w-0">
                    <div className="font-bold truncate">{b.name}</div>
                    <div className="text-xs text-brand-mute truncate">/{b.slug}</div>
                  </div>
                  <span className={`text-xs font-bold rounded-full px-2.5 py-1 border ${
                    b.shop_id === branchInfo.active_shop_id
                      ? "bg-brand-off text-brand border-brand-line"
                      : "bg-white text-brand-mute border-brand-line"
                  }`}>
                    {b.shop_id === branchInfo.active_shop_id ? "Aktif" : "Cabang"}
                  </span>
                </div>
              ))}
            </div>

            {branchInfo?.can_create ? (
              <div className="grid sm:grid-cols-[1fr_auto] gap-2">
                <Input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Nama cabang baru, misal: Lapakin Bu Sari - Dago"
                  className="rounded-xl border-brand-line h-12"
                  data-testid="branch-name-input"
                />
                <Button
                  type="button"
                  onClick={createBranch}
                  disabled={creatingBranch}
                  className="bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-bold"
                  data-testid="branch-create-btn"
                >
                  {creatingBranch ? "Membuat…" : "Tambah Cabang"}
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Limit cabang paket ini sudah penuh. Upgrade ke paket yang lebih tinggi untuk menambah cabang.
              </div>
            )}
          </Section>

          {/* Anggota Tim */}
          <Section
            title="Anggota Tim"
            desc="Undang anggota untuk ikut mengelola toko. Kalau belum punya akun, mereka cukup daftar dengan email yang diundang."
          >
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <div className="flex items-center gap-2 text-sm text-brand-mute">
                <Users className="w-4 h-4 text-brand" />
                {teamLoading ? (
                  <span>Memuat anggota…</span>
                ) : team ? (
                  <span>
                    {team.used} dari {team.limit === "unlimited" ? "∞" : team.limit} anggota terpakai
                  </span>
                ) : (
                  <span>Belum ada data anggota</span>
                )}
              </div>
              {team?.tier && (
                <span className="text-xs font-bold uppercase rounded-full bg-brand-off border border-brand-line px-3 py-1 text-brand-mute">
                  Paket {team.tier}
                </span>
              )}
            </div>

            {teamLoading ? (
              <div className="mb-4 rounded-xl border border-brand-line bg-brand-off/50 p-3 text-sm text-brand-mute">
                Memuat data anggota tim…
              </div>
            ) : teamError ? (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-center justify-between gap-3">
                <span>{teamError}</span>
                <Button type="button" variant="outline" size="sm" onClick={loadTeam} className="rounded-xl border-red-200">
                  Coba lagi
                </Button>
              </div>
            ) : team?.is_owner ? (
              <div className="grid sm:grid-cols-[1fr_auto] gap-2 mb-4">
                <Input
                  type="email"
                  value={teamEmail}
                  onChange={(e) => setTeamEmail(e.target.value)}
                  placeholder="email-anggota@contoh.com"
                  className="rounded-xl border-brand-line h-12"
                  data-testid="team-email-input"
                />
                <Button
                  type="button"
                  onClick={addTeamMember}
                  disabled={addingMember || (team && team.remaining === 0)}
                  className="bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-bold"
                  data-testid="team-add-btn"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  {addingMember ? "Menambah…" : "Tambah"}
                </Button>
              </div>
            ) : (
              <div className="mb-4 rounded-xl border border-brand-line bg-brand-off/50 p-3 text-sm text-brand-mute">
                Hanya owner toko yang bisa menambah atau menghapus anggota.
              </div>
            )}

            {team && team.remaining === 0 && team.limit !== "unlimited" && team.is_owner && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Limit anggota tim paket ini sudah penuh. Upgrade paket untuk menambah anggota lagi.
              </div>
            )}

            <div className="divide-y divide-brand-line rounded-xl border border-brand-line bg-white overflow-hidden">
              {(team?.members || []).map((member) => (
                <div key={member.user_id} className="flex items-center justify-between gap-3 p-4" data-testid={`team-member-${member.user_id}`}>
                  <div className="min-w-0">
                    <div className="font-bold truncate">{member.name || member.email}</div>
                    <div className="text-xs text-brand-mute truncate">{member.email}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex items-center gap-1 text-xs font-bold rounded-full px-2.5 py-1 border ${
                      member.role === "owner"
                        ? "bg-brand-off text-brand border-brand-line"
                        : "bg-white text-brand-mute border-brand-line"
                    }`}>
                      {member.role === "owner" && <ShieldCheck className="w-3 h-3" />}
                      {member.role === "owner" ? "Owner" : "Staff"}
                    </span>
                    {team?.is_owner && member.role !== "owner" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTeamMember(member)}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        data-testid={`team-remove-${member.user_id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {(team?.pending_invites || []).map((invite) => (
                <div key={invite.invite_id} className="flex items-center justify-between gap-3 p-4 bg-amber-50/60" data-testid={`team-invite-${invite.invite_id}`}>
                  <div className="min-w-0">
                    <div className="font-bold truncate">{invite.email}</div>
                    <div className="text-xs text-amber-800 truncate">Menunggu daftar / login dengan email ini</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1 text-xs font-bold rounded-full px-2.5 py-1 border bg-amber-100 text-amber-900 border-amber-200">
                      Pending
                    </span>
                    {team?.is_owner && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeTeamInvite(invite)}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        data-testid={`team-revoke-${invite.invite_id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {team && team.members.length === 0 && (team.pending_invites || []).length === 0 && (
                <div className="p-6 text-center text-sm text-brand-mute">
                  Belum ada anggota tim.
                </div>
              )}
            </div>
          </Section>
        </div>
</div>

          


      {/* CUSTOM DOMAIN — BISNIS tier */}
      <CustomDomainSection shop={shop} />

              </div>

{/* Save bar */}
      <div className="sticky bottom-4 z-30 mt-8 overflow-hidden rounded-3xl border border-brand-line bg-white/95 p-3 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="px-1">
            <p className="text-sm font-extrabold text-brand-ink">Perubahan belum tampil sebelum disimpan</p>
            <p className="text-xs leading-relaxed text-brand-mute">
              Simpan setelah mengubah profil, order, pembayaran, atau lokasi toko.
            </p>
          </div>
          <Button onClick={save} disabled={saving}
            className="h-12 w-full rounded-2xl bg-brand px-7 font-extrabold text-white hover:bg-brand-hover sm:w-auto btn-press"
            data-testid="settings-save-btn">
            <Save className="w-4 h-4 mr-2" /> {saving ? "Menyimpan…" : "Simpan Semua Perubahan"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Section({ title, desc, eyebrow, badge, children }) {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-brand-line bg-white shadow-card">
      <div className="border-b border-brand-line bg-gradient-to-br from-brand-off via-white to-brand-soft/30 px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {eyebrow && (
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-mute">
                {eyebrow}
              </p>
            )}
            <h3 className="font-heading text-lg font-extrabold text-brand-ink">{title}</h3>
            {desc && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-brand-mute">{desc}</p>}
          </div>
          {badge && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand-ink shadow-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-brand" />
              {badge}
            </span>
          )}
        </div>
      </div>
      <div className="p-5 sm:p-6">
        {children}
      </div>
    </div>
  );
}

function ToggleCard({ icon: Icon = CheckCircle2, title, desc, checked, onChange, disabled = false, "data-testid": dataTestId }) {
  return (
    <label
      className={`group flex h-full cursor-pointer items-start gap-3 rounded-3xl border p-4 transition ${
        checked
          ? "border-brand bg-brand-soft/70 shadow-sm"
          : "border-brand-line bg-white hover:-translate-y-0.5 hover:border-brand hover:shadow-sm"
      } ${disabled ? "cursor-not-allowed opacity-60 hover:translate-y-0 hover:shadow-none" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        data-testid={dataTestId}
        className="sr-only"
      />
      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
        checked ? "bg-brand text-white" : "bg-brand-off text-brand"
      }`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-brand-ink">{title}</span>
        {desc && <span className="mt-1 block text-xs leading-relaxed text-brand-mute">{desc}</span>}
      </span>
      <span className={`mt-1 h-5 w-5 shrink-0 rounded-full border transition ${
        checked ? "border-brand bg-brand shadow-sm" : "border-brand-line bg-white"
      }`}>
        {checked && <CheckCircle2 className="h-5 w-5 text-white" />}
      </span>
    </label>
  );
}

function CustomDomainSection({ shop }) {
  const { user } = useAuth();
  const [domain, setDomain] = useState(shop?.custom_domain || "");
  const [verified, setVerified] = useState(!!shop?.custom_domain_verified);
  const [dns, setDns] = useState(null);
  const [saving, setSaving] = useState(false);
  const isBusiness = (user?.tier || "free") === "business";

  if (!shop) return null;

  const request = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/shops/me/custom-domain", { domain });
      setDns(data.dns_instructions);
      setVerified(false);
      toast.success("Domain disimpan. Ikuti instruksi DNS di bawah.");
    } catch (e) {
      if (e.response?.status === 402) toast.error("Custom domain hanya di tier Bisnis. Upgrade dulu ya!");
      else toast.error(e.response?.data?.detail || "Gagal simpan domain");
    } finally { setSaving(false); }
  };

  const verify = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/shops/me/custom-domain/verify");
      setVerified(data.verified);
      if (data.verified) toast.success("DNS terverifikasi ✅");
      else toast.warning(data.message);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal verifikasi");
    } finally { setSaving(false); }
  };

  return (
    <div className="mt-6 bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="custom-domain-section">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-heading font-bold flex items-center gap-2">
            🌐 Custom Domain
            {!isBusiness && <span className="text-[10px] bg-purple-100 text-purple-900 rounded-full px-2 py-0.5 font-bold">BISNIS</span>}
          </h3>
          <p className="text-xs text-brand-mute mt-0.5">
            Pakai domain sendiri (mis. <b>tokokamu.com</b>) alih-alih <code className="bg-brand-off px-1 rounded">lapakin.my.id/toko/...</code>
          </p>
        </div>
      </div>
      {!isBusiness ? (
        <div className="rounded-xl border border-dashed border-brand-line p-4 text-center" data-testid="custom-domain-locked">
          <p className="text-sm text-brand-mute">
            Fitur custom domain tersedia di tier <b>Bisnis</b>.
          </p>
          <a href="/pricing" className="inline-block mt-2 text-brand font-bold hover:underline">Upgrade ke Bisnis →</a>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              placeholder="tokokamu.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="flex-1 rounded-xl border border-brand-line h-12 px-3 font-mono text-sm"
              data-testid="custom-domain-input"
            />
            <button onClick={request} disabled={saving || !domain}
              className="bg-brand text-white rounded-xl px-5 h-12 font-bold disabled:opacity-50"
              data-testid="custom-domain-save">
              Simpan
            </button>
          </div>
          {shop.custom_domain && (
            <div className="mt-3 flex items-center justify-between text-sm bg-brand-off border border-brand-line rounded-xl p-3">
              <span className="font-mono">{shop.custom_domain}</span>
              <span className={verified ? "text-green-700 font-bold" : "text-yellow-700 font-bold"}>
                {verified ? "✅ Verified" : "⏳ Pending DNS"}
              </span>
              <button onClick={verify} disabled={saving}
                className="text-brand font-bold text-xs hover:underline"
                data-testid="custom-domain-verify">
                Verifikasi DNS
              </button>
            </div>
          )}
          {dns && (
            <div className="mt-3 bg-brand-ink text-brand-off rounded-xl p-4 font-mono text-xs">
              <div className="text-[10px] uppercase tracking-wider text-brand-off/70 mb-2">Tambahkan DNS record ini di registrar domain kamu:</div>
              <div>Type: <b>{dns.type}</b></div>
              <div>Name: <b>{dns.name}</b> (atau <b>@</b> / <b>www</b>)</div>
              <div>Value: <b>{dns.value}</b></div>
              <div>TTL: {dns.ttl}</div>
              <p className="mt-2 text-brand-off/70 leading-relaxed">
                Propagasi DNS biasanya 5 menit – 24 jam. Setelah itu klik "Verifikasi DNS".
                Hubungi admin Lapakin via WhatsApp untuk setup SSL.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
