import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Check, X, Sparkles, Store, Zap, Rocket, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

const ICONS = { free: Sparkles, starter: Store, pro: Zap, business: Rocket };

const FEATURE_ROWS = [
  { key: "max_products", label: "Maksimal produk", format: "count" },
  { key: "sales_entries_per_month", label: "Buku Jualan / bulan", format: "count" },
  { key: "ai_photo_per_month", label: "AI Photo Enhancer (per bulan)", format: "count" },
  { key: "ai_copy_per_month", label: "AI Copywriting (per bulan)", format: "count" },
  { key: "ai_cover_per_month", label: "AI Cover Toko (per bulan)", format: "count" },
  { key: "toko_card_per_month", label: "Toko Cards (IG Post + Story)", format: "count" },
  { key: "max_users_per_shop", label: "Anggota tim", format: "count" },
  { key: "max_shops_per_user", label: "Multi-toko/cabang", format: "count" },
  { key: "remove_branding", label: 'Hapus "Powered by Lapakin"', format: "bool" },
  { key: "custom_subdomain", label: "Custom subdomain (nama.lapakin.my.id)", format: "bool" },
  { key: "custom_domain", label: "Custom domain sendiri (mis. tokokamu.com)", format: "bool" },
  { key: "multi_shift_schedule", label: "Multi-shift schedule (buka 11-14, 17-22)", format: "bool" },
  { key: "broadcast_per_month", label: "WhatsApp broadcast", format: "count" },
  { key: "instagram_autopost", label: "Auto-post Instagram", format: "bool" },
  { key: "csv_export", label: "Export CSV/Excel", format: "bool" },
  { key: "api_access", label: "API access", format: "bool" },
  { key: "analytics", label: "Analytics storefront", format: "bool" },
  { key: "priority_support", label: "Priority support", format: "bool" },
];

export default function Pricing() {
  const [tiers, setTiers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [annual, setAnnual] = useState(false);
  const [me, setMe] = useState(null);
  const [payingPlan, setPayingPlan] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/billing/tiers").then((r) => setTiers(r.data.tiers)).finally(() => setLoading(false));
    api.get("/auth/me").then((r) => setMe(r.data)).catch(() => setMe(null));
    // Support deep-link /pricing#comparison → scroll to table after load
    if (window.location.hash === "#comparison") {
      setTimeout(() => {
        document.getElementById("comparison")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, []);

  const handleUpgrade = async (tierKey) => {
    if (tierKey === "free") {
      navigate(me ? "/dashboard" : "/register");
      return;
    }

    if (!me) {
      navigate(`/login?next=/pricing`);
      return;
    }

    const currentTier = me?.tier || "free";
    const isTrialActive = currentTier === "pro" && me?.trial;
    const canStartProTrial = tierKey === "pro" && currentTier === "free" && !me?.trial_used;

    if (canStartProTrial) {
      setPayingPlan("pro_trial");

      try {
        await api.post("/payment/start-pro-trial");
        toast.success("Trial Pro aktif 10 hari. Selamat mencoba fitur Pro!");
        setTimeout(() => navigate("/dashboard?trial=pro"), 500);
      } catch (err) {
        toast.error(
          err?.response?.data?.detail ||
            "Gagal memulai trial Pro. Coba lagi sebentar."
        );
      } finally {
        setPayingPlan(null);
      }

      return;
    }

    if (tierKey === "pro" && isTrialActive) {
      navigate("/dashboard/analytics");
      return;
    }

    if (currentTier === tierKey && !me?.trial) {
      toast("Paket ini sudah aktif di akun kamu.");
      navigate("/dashboard/billing");
      return;
    }

    toast(
      "Pembayaran online sedang disiapkan. Untuk sementara, aktivasi paket bisa dilakukan manual."
    );
    navigate("/dashboard/billing");
  };

  const getButtonLabel = (key, tier) => {
    const currentTier = me?.tier || "free";
    const isLoading = payingPlan === `${key}_${annual ? "yearly" : "monthly"}` || payingPlan === "pro_trial";

    if (isLoading && key === "pro") {
      return (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Mengaktifkan Trial…
        </span>
      );
    }

    if (key === "free") {
      return me ? "Buka Dashboard" : "Mulai Gratis";
    }

    if (key === "pro" && currentTier === "free" && !me?.trial_used) {
      return "Coba Pro Gratis 10 Hari";
    }

    if (key === "pro" && currentTier === "pro" && me?.trial) {
      return "Trial Pro Aktif";
    }

    if (currentTier === key && !me?.trial) {
      return "Paket Aktif";
    }

    return "Upgrade ke " + tier.label;
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-brand-mute">Memuat tier…</div>;

  const renderValue = (tier, row) => {
    const v = tier[row.key];
    if (row.format === "bool") return v ? (
      <Check className="w-5 h-5 text-green-600 mx-auto" />
    ) : (
      <X className="w-5 h-5 text-brand-mute/50 mx-auto" />
    );
    if (v === -1) return <span className="text-green-700 font-bold">Unlimited</span>;
    return <span className="font-semibold">{v}</span>;
  };

  return (
    <div className="min-h-screen bg-brand-sand">
      <header className="bg-white border-b border-brand-line">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="font-heading font-extrabold text-xl flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Lapakin
          </Link>
          <div className="flex gap-2">
            <Button onClick={() => navigate("/login")} variant="outline" className="rounded-xl border-brand-line">Masuk</Button>
            <Button onClick={() => navigate("/register")} className="rounded-xl bg-brand text-white">Daftar Gratis</Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="font-heading font-extrabold text-4xl sm:text-5xl">Pilih Paket Tokomu</h1>
          <p className="text-brand-mute mt-3 max-w-2xl mx-auto">
            Mulai gratis, upgrade kapan pun saat tokomu sudah ramai. Tidak ada kontrak, batalkan kapan saja.
          </p>
          <div className="inline-flex mt-6 rounded-full bg-white border border-brand-line p-1">
            <button onClick={() => setAnnual(false)}
              className={`px-4 py-2 rounded-full text-sm font-bold ${!annual ? "bg-brand text-white" : "text-brand-mute"}`}
              data-testid="period-month">
              Bulanan
            </button>
            <button onClick={() => setAnnual(true)}
              className={`px-4 py-2 rounded-full text-sm font-bold ${annual ? "bg-brand text-white" : "text-brand-mute"}`}
              data-testid="period-year">
              Tahunan <span className="text-[10px] ml-1 bg-yellow-300 text-yellow-900 rounded-full px-1.5 py-0.5">Hemat 2 bulan</span>
            </button>
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
          {Object.entries(tiers).map(([key, t]) => {
            const Icon = ICONS[key] || Sparkles;
            const isPro = key === "pro";
            const price = annual ? t.price_idr_year : t.price_idr_month;
            const periodLabel = annual ? "/tahun" : "/bulan";
            return (
              <div key={key}
                className={`relative bg-white rounded-2xl border-2 p-6 ${isPro ? "border-brand shadow-xl scale-105" : "border-brand-line shadow-card"}`}
                data-testid={`tier-card-${key}`}>
                {isPro && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand text-white text-xs font-bold rounded-full px-3 py-1 shadow-md">
                    PALING POPULER
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl grid place-items-center ${isPro ? "bg-brand text-white" : "bg-brand-off text-brand"}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-heading font-bold text-2xl">{t.label}</h2>
                  </div>
                </div>
                <div className="mt-5">
                  {price === 0 ? (
                    <div className="font-heading font-extrabold text-4xl">Gratis</div>
                  ) : (
                    <div>
                      <span className="font-heading font-extrabold text-4xl">Rp {price.toLocaleString("id-ID")}</span>
                      <span className="text-brand-mute text-sm">{periodLabel}</span>
                    </div>
                  )}
                  {annual && price > 0 && (
                    <p className="text-xs text-green-700 mt-1">
                      Hemat Rp {(t.price_idr_month * 12 - t.price_idr_year).toLocaleString("id-ID")} / tahun
                    </p>
                  )}
                </div>
                <Button
                  className={`w-full rounded-xl mt-5 h-12 font-bold ${
                    isPro
                    ? "bg-brand text-white"
                    : key === "free"
                    ? "bg-brand-off border border-brand-line text-brand-ink"
                    : "bg-brand-ink text-white"
                  }`}
                  onClick={() => handleUpgrade(key)}
                  disabled={payingPlan === "pro_trial"}
                  data-testid={`select-tier-${key}`}
                >
                  {getButtonLabel(key, t)}
                </Button>

                {key === "pro" && (me?.tier || "free") === "free" && !me?.trial_used && (
                  <p className="mt-2 text-center text-xs text-brand-mute">
                    Trial 10 hari, tidak perlu pembayaran dulu.
                  </p>
                )}

                {key === "pro" && me?.tier === "pro" && me?.trial && me?.trial_expires_at && (
                  <p className="mt-2 text-center text-xs text-green-700 font-semibold">
                    Trial aktif sampai{" "}
                    {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
                      new Date(me.trial_expires_at)
                    )}
                  </p>
                )}

                {/* Quick feature bullets */}
                <ul className="mt-6 space-y-2 text-sm">
                  {[
                    `${t.max_products === -1 ? "Produk unlimited" : `Sampai ${t.max_products} produk`}`,
                    `${t.ai_photo_per_month === -1 ? "AI photo unlimited" : `${t.ai_photo_per_month} AI photo/bulan`}`,
                    `${t.ai_copy_per_month === -1 ? "AI copy unlimited" : `${t.ai_copy_per_month} AI copy/bulan`}`,
                    t.remove_branding ? "Tanpa 'Powered by Lapakin'" : null,
                    t.custom_subdomain ? "Custom subdomain" : null,
                    t.instagram_autopost ? "Auto-post Instagram" : null,
                    t.api_access ? "API access" : null,
                  ].filter(Boolean).map((line, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Detailed comparison table */}
        <div id="comparison" className="bg-white rounded-2xl border border-brand-line shadow-card overflow-x-auto scroll-mt-24" data-testid="tier-comparison-table">
          <h2 className="font-heading font-bold text-2xl p-6 pb-3">Perbandingan Lengkap</h2>
          <table className="w-full text-sm">
            <thead className="bg-brand-off border-y border-brand-line">
              <tr>
                <th className="text-left p-4 font-bold">Fitur</th>
                {Object.entries(tiers).map(([k, t]) => (
                  <th key={k} className="p-4 font-bold text-center min-w-[120px]">{t.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row, i) => (
                <tr key={row.key} className={i % 2 === 0 ? "bg-white" : "bg-brand-off/30"}>
                  <td className="p-4 font-semibold">{row.label}</td>
                  {Object.entries(tiers).map(([k, t]) => (
                    <td key={k} className="p-4 text-center">{renderValue(t, row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-center mt-10 text-sm text-brand-mute">
          Punya pertanyaan? Hubungi tim Lapakin di <a href="https://wa.me/628123456789" className="text-brand font-semibold hover:underline">Order & Kontak</a>.
        </div>
      </main>
    </div>
  );
}
