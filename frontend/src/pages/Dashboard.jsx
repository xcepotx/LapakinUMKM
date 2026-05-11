import React from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import BroadcastBanner from "@/components/BroadcastBanner";
import { Button } from "@/components/ui/button";
import {Wand2, Package, ExternalLink, ChevronDown, ChevronUp, Plus, Sparkles, Share2, Copy, Power, PowerOff, Coffee, X, Calendar, Wallet, ShoppingBag, AlertCircle, TrendingUp, } from "lucide-react";
import { rupiah } from "@/lib/api";
import { toast } from "sonner";
import { useState as useWaBotState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import ShareHealthCard from "@/components/ShareHealthCard";
import DailyTipCard from "@/components/DailyTipCard";

function formatTrialDate(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
  }).format(new Date(value));
}

function getTrialDaysLeft(value) {
  if (!value) return null;

  const expiresAt = new Date(value).getTime();
  const now = Date.now();
  const diffMs = expiresAt - now;

  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function formatRupiah(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(number);
}


function AIWaBotBanner() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const connected = localStorage.getItem("ai_wa_bot_connected") === "1";

  const handleConnect = async () => {
    setLoading(true); setError("");
    try {
      const r = await api.get("/bot/access-url");
      localStorage.setItem("ai_wa_bot_connected", "1");
      window.open(r.data.redirect_url, "_blank");
      setLoading(false);
    } catch (err) {
      setError(err?.response?.data?.detail || "Gagal. Coba lagi.");
      setLoading(false);
    }
  };

  if (connected) return (
    <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-lg shadow-sm">🤖</span>
          <div>
            <div className="text-sm font-extrabold text-emerald-800">Lapakin Asisten Terhubung</div>
            <div className="text-xs text-emerald-700">Bot WhatsApp siap membantu order dan tanya jawab pelanggan.</div>
          </div>
        </div>
        <button onClick={handleConnect} disabled={loading}
          className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:opacity-60">
          {loading ? "Memproses..." : "Buka Dashboard →"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mb-6 rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4 flex-wrap" style={{background:"linear-gradient(135deg,#16a34a,#15803d)",color:"#fff"}}>
      <div className="flex items-center gap-4">
        <div style={{width:48,height:48,background:"rgba(255,255,255,0.2)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>🤖</div>
        <div><div className="font-extrabold text-base">Lapakin Asisten</div><div className="text-sm" style={{opacity:0.85}}>Aktifkan asisten WhatsApp otomatis untuk toko kamu</div></div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <button onClick={handleConnect} disabled={loading} className="shrink-0 font-bold px-5 py-2.5 rounded-xl text-sm transition hover:opacity-90" style={{background:"#fff",color:"#16a34a",cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1}}>{loading?"Memproses...":"🚀 Aktifkan Sekarang"}</button>
        {error&&<div className="text-xs" style={{opacity:0.9}}>⚠ {error}</div>}
      </div>
    </div>
  );
}
// LAPAKIN_AI_BUTTON_READINESS_GATE_V1
function getReadinessScoreValue(readiness) {
  const raw =
    readiness?.score ??
    readiness?.percentage ??
    readiness?.percent ??
    readiness?.readiness_score ??
    readiness?.website_score ??
    0;

  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function canGenerateWebsiteFromReadiness(readiness) {
  if (!readiness) return false;

  return Boolean(
    readiness.can_generate_website === true ||
    readiness.canGenerateWebsite === true ||
    getReadinessScoreValue(readiness) >= 70
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [salesSummary, setSalesSummary] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [generatingWebsiteAi, setGeneratingWebsiteAi] = useState(false);
  // LAPAKIN_AI_PREVIEW_REGENERATE_V2
  const [websiteAiPreview, setWebsiteAiPreview] = useState(null);
  // LAPAKIN_DASHBOARD_AI_DRAFT_BEFORE_APPLY_V1
  const [applyingWebsiteAi, setApplyingWebsiteAi] = useState(false);
  const [readinessPanelOpen, setReadinessPanelOpen] = useState(false);

  const salesSummaryKey = `lapakin_sales_summary_collapsed_${user?.user_id || "user"}`;
  const readinessCacheKey = `lapakin_dashboard_readiness_${user?.user_id || "user"}`;

  const [isSalesSummaryCollapsed, setIsSalesSummaryCollapsed] = useState(false);

  useEffect(() => {
    try {
      setIsSalesSummaryCollapsed(localStorage.getItem(salesSummaryKey) === "1");
    } catch {
      setIsSalesSummaryCollapsed(false);
    }
  }, [salesSummaryKey]);

  function toggleSalesSummary() {
    setIsSalesSummaryCollapsed((prev) => {
      const next = !prev;

      try {
        localStorage.setItem(salesSummaryKey, next ? "1" : "0");
      } catch {
        // ignore
      }

      return next;
    });
  }

  const trialDaysLeft = getTrialDaysLeft(user?.trial_expires_at);
  const isTrialEndingSoon =
    Boolean(user?.trial && user?.trial_expires_at) &&
    trialDaysLeft !== null &&
    trialDaysLeft <= 2;

  const trialBannerPhase = isTrialEndingSoon ? "ending-soon" : "active";
  const trialBannerKey = user?.trial_expires_at
    ? `lapakin_trial_banner_${user?.user_id || "user"}_${trialBannerPhase}_${user.trial_expires_at}`
    : "";

  const [hideTrialBanner, setHideTrialBanner] = useState(false);

  useEffect(() => {
    if (!trialBannerKey) {
      setHideTrialBanner(false);
      return;
    }

    try {
      setHideTrialBanner(localStorage.getItem(trialBannerKey) === "1");
    } catch {
      setHideTrialBanner(false);
    }
  }, [trialBannerKey]);

  function closeTrialBanner() {
    setHideTrialBanner(true);

    try {
      localStorage.setItem(trialBannerKey, "1");
    } catch {
      // ignore
    }
  }

  const loadReadiness = async ({ useCache = true } = {}) => {
    let hasCachedReadiness = false;

    if (useCache) {
      try {
        const cached = sessionStorage.getItem(readinessCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === "object") {
            setReadiness(parsed);
            hasCachedReadiness = true;
            setReadinessLoading(false);
          }
        }
      } catch {
        // ignore corrupted cache
      }
    }

    if (!hasCachedReadiness) {
      setReadinessLoading(true);
    }

    try {
      const readinessResponse = await api.get("/shops/readiness");
      const nextReadiness = readinessResponse.data || null;
      setReadiness(nextReadiness);

      try {
        if (nextReadiness) {
          sessionStorage.setItem(readinessCacheKey, JSON.stringify(nextReadiness));
        } else {
          sessionStorage.removeItem(readinessCacheKey);
        }
      } catch {
        // ignore storage errors
      }
    } catch {
      if (!hasCachedReadiness) {
        setReadiness(null);
      }
    } finally {
      setReadinessLoading(false);
    }
  };

  const handleGenerateWebsiteAi = async () => {
    if (!canGenerateWebsiteFromReadiness(readiness)) {
      const href = readiness?.next_best_action?.href || "/dashboard/settings";
      navigate(href);
      return;
    }

    setGeneratingWebsiteAi(true);
    try {
      const { data } = await api.post("/shops/website-ai/draft");
      setWebsiteAiPreview(data || null);
      // LAPAKIN_AI_PREVIEW_NO_SETTINGS_REDIRECT_V1
      // Tetap di dashboard agar owner bisa review hasil AI, lihat website, atau generate ulang.
      if (data?.readiness) {
        setReadiness(data.readiness);
        try {
          sessionStorage.setItem(readinessCacheKey, JSON.stringify(data.readiness));
        } catch {
          // ignore storage errors
        }
      }
      toast.success(data?.message || "Draft website berhasil dibuat dengan AI");
      // AI preview stays on dashboard; user can open settings manually if needed.
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : detail?.message || "Gagal membuat website dengan AI";
      toast.error(message);

      const nextHref = detail?.next_best_action?.href;
      if (nextHref) {
        navigate(nextHref);
      }
    } finally {
      setGeneratingWebsiteAi(false);
    }
  };

  // LAPAKIN_DASHBOARD_AI_DRAFT_BEFORE_APPLY_V1
  const handleApplyWebsiteAiDraft = async () => {
    if (!websiteAiPreview?.generated) {
      toast.error("Draft website AI belum tersedia.");
      return;
    }

    setApplyingWebsiteAi(true);

    try {
      const { data } = await api.post("/shops/website-ai/apply", {
        generated: websiteAiPreview.generated,
        source: websiteAiPreview.source,
      });

      setWebsiteAiPreview({
        ...(data || {}),
        applied: true,
      });

      if (data?.readiness) {
        setReadiness(data.readiness);
        try {
          sessionStorage.setItem(readinessCacheKey, JSON.stringify(data.readiness));
        } catch {
          // ignore storage errors
        }
      }

      toast.success(data?.message || "Draft website AI siap direview.");
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : detail?.message || "Gagal menerapkan draft website AI";
      toast.error(message);
    } finally {
      setApplyingWebsiteAi(false);
    }
  };


  useEffect(() => {
    (async () => {
      try {
        const [s, p] = await Promise.all([
          api.get("/shops/me"),
          api.get("/products"),
        ]);

        if (!s.data) {
          navigate("/onboarding");
          return;
        }

        setShop(s.data);
        setProducts(p.data || []);

        try {
          const sales = await api.get("/sales/summary");
          setSalesSummary(sales.data || null);
        } catch {
          setSalesSummary(null);
        }

        // Readiness is useful, but should not block the initial dashboard render.
        // Load it in the background and show cached data/skeleton in the card.
        loadReadiness({ useCache: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="text-brand-mute" data-testid="dashboard-loading">Memuat dashboard…</div>
      </DashboardLayout>
    );
  }

  const storefrontUrl = `${window.location.origin}/toko/${shop?.slug}`;
  const ogImageUrl = `${window.location.origin}/api/og/shop/${shop?.slug}.png`;
  // OG-aware share URL — works for WhatsApp/FB/Twitter crawlers immediately,
  // even before nginx is configured. Humans get auto-redirected to /toko/<slug>.
  const shareUrl = `${window.location.origin}/api/og/shop/${shop?.slug}`;

  const sellsByHours = (shop?.sells_by || "stock") === "hours";
  const isOpen = shop?.is_open !== false;
  const sellsByStock = (shop?.sells_by || "stock") === "stock";

  const toggleOpen = async () => {
    try {
      const { data } = await api.post("/shops/me/toggle-open");
      setShop((s) => ({ ...s, is_open: data.is_open }));
      toast.success(data.is_open ? "Toko dibuka 🟢" : "Toko ditutup 🔴");
    } catch (e) {
      toast.error("Gagal ubah status. Coba lagi.");
    }
  };

  const snoozeShop = async (minutes) => {
    try {
      const { data } = await api.post("/shops/me/snooze", { minutes });
      setShop((s) => ({ ...s, snooze_until: data.snooze_until }));
      if (minutes === 0) toast.success("Snooze dibatalkan");
      else toast.success(`Toko istirahat ${minutes} menit ☕`);
    } catch (e) {
      toast.error("Gagal set snooze. Coba lagi.");
    }
  };

  const snoozeUntil = shop?.snooze_until ? new Date(shop.snooze_until) : null;
  const isSnoozed = snoozeUntil && snoozeUntil > new Date();
  const snoozeMinsLeft = isSnoozed
    ? Math.max(1, Math.ceil((snoozeUntil - new Date()) / 60000))
    : 0;

  const salesCards = [
    {
      title: "Omzet Hari Ini",
      value: formatRupiah(salesSummary?.omzet_today),
      icon: Wallet,
      tone: "bg-green-50 text-green-700",
    },
    {
      title: "Transaksi Hari Ini",
      value: salesSummary?.transaction_today || 0,
      icon: ShoppingBag,
      tone: "bg-blue-50 text-blue-700",
    },
    {
      title: "Belum Dibayar",
      value: formatRupiah(salesSummary?.unpaid_total),
      icon: AlertCircle,
      tone: "bg-orange-50 text-orange-700",
    },
    {
      title: "Omzet Bulan Ini",
      value: formatRupiah(salesSummary?.omzet_month),
      icon: TrendingUp,
      tone: "bg-brand-off text-brand",
    },
  ];

  return (
    <DashboardLayout
      shop={shop}
      title={`Halo, ${shop?.name || "Bos"} 👋`}
      subtitle="Kelola produkmu dan biarkan AI mengerjakan bagian susahnya."
      actions={
        <div className="flex gap-2 flex-wrap">
          
          <Button
            onClick={() => navigate("/dashboard/ai-studio")}
            className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
            data-testid="dashboard-cta-ai-studio"
          >
            <Wand2 className="w-4 h-4 mr-2" /> Buka AI Studio
          </Button>
        </div>
      }
    >
    {/* Lapakin Asisten Banner */}
    <AIWaBotBanner />

    <ReadinessOverviewCard
      readiness={readiness}
      loading={readinessLoading}
      onOpenAction={(href) => navigate(href || "/dashboard/settings")}
      onGenerateWebsite={handleGenerateWebsiteAi}
      generatingWebsiteAi={generatingWebsiteAi}
      onOpenChecklist={() => setReadinessPanelOpen(true)}
    />

    <ReadinessDetailPanel
      open={readinessPanelOpen}
      readiness={readiness}
      onClose={() => setReadinessPanelOpen(false)}
      onOpenAction={(href) => {
        setReadinessPanelOpen(false);
        navigate(href || "/dashboard/settings");
      }}
    />
    
      <WebsiteAiPreviewPanel
        open={!!websiteAiPreview}
        result={websiteAiPreview}
        generating={generatingWebsiteAi}
        applying={applyingWebsiteAi}
        onClose={() => setWebsiteAiPreview(null)}
        onRegenerate={handleGenerateWebsiteAi}
        onApply={handleApplyWebsiteAiDraft}
      />
{user?.trial_expired && !user?.trial && (
      <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50 p-5 text-orange-950 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-orange-800">
              Trial Pro Berakhir
            </div>
            <div className="mt-1 text-lg font-extrabold">
              Trial Pro kamu sudah selesai.
            </div>
            <p className="mt-1 text-sm text-orange-800">
              Beberapa fitur Pro seperti Analitik, custom subdomain, dan fitur premium lainnya akan terkunci kembali.
            </p>
          </div>

          <a
            href="/dashboard/billing"
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-orange-900 px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            Lihat Paket
          </a>
        </div>
      </div>
    )}

    <div className="mb-5 rounded-[1.75rem] border border-brand-line bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-extrabold text-brand-ink">
            Ringkasan Jualan
          </h2>
          <p className="text-sm text-brand-mute">
            Pantau performa toko dari Buku Jualan.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/dashboard/sales"
            className="rounded-xl border border-brand-line px-3 py-2 text-sm font-bold text-brand hover:bg-brand-off"
          >
            Buka Buku Jualan
          </a>

          <button
            type="button"
            onClick={toggleSalesSummary}
            className="inline-flex items-center gap-1 rounded-xl bg-brand-off px-3 py-2 text-sm font-bold text-brand hover:bg-brand-sand"
          >
            {isSalesSummaryCollapsed ? (
              <>
                Tampilkan <ChevronDown className="h-4 w-4" />
              </>
            ) : (
              <>
                Sembunyikan <ChevronUp className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {isSalesSummaryCollapsed ? (
        <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-brand-sand px-4 py-3 text-sm text-brand-ink sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="font-bold">Hari ini:</span>{" "}
            {formatRupiah(salesSummary?.omzet_today)} dari{" "}
            {salesSummary?.transaction_today || 0} transaksi
          </div>

          <div>
            <span className="font-bold">Belum dibayar:</span>{" "}
            {formatRupiah(salesSummary?.unpaid_total)}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {salesCards.map((card) => {
              const Icon = card.icon;

              return (
                <div
                  key={card.title}
                  className="rounded-2xl border border-brand-line bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-brand-mute">
                      {card.title}
                    </p>
                    <div className={`rounded-xl p-2 ${card.tone}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="mt-3 font-heading text-2xl font-extrabold text-brand-ink">
                    {card.value}
                  </div>
                </div>
              );
            })}
          </div>

          {salesSummary?.top_products?.length > 0 && (
            <div className="mt-4 rounded-2xl border border-brand-line bg-brand-off/30 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-heading font-bold text-brand-ink">
                  Produk Terlaris Bulan Ini
                </h3>
                <span className="text-xs font-semibold text-brand-mute">
                  Berdasarkan catatan penjualan
                </span>
              </div>

              <div className="space-y-2">
                {salesSummary.top_products.slice(0, 3).map((item, index) => (
                  <div
                    key={`${item.product_id || item.name}-${index}`}
                    className="flex items-center justify-between rounded-xl bg-white px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-brand-ink">
                        {index + 1}. {item.name}
                      </div>
                      <div className="text-xs text-brand-mute">
                        Terjual {item.qty} item
                      </div>
                    </div>

                    <div className="ml-3 font-bold text-brand-ink">
                      {formatRupiah(item.revenue)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>

    {user?.trial && user?.trial_expires_at && !hideTrialBanner && (
      <div
        className={`mb-4 rounded-2xl border p-4 shadow-sm ${
          isTrialEndingSoon
            ? "border-orange-200 bg-orange-50 text-orange-950"
            : "border-yellow-200 bg-yellow-50 text-yellow-950"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div
              className={`text-xs font-bold uppercase tracking-wide ${
                isTrialEndingSoon ? "text-orange-800" : "text-yellow-800"
              }`}
            >
              {isTrialEndingSoon ? "Trial Pro Hampir Habis" : "Trial Pro Aktif 🎉"}
            </div>

            <div className="mt-1 text-base font-extrabold">
              {isTrialEndingSoon
                ? `Tersisa ${trialDaysLeft} hari lagi`
                : `Nikmati fitur Pro sampai ${formatTrialDate(user.trial_expires_at)}`}
            </div>

            <p
              className={`mt-0.5 text-sm ${
                isTrialEndingSoon ? "text-orange-800" : "text-yellow-800"
              }`}
            >
              {isTrialEndingSoon
                ? "Aktifkan Pro agar fitur premium seperti Analitik, AI, dan custom subdomain tetap berjalan."
                : "Analitik, AI, dan fitur Pro lainnya aktif selama masa trial."}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <a
              href="/dashboard/billing"
              className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 ${
                isTrialEndingSoon ? "bg-orange-900" : "bg-yellow-900"
              }`}
            >
              Kelola Paket
            </a>

            <button
              type="button"
              onClick={closeTrialBanner}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border bg-white/70 hover:bg-white ${
                isTrialEndingSoon
                  ? "border-orange-200 text-orange-900"
                  : "border-yellow-200 text-yellow-900"
              }`}
              aria-label="Tutup banner trial"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    )}
      <BroadcastBanner />

      {/* SHOP OPEN/CLOSED TOGGLE — only when sells_by='hours' */}
      {sellsByHours && (
        <div
          className={`mb-4 rounded-2xl border p-4 flex items-center justify-between gap-4 flex-wrap shadow-card ${
            isOpen
              ? "bg-green-50 border-green-300"
              : "bg-red-50 border-red-300"
          }`}
          data-testid="dashboard-open-banner">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-10 w-10 rounded-xl grid place-items-center ${isOpen ? "bg-green-600" : "bg-red-600"} text-white shrink-0 shadow-md`}>
              {isOpen ? <Power className="w-6 h-6" /> : <PowerOff className="w-6 h-6" />}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold tracking-[0.2em] uppercase opacity-70">Status Toko</div>
              <div className={`font-heading font-extrabold text-lg ${isOpen ? "text-green-800" : "text-red-800"}`}>
                {isOpen ? "BUKA SEKARANG" : "TUTUP"}
              </div>
              <div className="text-xs text-brand-mute mt-0.5">
                {isOpen ? "Pelanggan bisa pesan langsung. Klik Tutup kalau habis bahan / jam tutup." : "Pelanggan lihat banner 'lagi tutup'. Cart disabled."}
              </div>
            </div>
          </div>
          <Button
            onClick={toggleOpen}
            className={`${isOpen ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"} text-white rounded-xl px-4 h-10 font-bold btn-press`}
            data-testid="dashboard-toggle-open">
            {isOpen ? <><PowerOff className="w-4 h-4 mr-2" /> Tutup Toko</> : <><Power className="w-4 h-4 mr-2" /> Buka Toko</>}
          </Button>
        </div>
      )}

      {/* SNOOZE BUKA — istirahat singkat 15/30/60 menit (F&B) */}
      {sellsByHours && isOpen && (
        <div className={`mb-6 rounded-2xl p-4 border-2 shadow-card flex items-center justify-between gap-4 flex-wrap ${
          isSnoozed ? "bg-amber-50 border-amber-300" : "bg-brand-off border-brand-line"
        }`}
          data-testid="dashboard-snooze-card">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
              isSnoozed ? "bg-amber-500 text-white" : "bg-white text-brand-mute border border-brand-line"
            }`}>
              <Coffee className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              {isSnoozed ? (
                <>
                  <div className="text-xs font-bold tracking-widest uppercase text-amber-700">Istirahat</div>
                  <div className="font-heading font-bold text-lg text-amber-900" data-testid="snooze-active-label">
                    Buka lagi {snoozeMinsLeft} menit lagi
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs font-bold tracking-widest uppercase text-brand-mute">Istirahat Singkat</div>
                  <div className="font-heading font-bold text-base">Tutup sebentar tanpa perlu toggle</div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSnoozed ? (
              <Button
                onClick={() => snoozeShop(0)}
                variant="outline"
                size="sm"
                className="rounded-lg border-amber-400 text-amber-900 bg-white hover:bg-amber-50 font-semibold h-10 px-4"
                data-testid="snooze-cancel">
                <X className="w-4 h-4 mr-1.5" /> Batalkan
              </Button>
            ) : (
              [15, 30, 60].map((m) => (
                <Button key={m}
                  onClick={() => snoozeShop(m)}
                  size="sm"
                  variant="outline"
                  className="rounded-lg border-brand-line bg-white hover:bg-brand-sand font-semibold h-10 px-3.5 text-sm"
                  data-testid={`snooze-${m}`}>
                  {m} mnt
                </Button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Total Produk" value={products.length} icon={<Package className="w-5 h-5" />} tid="stat-products" />
        {sellsByStock ? (
          <>
            <StatCard
              label="Stok Total"
              value={products.reduce((s, p) => s + (p.stock || 0), 0)}
              icon={<Sparkles className="w-5 h-5" />}
              tid="stat-stock"
            />
            <StatCard
              label="Estimasi Nilai Stok"
              value={rupiah(products.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0))}
              icon={<Sparkles className="w-5 h-5" />}
              tid="stat-value"
            />
          </>
        ) : sellsByHours ? (
          <>
            <StatCard
              label="Menu Hari Ini"
              value={products.filter((p) => !p.available_days?.length || p.available_days.includes((new Date().getDay() + 6) % 7)).length}
              icon={<Sparkles className="w-5 h-5" />}
              tid="stat-today"
            />
            <StatCard
              label="Status"
              value={isOpen ? "🟢 Buka" : "🔴 Tutup"}
              icon={<Power className="w-5 h-5" />}
              tid="stat-open"
            />
          </>
        ) : (
          <StatCard
            label="Mode"
            value="♾️ Selalu Ada"
            icon={<Sparkles className="w-5 h-5" />}
            tid="stat-mode"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Quick actions */}
        <div className="lg:col-span-2 space-y-4">
          <div className="overflow-hidden rounded-3xl border border-brand-line bg-white shadow-card">
            <div className="bg-gradient-to-br from-brand-off via-white to-brand-soft/30 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-mute">Website toko</p>
                  <h2 className="font-heading text-xl font-extrabold text-brand-ink">Tokomu sudah online 🎉</h2>
                  <p className="mt-1 text-sm text-brand-mute">Bagikan link ini ke pelanggan, bio Instagram, dan WhatsApp.</p>
                </div>
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-brand-line bg-white"
                  onClick={() => window.open(`/toko/${shop?.slug}`, "_blank")}
                  data-testid="open-storefront-btn"
                >
                  <ExternalLink className="mr-2 h-4 w-4" /> Buka Toko
                </Button>
              </div>

              <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-brand-line bg-white p-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-xl bg-brand-off px-3 py-2 text-xs text-brand-mute">
                  {storefrontUrl}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(storefrontUrl); toast.success("Link toko disalin"); }}
                  className="inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-xs font-extrabold text-white hover:bg-brand-hover"
                  data-testid="copy-storefront-link"
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Salin Link
                </button>
              </div>
            </div>
          </div>

          {/* DAILY TIP — personalized AI/rule-based motivation */}
          <DailyTipCard />

          {/* SHARE HEALTH — live DNS + OG status, subdomain for Pro+ */}
          <ShareHealthCard shop={shop} />

          {/* SHARE PREVIEW — bagaimana link tampil di WhatsApp/IG/FB */}
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card" data-testid="share-preview-card">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="font-heading font-bold text-xl flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-brand" /> Pratinjau Saat Dibagikan
                </h2>
                <p className="text-brand-mute mt-1 text-sm">
                  Beginilah link tokomu akan muncul saat dikirim di WhatsApp, Instagram, atau Facebook.
                </p>
              </div>
            </div>
            {/* Mock chat bubble */}
            <div className="rounded-2xl bg-[#dcf8c6] p-3 max-w-md">
              <div className="bg-white rounded-xl overflow-hidden border border-black/5 shadow-sm">
                <div className="aspect-[1200/630] bg-brand-off">
                  <img src={ogImageUrl}
                    alt="Pratinjau share"
                    className="w-full h-full object-cover"
                    data-testid="share-preview-image"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
                <div className="p-3 border-t border-black/5">
                  <div className="text-[11px] uppercase text-gray-500 truncate">{window.location.host}</div>
                  <div className="font-semibold text-sm mt-0.5 line-clamp-1">{shop?.name} · Lapakin</div>
                  <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                    {shop?.tagline || shop?.description || "Toko online UMKM Indonesia di Lapakin."}
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-gray-500 mt-1 text-right">contoh tampilan</div>
            </div>

            {/* Share-aware URL field */}
            <div className="mt-4 rounded-xl bg-brand-off border border-brand-line p-3">
              <div className="text-[11px] uppercase font-bold tracking-wider text-brand-mute">Link Toko (untuk dibagikan)</div>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-xs sm:text-sm font-mono bg-white border border-brand-line rounded-lg px-2 py-2 truncate" data-testid="share-url-text">
                  {storefrontUrl}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(storefrontUrl); toast.success("Link disalin"); }}
                  className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-3 py-2 text-xs font-bold hover:bg-brand-dark"
                  data-testid="copy-share-link">
                  <Copy className="w-3.5 h-3.5" /> Salin
                </button>
              </div>
              <p className="text-[11px] text-brand-mute mt-2 leading-relaxed">
                ✨ Bagikan link ini ke WhatsApp/IG/FB — preview banner toko muncul otomatis (asal nginx config sudah di-setup di VPS).
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a href={ogImageUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-sm font-semibold"
                data-testid="download-og-image">
                <ExternalLink className="w-4 h-4" /> Lihat Gambar OG
              </a>
              <button
                onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Link alternatif disalin"); }}
                className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-sm font-semibold"
                data-testid="copy-storefront-direct"
                title="Untuk hosting yang BELUM punya nginx config — bypasses /toko prefix">
                <Copy className="w-4 h-4" /> Salin Link Alt (/api/og/shop/...)
              </button>
              <a href="https://developers.facebook.com/tools/debug/" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-sm font-semibold"
                data-testid="open-fb-debugger">
                <ExternalLink className="w-4 h-4" /> Refresh Cache FB/WA
              </a>
            </div>
            <p className="text-[11px] text-brand-mute mt-3 leading-relaxed">
              💡 Tips: Setelah ganti cover/tagline, klik <b>Refresh Cache FB/WA</b> → paste link toko → klik "Scrape Again" supaya WhatsApp ambil preview baru (cache mereka 1-7 hari).
            </p>
          </div>

          {/* Products preview */}
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-heading font-bold text-xl">Produk Terbaru</h2>
              <div className="flex items-center gap-3">

                <Link to="/dashboard/products" className="text-sm font-semibold text-brand hover:underline">Lihat semua</Link>
              </div>
            </div>
            {products.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-brand-line rounded-xl bg-brand-off/40">
                <p className="text-brand-mute">Belum ada produk.</p>
                <Button
                  className="mt-4 bg-brand text-white rounded-xl btn-press"
                  onClick={() => navigate("/dashboard/ai-studio")}
                  data-testid="empty-add-product-btn"
                >
                  <Plus className="w-4 h-4 mr-1" /> Tambah dengan AI
                </Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {products.slice(0, 4).map((p) => (
                  <div key={p.product_id} className="flex gap-3 p-3 rounded-xl border border-brand-line bg-brand-off/40">
                    <div className="w-16 h-16 rounded-lg bg-white border border-brand-line overflow-hidden grid place-items-center">
                      {p.image_data ? (
                        <img src={p.image_data.startsWith("data:") ? p.image_data : `data:image/png;base64,${p.image_data}`}
                          alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-5 h-5 text-brand-mute" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-sm text-brand-mute">{rupiah(p.price)} · stok {p.stock}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-card">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-mute">Aksi Cepat</p>
            <h3 className="mt-1 font-heading text-lg font-extrabold text-brand-ink">Mau kerjakan apa?</h3>

            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => navigate("/dashboard/ai-studio")}
                className="group flex items-center gap-3 rounded-2xl bg-brand p-3 text-left text-white shadow-sm transition hover:bg-brand-hover"
                data-testid="rail-ai-studio-btn"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
                  <Wand2 className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold">Tambah produk dengan AI</span>
                  <span className="block text-xs text-white/80">Foto, caption, dan copy produk.</span>
                </span>
                <Plus className="h-4 w-4 opacity-80" />
              </button>

              <button
                type="button"
                onClick={() => navigate("/dashboard/products")}
                className="flex items-center gap-3 rounded-2xl border border-brand-line bg-brand-off p-3 text-left transition hover:bg-white"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-brand">
                  <Package className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold text-brand-ink">Kelola produk</span>
                  <span className="block text-xs text-brand-mute">{products.length} produk di katalog.</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => navigate("/dashboard/settings?section=contact#contact")}
                className="flex items-center gap-3 rounded-2xl border border-brand-line bg-white p-3 text-left transition hover:bg-brand-off"
                data-testid="rail-order-contact-settings-btn"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-off text-brand">
                  <ShoppingBag className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold text-brand-ink">Order & Kontak</span>
                  <span className="block text-xs text-brand-mute">WA, pembayaran, pickup, delivery.</span>
                </span>
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-card">
            <h3 className="font-heading font-extrabold text-brand-ink">Checklist Toko</h3>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-2xl bg-brand-off px-3 py-2">
                <span className="font-semibold text-brand-ink">Produk</span>
                <span className="font-extrabold text-brand">{products.length}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-brand-off px-3 py-2">
                <span className="font-semibold text-brand-ink">Status toko</span>
                <span className={`font-extrabold ${isOpen ? "text-green-700" : "text-red-700"}`}>
                  {isOpen ? "Buka" : "Tutup"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-brand-off px-3 py-2">
                <span className="font-semibold text-brand-ink">Website</span>
                <span className="font-extrabold text-green-700">Online</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-card">
            <h3 className="font-heading font-extrabold text-brand-ink">Tips hari ini</h3>
            <p className="mt-2 text-sm leading-relaxed text-brand-mute">
              Foto dari atas dengan latar polos biasanya menghasilkan hasil AI yang lebih tajam dan konsisten.
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}



// LAPAKIN_AI_PREVIEW_REGENERATE_V2
function WebsiteAiPreviewPanel({ open, result, generating, applying, onClose, onRegenerate, onApply }) {
  if (!open || !result) return null;

  const generated = result.generated || {};
  const variantLabel = {
    food_warm_menu: "Makanan Hangat",
    laundry_clean_service: "Laundry Clean",
    fashion_visual_catalog: "Fashion Visual",
    service_trust_cta: "Jasa Profesional",
    craft_story_catalog: "Kerajinan Story",
  }[generated.storefront_layout_variant] || generated.storefront_layout_variant || "Auto detect";

  const storefrontUrl = result.storefront_url || (result.shop_slug ? `/toko/${result.shop_slug}` : "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6"
      data-testid="website-ai-preview-panel"
    >
      <div className="w-full max-w-2xl rounded-[2rem] border border-brand-line bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-mute">Website AI</p>
            <h2 className="mt-1 font-heading text-2xl font-extrabold text-brand-ink">
              {result.applied ? "Draft website AI berhasil diterapkan" : "Draft website AI siap direview"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-mute">
              {result.applied ? "Draft sudah diterapkan ke storefront aktif." : "Lapakin membuat draft dari variant stabil. Review dulu sebelum diterapkan ke storefront aktif."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-brand-line px-3 py-1 text-sm font-black text-brand-ink hover:bg-brand-off"
            aria-label="Tutup preview AI"
          >
            ×
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-brand-line bg-brand-off p-4">
            <p className="text-xs font-black uppercase tracking-wide text-brand-mute">Variant</p>
            <p className="mt-1 font-heading text-lg font-extrabold text-brand-ink">{variantLabel}</p>
          </div>

          <div className="rounded-2xl border border-brand-line bg-brand-off p-4">
            <p className="text-xs font-black uppercase tracking-wide text-brand-mute">Mode / Style</p>
            <p className="mt-1 font-heading text-lg font-extrabold text-brand-ink">
              {generated.storefront_mode || "-"} · {generated.storefront_style || "-"}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-brand-line bg-white p-4">
          <p className="text-xs font-black uppercase tracking-wide text-brand-mute">Hero website</p>
          <h3 className="mt-2 font-heading text-xl font-extrabold text-brand-ink">
            {generated.storefront_hero_title || "Hero title belum berubah"}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-brand-mute">
            {generated.storefront_hero_subtitle || "Subtitle belum berubah"}
          </p>
          <div className="mt-3 inline-flex rounded-full bg-brand px-4 py-2 text-sm font-black text-white">
            {generated.storefront_cta_label || "CTA"}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          {storefrontUrl ? (
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-xl border border-brand-line px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off"
            >
              Lihat Website
            </a>
          ) : null}

          {!result.applied ? (
            <button
              type="button"
              onClick={onApply}
              disabled={applying || generating}
              className="inline-flex rounded-xl bg-brand px-4 py-2 text-sm font-black text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="website-ai-apply-draft-btn"
            >
              {applying ? "Menerapkan..." : "Gunakan Draft Ini"}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onRegenerate}
            disabled={generating}
            className="inline-flex rounded-xl border border-brand-line px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="website-ai-regenerate-btn"
          >
            {generating ? "Membuat ulang..." : "Generate Ulang"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex rounded-xl bg-brand px-4 py-2 text-sm font-black text-white hover:opacity-90"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}

function ReadinessOverviewCard({ readiness, loading, onOpenAction, onGenerateWebsite, generatingWebsiteAi = false, onOpenChecklist }) {
  const readinessScore = getReadinessScoreValue(readiness);
  const canGenerateWebsite = canGenerateWebsiteFromReadiness(readiness);
  const score = Number(readiness?.score || 0);
  const assistantScore = Number(readiness?.assistant_score || 0);
  const nextAction = readiness?.next_best_action;

  const levelLabel = {
    excellent: "Siap dipromosikan",
    ready_for_ai: "Siap dibuat dengan AI",
    almost_ready: "Hampir siap",
    not_ready: "Belum siap",
  }[readiness?.level] || "Cek kesiapan toko";

  const topGroups = Array.isArray(readiness?.groups)
    ? readiness.groups.slice(0, 4)
    : [];

  if (loading) {
    return (
      <div className="mb-5 rounded-3xl border border-brand-line bg-white p-5 shadow-card">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-brand-off" />
          <div className="h-8 w-64 rounded bg-brand-off" />
          <div className="h-3 w-full rounded bg-brand-off" />
        </div>
      </div>
    );
  }

  if (!readiness) {
    return (
      <div className="mb-5 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">Kesiapan Toko</p>
            <h2 className="font-heading text-xl font-extrabold">Belum bisa membaca readiness</h2>
            <p className="mt-1 text-sm text-amber-800">
              Coba refresh halaman. Jika masih muncul, cek endpoint readiness backend.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenAction("/dashboard/settings")}
            className="rounded-xl bg-amber-900 px-4 py-2 text-sm font-extrabold text-white"
          >
            Buka Pengaturan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 overflow-hidden rounded-[2rem] border border-brand-line bg-white shadow-card" data-testid="dashboard-readiness-card">
      <div className="bg-gradient-to-br from-brand-off via-white to-brand-soft/30 p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-mute">Kesiapan Toko</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h2 className="font-heading text-2xl font-extrabold text-brand-ink">{score}%</h2>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-brand shadow-sm">
                {levelLabel}
              </span>
              <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-extrabold text-brand-mute shadow-sm">
                Asisten {assistantScore}%
              </span>
            </div>

            <div className="mt-3 h-3 overflow-hidden rounded-full bg-white ring-1 ring-brand-line">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${Math.max(3, Math.min(100, score))}%` }}
              />
            </div>

            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-brand-mute">
              {readiness.summary || "Lengkapi data toko agar website dan Lapakin Asisten bekerja maksimal."}
            </p>

            {nextAction && (
              <div className="mt-4 rounded-2xl border border-brand-line bg-white p-3">
                <p className="text-xs font-black uppercase tracking-wide text-brand-mute">Langkah berikutnya</p>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-extrabold text-brand-ink">{nextAction.title}</p>
                    {nextAction.description && (
                      <p className="mt-0.5 text-xs leading-relaxed text-brand-mute">{nextAction.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenAction(nextAction.href)}
                    className="shrink-0 rounded-xl border border-brand-line bg-brand-off px-4 py-2 text-xs font-extrabold text-brand-ink hover:bg-white"
                    data-testid="readiness-next-action-btn"
                  >
                    {nextAction.label || "Lengkapi"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="w-full rounded-3xl border border-brand-line bg-white p-4 shadow-sm lg:w-[320px]">
            <div className="grid grid-cols-2 gap-2">
              {topGroups.map((group) => (
                <div key={group.key} className="rounded-2xl bg-brand-off p-3">
                  <p className="truncate text-[11px] font-black uppercase tracking-wide text-brand-mute">
                    {group.title}
                  </p>
                  <p className="mt-1 text-lg font-extrabold text-brand-ink">{group.score}%</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => nextAction ? onOpenAction(nextAction.href) : onOpenAction("/dashboard/settings")}
                  className="h-11 rounded-2xl border border-brand-line bg-white px-4 text-sm font-extrabold text-brand-ink hover:bg-brand-off"
                  data-testid="readiness-complete-btn"
                >
                  Lengkapi
                </button>

                <button
                  type="button"
                  onClick={onOpenChecklist}
                  className="h-11 rounded-2xl border border-brand-line bg-brand-off px-4 text-sm font-extrabold text-brand-ink hover:bg-white"
                  data-testid="readiness-checklist-btn"
                >
                  Checklist
                </button>
              </div>

              <button
                type="button"
                onClick={canGenerateWebsite ? onGenerateWebsite : () => onOpenAction(nextAction?.href || "/dashboard/settings")}
                disabled={generatingWebsiteAi}
                className={`h-11 rounded-2xl px-4 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-70 ${
                  canGenerateWebsite
                    ? "bg-brand hover:bg-brand-hover"
                    : "bg-brand-mute/70 hover:bg-brand-mute"
                }`}
                data-testid="readiness-generate-website-btn"
              >
                {generatingWebsiteAi
                  ? "Membuat draft..."
                  : canGenerateWebsite
                    ? "Buat Website dengan AI"
                    : "Lengkapi sebelum buat website"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



function ReadinessDetailPanel({ open, readiness, onClose, onOpenAction }) {
  if (!open) return null;

  const groups = Array.isArray(readiness?.groups) ? readiness.groups : [];
  const score = Number(readiness?.score || 0);
  const assistantScore = Number(readiness?.assistant_score || 0);
  const todoItems = groups
    .flatMap((group) =>
      (Array.isArray(group.items) ? group.items : [])
        .filter((item) => item?.status !== "done")
        .map((item) => ({ ...item, groupTitle: group.title }))
    )
    .slice(0, 8);

  const doneItemsCount = groups.reduce((sum, group) => {
    const items = Array.isArray(group.items) ? group.items : [];
    return sum + items.filter((item) => item?.status === "done").length;
  }, 0);

  const totalItemsCount = groups.reduce((sum, group) => {
    const items = Array.isArray(group.items) ? group.items : [];
    return sum + items.length;
  }, 0);

  const levelLabel = {
    excellent: "Siap dipromosikan",
    ready_for_ai: "Siap dibuat dengan AI",
    almost_ready: "Hampir siap",
    not_ready: "Belum siap",
  }[readiness?.level] || "Cek kesiapan toko";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-brand-ink/35 px-3 py-4 backdrop-blur-sm sm:items-center"
      data-testid="readiness-detail-panel"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Tutup checklist readiness"
      />

      <div className="relative max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-[2rem] border border-brand-line bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-brand-line bg-gradient-to-br from-brand-off via-white to-brand-soft/30 p-5 sm:p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-mute">Checklist Kesiapan</p>
            <h2 className="mt-1 font-heading text-2xl font-extrabold text-brand-ink">Kesiapan Toko Kamu</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-brand-mute">
              Lengkapi data penting agar website, checkout, dan Lapakin Asisten punya informasi yang cukup untuk membantu pelanggan.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-brand-line bg-white text-xl font-black text-brand-mute hover:bg-brand-off"
            aria-label="Tutup"
            data-testid="readiness-detail-close-btn"
          >
            ×
          </button>
        </div>

        <div className="max-h-[calc(88vh-112px)] overflow-y-auto p-5 sm:p-6">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-3xl border border-brand-line bg-brand-off p-4">
              <p className="text-xs font-black uppercase tracking-wide text-brand-mute">Website</p>
              <p className="mt-1 font-heading text-3xl font-extrabold text-brand-ink">{score}%</p>
              <p className="mt-1 text-sm font-bold text-brand">{levelLabel}</p>
            </div>

            <div className="rounded-3xl border border-brand-line bg-white p-4">
              <p className="text-xs font-black uppercase tracking-wide text-brand-mute">Lapakin Asisten</p>
              <p className="mt-1 font-heading text-3xl font-extrabold text-brand-ink">{assistantScore}%</p>
              <p className="mt-1 text-sm text-brand-mute">Data untuk jawaban bot.</p>
            </div>

            <div className="rounded-3xl border border-brand-line bg-white p-4">
              <p className="text-xs font-black uppercase tracking-wide text-brand-mute">Checklist</p>
              <p className="mt-1 font-heading text-3xl font-extrabold text-brand-ink">
                {doneItemsCount}/{totalItemsCount}
              </p>
              <p className="mt-1 text-sm text-brand-mute">Item sudah lengkap.</p>
            </div>
          </div>

          {todoItems.length > 0 ? (
            <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-amber-800">Prioritas berikutnya</p>
                  <h3 className="mt-1 font-heading text-lg font-extrabold text-amber-950">Lengkapi item yang masih kosong</h3>
                </div>
                {readiness?.next_best_action ? (
                  <button
                    type="button"
                    onClick={() => onOpenAction(readiness.next_best_action.href)}
                    className="rounded-2xl bg-amber-900 px-4 py-2 text-sm font-extrabold text-white hover:bg-amber-950"
                    data-testid="readiness-detail-next-action-btn"
                  >
                    {readiness.next_best_action.label || "Lengkapi Sekarang"}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-2">
                {todoItems.map((item) => (
                  <div
                    key={`${item.groupTitle}-${item.key}`}
                    className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-extrabold text-brand-ink">{item.label}</p>
                      <p className="mt-0.5 text-xs text-brand-mute">
                        {item.groupTitle}{item.description ? ` · ${item.description}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenAction(item.href)}
                      className="shrink-0 rounded-xl border border-brand-line bg-brand-off px-3 py-2 text-xs font-extrabold text-brand-ink hover:bg-white"
                    >
                      {item.action_label || "Lengkapi"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-3xl border border-green-200 bg-green-50 p-4">
              <p className="font-heading text-lg font-extrabold text-green-900">Semua checklist utama sudah lengkap 🎉</p>
              <p className="mt-1 text-sm text-green-800">
                Toko sudah punya data yang cukup untuk website dan Lapakin Asisten.
              </p>
            </div>
          )}

          <div className="mt-5 grid gap-3">
            {groups.map((group) => {
              const items = Array.isArray(group.items) ? group.items : [];
              const groupScore = Number(group.score || 0);

              return (
                <section key={group.key} className="rounded-3xl border border-brand-line bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="font-heading text-lg font-extrabold text-brand-ink">{group.title}</h3>
                      {group.description ? (
                        <p className="mt-1 text-sm text-brand-mute">{group.description}</p>
                      ) : null}
                    </div>
                    <span className="w-fit rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold text-brand-ink">
                      {groupScore}%
                    </span>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-off">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${Math.max(3, Math.min(100, groupScore))}%` }}
                    />
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {items.map((item) => {
                      const done = item.status === "done";
                      return (
                        <div
                          key={item.key}
                          className={`rounded-2xl border p-3 ${
                            done
                              ? "border-green-200 bg-green-50"
                              : "border-brand-line bg-brand-off/50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-extrabold text-brand-ink">
                                {done ? "✓ " : ""}{item.label}
                              </p>
                              {item.description ? (
                                <p className="mt-0.5 text-xs leading-relaxed text-brand-mute">{item.description}</p>
                              ) : null}
                            </div>
                            {!done ? (
                              <button
                                type="button"
                                onClick={() => onOpenAction(item.href)}
                                className="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-extrabold text-brand shadow-sm hover:bg-brand-off"
                              >
                                {item.action_label || "Lengkapi"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


function StatCard({ label, value, icon, tid }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-brand-line bg-white p-4 shadow-card card-hover" data-testid={tid}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-off text-brand">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-mute">{label}</div>
        <div className="mt-0.5 truncate font-heading text-lg font-extrabold text-brand-ink">{value}</div>
      </div>
    </div>
  );
}
