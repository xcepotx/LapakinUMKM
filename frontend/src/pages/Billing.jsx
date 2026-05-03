import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Sparkles, Store, Zap, Rocket, Check, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const TIER_ICON = { free: Sparkles, starter: Store, pro: Zap, business: Rocket };
const TIER_COLOR = {
  free: "bg-brand-off text-brand-ink border-brand-line",
  starter: "bg-emerald-50 text-emerald-900 border-emerald-300",
  pro: "bg-yellow-50 text-yellow-900 border-yellow-300",
  business: "bg-purple-50 text-purple-900 border-purple-300",
};

function UsageBar({ label, used, limit }) {
  const isUnlimited = limit === "unlimited";
  const pct = isUnlimited ? 0 : (limit > 0 ? Math.min(100, (used / limit) * 100) : 0);
  const danger = !isUnlimited && pct >= 80;
  return (
    <div className="rounded-xl bg-white border border-brand-line p-4" data-testid={`usage-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className={`font-mono text-xs ${danger ? "text-red-700" : "text-brand-mute"}`}>
          {used}{isUnlimited ? "" : ` / ${limit}`}{isUnlimited && " (unlimited)"}
        </span>
      </div>
      {!isUnlimited && (
        <div className="mt-2 h-2 rounded-full bg-brand-off overflow-hidden">
          <div
            className={`h-full ${danger ? "bg-red-500" : "bg-brand"} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {isUnlimited && (
        <div className="mt-2 text-xs text-green-700 font-semibold">∞ Unlimited di tier ini</div>
      )}
    </div>
  );
}

export default function Billing() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [paying, setPaying] = useState(null);
  const [me, setMe] = useState(null);
  const navigate = useNavigate();

  const refresh = async () => {
    try {
      const r = await api.get("/billing/me");
      setData(r.data);
    } catch (err) {
      toast.error(
        err?.response?.data?.detail ||
          "Gagal memuat data billing. Coba login ulang."
      );
      setData(null);
      return;
    }

    try {
      const meRes = await api.get("/auth/me");
      setMe(meRes.data);
    } catch {
      setMe(null);
    }

    try {
      const h = await api.get("/payment/history");
      setHistory(h.data || []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const handleUpgrade = async (plan_id) => {
    const currentTier = me?.tier || data?.tier || "free";
    const isProPlan = plan_id.startsWith("pro_");
    const canStartProTrial =
      isProPlan &&
      currentTier === "free" &&
      !me?.trial_used;

    if (canStartProTrial) {
      setPaying("pro_trial");

      try {
        await api.post("/payment/start-pro-trial");
        toast.success("Trial Pro aktif 10 hari. Selamat mencoba fitur Pro!");
        await refresh();
        setTimeout(() => navigate("/dashboard?trial=pro"), 500);
      } catch (err) {
        toast.error(
          err?.response?.data?.detail ||
            "Gagal memulai trial Pro. Coba lagi sebentar."
        );
      } finally {
        setPaying(null);
      }

      return;
    }

    const message =
      plan_id.startsWith("business_")
        ? "Halo Lapakin, saya mau aktivasi paket Bisnis."
        : plan_id.startsWith("starter_")
        ? "Halo Lapakin, saya mau aktivasi paket Starter."
        : "Halo Lapakin, saya mau aktivasi paket Pro.";

    toast("Pembayaran online sedang disiapkan. Untuk sementara aktivasi dilakukan manual.");

    window.open(
      `https://wa.me/628123456789?text=${encodeURIComponent(message)}`,
      "_blank"
    );
  };

  const getUpgradeButtonLabel = (plan_id) => {
    const currentTier = me?.tier || data?.tier || "free";
    const isProPlan = plan_id.startsWith("pro_");

    if (paying === "pro_trial" && isProPlan) {
      return (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Mengaktifkan Trial…
        </span>
      );
    }

    if (canUseTrialForPlan(plan_id)) {
      return "Mulai Trial Pro";
    }

    if (isProPlan && currentTier === "pro" && me?.trial) {
      return "Aktivasi Pro Manual";
    }

    if (plan_id.startsWith("business_")) {
      return "Hubungi Admin";
    }

    return "Upgrade Manual";
  };

const canUseTrialForPlan = (plan_id) => {
  const currentTier = me?.tier || data?.tier || "free";
  return plan_id.startsWith("pro_") && currentTier === "free" && !me?.trial_used;
};

  if (loading) return (
    <DashboardLayout>
      <div className="text-brand-mute" data-testid="billing-loading">
        Memuat data tier…
      </div>
    </DashboardLayout>
  );

  if (!data) return (
    <DashboardLayout>
      <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
        <h1 className="font-heading font-extrabold text-2xl">
          Gagal memuat Akun & Tier
        </h1>
        <p className="text-brand-mute mt-2">
          Data billing belum berhasil dimuat. Coba refresh halaman atau login ulang.
        </p>
        <Button
          onClick={() => window.location.reload()}
          className="mt-4 bg-brand text-white font-bold rounded-xl"
        >
          Refresh
        </Button>
      </div>
    </DashboardLayout>
  );

  const Icon = TIER_ICON[data.tier] || Sparkles;

  return (
    <DashboardLayout>
      <div className="max-w-3xl">
        <h1 className="font-heading font-extrabold text-3xl">Akun & Tier</h1>
        <p className="text-brand-mute mt-1">
          Lihat tier kamu sekarang & penggunaan kuota bulan ini.
        </p>

        {/* Current tier card */}
        <div className={`mt-6 rounded-2xl border-2 p-6 ${TIER_COLOR[data.tier] || TIER_COLOR.free}`}
          data-testid="current-tier-card">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-white grid place-items-center shadow-md">
              <Icon className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider font-bold opacity-70">Tier Kamu Sekarang</div>
              <div className="font-heading font-extrabold text-3xl flex items-center gap-2">
                {data.tier_label}
                {data.trial && (
                  <span className="text-xs bg-yellow-400 text-yellow-900 rounded-full px-2 py-0.5 font-bold" data-testid="trial-badge">
                    TRIAL
                  </span>
                )}
              </div>
              {data.trial && data.trial_expires_at ? (
                <div className="text-sm mt-0.5" data-testid="trial-expires">
                  Trial gratis berakhir {new Date(data.trial_expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                </div>
              ) : data.trial_expired ? (
                <div className="text-sm mt-0.5 text-orange-800 font-semibold" data-testid="trial-expired">
	          Trial Pro sudah berakhir. Akun kembali ke paket Gratis.
                </div>
              ) : data.limits.price_idr_month > 0 ? (
                <div className="text-sm mt-0.5">Rp {data.limits.price_idr_month.toLocaleString("id-ID")}/bulan</div>
              ) : (
                <div className="text-sm mt-0.5">Gratis selamanya</div>
              )}
                <div className="text-sm mt-0.5">Rp {data.limits.price_idr_month.toLocaleString("id-ID")}/bulan</div>
              ) : (
                <div className="text-sm mt-0.5">Gratis selamanya</div>
              )}
            </div>
            {data.tier !== "business" && (
              <Button
                onClick={() =>
                  data.tier === "free" && !me?.trial_used
                  ? handleUpgrade("pro_monthly")
                  : navigate("/pricing")
                }
                className="bg-brand text-white font-bold rounded-xl h-12 px-6"
                data-testid="upgrade-cta"
              >
                {data.tier === "free" && !me?.trial_used
                ? "Mulai Trial Pro"
                : "Upgrade →"}
              </Button>
            )}
          </div>
        </div>

        {data.trial_expired && (
          <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
            <div className="font-bold">Trial Pro sudah selesai</div>
            <p className="mt-1">
              Kamu masih bisa memakai fitur Gratis. Untuk membuka kembali fitur Pro, aktivasi paket bisa dilakukan manual dulu via WhatsApp.
            </p>
            <a
              href="https://wa.me/628123456789?text=Halo%20Lapakin%2C%20saya%20mau%20aktivasi%20paket%20Pro."
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex rounded-xl bg-orange-900 px-4 py-2 font-bold text-white hover:opacity-90"
            >
              Aktivasi Pro Manual
            </a>
          </div>
        )}

        {/* Usage bars */}
        <div className="mt-8">
          <h2 className="font-heading font-bold text-xl">Penggunaan bulan ini ({data.year_month})</h2>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <UsageBar label="Produk" used={data.products.used} limit={data.products.limit} />
            <UsageBar label="AI Photo Enhancer" used={data.usage.ai_photo.used} limit={data.usage.ai_photo.limit} />
            <UsageBar label="AI Copywriting" used={data.usage.ai_copy.used} limit={data.usage.ai_copy.limit} />
            <UsageBar label="AI Cover Toko" used={data.usage.ai_cover.used} limit={data.usage.ai_cover.limit} />
          </div>
        </div>

        {/* Feature highlights */}
        <div className="mt-8 bg-white rounded-2xl border border-brand-line p-6 shadow-card">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="font-heading font-bold text-xl">Fitur Aktif di Tier {data.tier_label}</h2>
            <Link
              to="/pricing#comparison"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline shrink-0"
              data-testid="compare-plans-link">
              Bandingkan Semua Paket <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              { key: "remove_branding", label: 'Tanpa "Powered by Lapakin"' },
              { key: "custom_subdomain", label: "Custom subdomain" },
              { key: "custom_domain", label: "Custom domain sendiri" },
              { key: "multi_shift_schedule", label: "Multi-shift schedule" },
              { key: "instagram_autopost", label: "Auto-post Instagram" },
              { key: "csv_export", label: "Export CSV/Excel" },
              { key: "api_access", label: "API access" },
              { key: "analytics", label: "Analytics storefront" },
              { key: "priority_support", label: "Priority support" },
            ].map((f) => {
              const enabled = data.limits[f.key];
              return (
                <div key={f.key} className={`flex items-center gap-2 text-sm ${enabled ? "" : "opacity-40"}`}>
                  <Check className={`w-4 h-4 ${enabled ? "text-green-600" : "text-brand-mute"}`} />
                  <span>{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 bg-white rounded-2xl border border-brand-line p-6 shadow-card">
          <h2 className="font-heading font-bold text-xl">Upgrade Tier</h2>
          <p className="text-brand-mute text-sm mt-1">
            Pilih paket yang pas buat tokomu. Untuk sementara, pembayaran online sedang disiapkan. Kamu bisa mulai trial Pro atau aktivasi manual via WhatsApp.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {[
              {
                plan_id: "starter_monthly",
                label: "Starter — Bulanan",
                price: 19000,
                suffix: "/bulan",
                show: data.tier === "free",
              },
              {
                plan_id: "starter_yearly",
                label: "Starter — Tahunan 🎁",
                price: 190000,
                suffix: "/tahun (hemat 2 bln)",
                show: data.tier === "free",
              },
              {
                plan_id: "pro_monthly",
                label: "Pro — Bulanan",
                price: 49000,
                suffix: "/bulan",
                show: data.tier === "free" || data.tier === "starter" || (data.tier === "pro" && data.trial),
              },
              {
                plan_id: "pro_yearly",
                label: "Pro — Tahunan 🎁",
                price: 490000,
                suffix: "/tahun (hemat 2 bln)",
                show: data.tier === "free" || data.tier === "starter" || (data.tier === "pro" && data.trial),
              },
              {
                plan_id: "business_monthly",
                label: "Bisnis — Bulanan",
                price: 149000,
                suffix: "/bulan",
                show: data.tier !== "business",
              },
              {
                plan_id: "business_yearly",
                label: "Bisnis — Tahunan 🎁",
                price: 1490000,
                suffix: "/tahun (hemat 2 bln)",
                show: data.tier !== "business",
              },
             ].filter((p) => p.show).map((p) => (
              <div key={p.plan_id} className="rounded-xl border border-brand-line bg-brand-off/40 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">{p.label}</div>
                  <div className="text-sm text-brand-mute">Rp {p.price.toLocaleString("id-ID")}<span className="text-xs">{p.suffix}</span></div>
                </div>
                <Button
                  onClick={() => handleUpgrade(p.plan_id)}
                  disabled={paying === "pro_trial"}
                  className="bg-brand text-white font-bold rounded-xl h-11 px-5 shrink-0"
                  data-testid={`upgrade-btn-${p.plan_id}`}
                >
                  {getUpgradeButtonLabel(p.plan_id)}
                </Button>
              </div>
            ))}
          </div>
          <div className="text-xs text-brand-mute mt-3">
            Pembayaran online via <b>Midtrans</b> sedang disiapkan. Sementara ini aktivasi paket dilakukan manual oleh tim Lapakin.
          </div>
        </div>

        {history.length > 0 && (
          <div className="mt-8 bg-white rounded-2xl border border-brand-line p-6 shadow-card" data-testid="payment-history">
            <h2 className="font-heading font-bold text-xl mb-3">Riwayat Pembayaran</h2>
            <div className="divide-y divide-brand-line text-sm">
              {history.map((h) => {
                const statusColor = h.status === "success" ? "text-green-700 bg-green-100"
                  : h.status === "failed" ? "text-red-700 bg-red-100"
                  : h.status === "refunded" ? "text-orange-700 bg-orange-100"
                  : "text-yellow-800 bg-yellow-100";
                return (
                  <div key={h.order_id} className="py-3 flex items-center justify-between gap-3" data-testid={`payment-${h.order_id}`}>
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-brand-mute truncate">{h.order_id}</div>
                      <div className="font-semibold">
                        {h.plan_id} · Rp {(h.amount || 0).toLocaleString("id-ID")}
                      </div>
                      <div className="text-xs text-brand-mute">
                        {new Date(h.created_at).toLocaleString("id-ID")}
                        {h.payment_type ? ` · ${h.payment_type}` : ""}
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${statusColor}`}>
                      {h.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
