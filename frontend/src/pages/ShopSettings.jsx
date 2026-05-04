import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Wand2, Upload, X, ImagePlus, Trash2, QrCode, RefreshCw, Users, UserPlus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

import { resolveStorefrontTemplate } from "../storefront/templates";
const BUSINESS_TYPES = [
  { id: "kuliner", label: "Kuliner / Makanan" },
  { id: "kopi", label: "Kopi / Minuman" },
  { id: "fashion", label: "Fashion" },
  { id: "kerajinan", label: "Kerajinan / Handmade" },
  { id: "kecantikan", label: "Kecantikan" },
  { id: "lainnya", label: "Lainnya" },
];

const COVER_STYLES = [
  { id: "warm", label: "Hangat / Earthy" },
  { id: "minimal", label: "Minimal / Bersih" },
  { id: "vibrant", label: "Cerah / Vibrant" },
];

export default function ShopSettings() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
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

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/shops/me");
      if (!data) { navigate("/onboarding"); return; }
      setShop(data);
    })();
  }, [navigate]);

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
    return <DashboardLayout title="Pengaturan Toko"><div className="text-brand-mute">Memuat…</div></DashboardLayout>;
  }

  const update = (k, v) => setShop((s) => ({ ...s, [k]: v }));

  const getStorefrontTemplateFeatureConfig = (tierValue) => {
    const normalizedTier = String(tierValue || "free").toLowerCase();

    if (normalizedTier === "business") {
      return {
        tier: "business",
        templates: true,
        editor: true,
        ai: true,
        advanced: true,
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

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...shop };
      delete payload.shop_id; delete payload.slug; delete payload.owner_user_id;
      delete payload.created_at; delete payload.updated_at; delete payload.status; delete payload.featured;
      const { data } = await api.post("/shops/me", payload);
      setShop(data);
      toast.success("Tersimpan");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan"); }
    finally { setSaving(false); }
  };

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
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
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

          {/* IDENTITY */}
          <Section title="Identitas Toko" desc="Info dasar yang tampil di header & meta.">
            <div className="space-y-4">
              <div>
                <Label>Nama Toko</Label>
                <Input value={shop.name} onChange={(e) => update("name", e.target.value)}
                  className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-name" />
              </div>
              <div>
                <Label>Tagline</Label>
                <Input value={shop.tagline || ""} onChange={(e) => update("tagline", e.target.value)}
                  className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-tagline" />
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
                      className={`text-sm font-semibold rounded-xl px-4 py-3 border ${shop.business_type === b.id ? "bg-brand text-white border-brand" : "bg-white text-brand-ink border-brand-line hover:border-brand"}`}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
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

        {/* Sidebar */}
        <div className="space-y-6">
          <Section title="Kontak & Sosial" desc="">
            <div className="space-y-4">
              <div>
                <Label>WhatsApp</Label>
                <Input value={shop.whatsapp || ""} onChange={(e) => update("whatsapp", e.target.value)}
                  placeholder="08xxxxxxxxxx" className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-whatsapp" />
              </div>
              <div>
                <Label>Instagram</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute">@</span>
                  <Input value={shop.instagram || ""} onChange={(e) => update("instagram", e.target.value.replace(/^@/, ""))}
                    placeholder="namatoko" className="pl-7 rounded-xl border-brand-line h-12" data-testid="settings-instagram" />
                </div>
              </div>
              <div>
                <Label>TikTok</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute">@</span>
                  <Input value={shop.tiktok || ""} onChange={(e) => update("tiktok", e.target.value.replace(/^@/, ""))}
                    placeholder="namatoko" className="pl-7 rounded-xl border-brand-line h-12" data-testid="settings-tiktok" />
                </div>
              </div>
              <div>
                <Label>Shopee URL</Label>
                <Input value={shop.shopee || ""} onChange={(e) => update("shopee", e.target.value)}
                  placeholder="https://shopee.co.id/..." className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-shopee" />
              </div>
            </div>
          </Section>

          <Section title="Lokasi & Jam">
            <div className="space-y-4">
              <div>
                <Label>Alamat / Area</Label>
                <Input value={shop.address || ""} onChange={(e) => update("address", e.target.value)}
                  placeholder="Jl. Asia Afrika No.123, Bandung"
                  className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-address" />
              </div>
              <div>
                <Label>Jam Buka</Label>
                <Input value={shop.hours || ""} onChange={(e) => update("hours", e.target.value)}
                  placeholder="Senin-Sabtu 08:00-21:00"
                  className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-hours" />
              </div>
            </div>
          </Section>

          <Section title="Banner Promo" desc="Tampil di atas grid produk kalau aktif.">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!shop.promo_active}
                onChange={(e) => update("promo_active", e.target.checked)}
                className="w-4 h-4 accent-brand" data-testid="promo-active-toggle" />
              <span className="text-sm font-semibold">Aktifkan Promo</span>
            </label>
            <div className={`mt-3 space-y-3 ${shop.promo_active ? "" : "opacity-50 pointer-events-none"}`}>
              <Input value={shop.promo_title || ""} onChange={(e) => update("promo_title", e.target.value)}
                placeholder="Judul: Diskon Pembeli Pertama"
                className="rounded-xl border-brand-line h-11" data-testid="promo-title" maxLength={60} />
              <Textarea rows={2} value={shop.promo_description || ""} onChange={(e) => update("promo_description", e.target.value)}
                placeholder="Detail singkat promo"
                className="rounded-xl border-brand-line" data-testid="promo-description" maxLength={150} />
              <Input value={shop.promo_code || ""} onChange={(e) => update("promo_code", e.target.value.toUpperCase())}
                placeholder="Kode: HALOKOPI"
                className="rounded-xl border-brand-line h-11 font-mono" data-testid="promo-code" maxLength={20} />
            </div>
          </Section>

          <Section title="Tampilan">
            <Label>Warna Brand</Label>
            <div className="mt-1 flex items-center gap-3">
              <input type="color" value={shop.brand_color || "#C04A3B"}
                onChange={(e) => update("brand_color", e.target.value)}
                className="w-14 h-12 rounded-xl border border-brand-line cursor-pointer" data-testid="settings-color" />
              <Input value={shop.brand_color || "#C04A3B"} onChange={(e) => update("brand_color", e.target.value)}
                className="rounded-xl border-brand-line h-12" />
            </div>
            <div className="mt-3 text-xs text-brand-mute font-mono break-all">URL: {window.location.origin}/toko/{shop.slug}</div>
          </Section>
        </div>
      </div>

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

              <div className="mt-4 rounded-2xl bg-brand-off p-4 text-xs leading-relaxed text-brand-mute">
                Tips: gunakan kata yang spesifik sesuai toko. Untuk makanan, bisa pakai “Menu favorit hari ini”.
                Untuk jasa, bisa pakai “Konsultasikan kebutuhanmu”.
              </div>
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


      {/* CUSTOM DOMAIN — BISNIS tier */}
      <CustomDomainSection shop={shop} />

      {/* Save bar */}
      <div className="sticky bottom-4 mt-8 bg-white border border-brand-line rounded-2xl shadow-cardHover p-4 flex justify-end">
        <Button onClick={save} disabled={saving}
          className="bg-brand hover:bg-brand-hover text-white rounded-xl px-7 h-12 font-semibold btn-press"
          data-testid="settings-save-btn">
          <Save className="w-4 h-4 mr-2" /> {saving ? "Menyimpan…" : "Simpan Semua Perubahan"}
        </Button>
      </div>
    </DashboardLayout>
  );
}

function Section({ title, desc, children }) {
  return (
    <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card">
      <div className="mb-4">
        <h3 className="font-heading font-bold">{title}</h3>
        {desc && <p className="text-xs text-brand-mute mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
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
