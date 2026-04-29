import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Sparkles, Zap, Rocket, Check, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { openSnapCheckout, pollPaymentStatus } from "@/lib/midtransSnap";

const TIER_ICON = { free: Sparkles, pro: Zap, business: Rocket };
const TIER_COLOR = {
  free: "bg-brand-off text-brand-ink border-brand-line",
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

  const refresh = async () => {
    const r = await api.get("/billing/me");
    setData(r.data);
    try {
      const h = await api.get("/payment/history");
      setHistory(h.data || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const handleUpgrade = async (plan_id) => {
    setPaying(plan_id);
    try {
      await openSnapCheckout(plan_id, {
        onSuccess: async (_r, order_id) => {
          toast.success("Pembayaran sukses! Mengaktifkan tier...");
          await pollPaymentStatus(order_id, { maxAttempts: 15, interval: 2000 });
          await refresh();
        },
        onPending: () => toast("Menunggu konfirmasi pembayaran..."),
        onError:   () => toast.error("Pembayaran gagal."),
        onClose:   () => refresh(),
      });
    } catch (err) {
      toast.error(err?.response?.data?.detail || err.message || "Gagal mulai pembayaran");
    } finally {
      setPaying(null);
    }
  };

  if (loading) return (
    <DashboardLayout>
      <div className="text-brand-mute" data-testid="billing-loading">Memuat data tier…</div>
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
              ) : data.limits.price_idr_month > 0 ? (
                <div className="text-sm mt-0.5">Rp {data.limits.price_idr_month.toLocaleString("id-ID")}/bulan</div>
              ) : (
                <div className="text-sm mt-0.5">Gratis selamanya</div>
              )}
            </div>
            {data.tier !== "business" && (
              <Link to="/pricing">
                <Button className="bg-brand text-white font-bold rounded-xl h-12 px-6"
                  data-testid="upgrade-cta">
                  Upgrade →
                </Button>
              </Link>
            )}
          </div>
        </div>

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
            Pilih paket yang pas buat tokomu. Bayar pakai QRIS, GoPay, OVO, DANA, ShopeePay, transfer bank, atau kartu kredit.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {[
              { plan_id: "pro_monthly",      label: "Pro — Bulanan",     price: 49000,   suffix: "/bulan", show: data.tier === "free" },
              { plan_id: "pro_yearly",       label: "Pro — Tahunan 🎁",  price: 490000,  suffix: "/tahun (hemat 2 bln)", show: data.tier === "free" },
              { plan_id: "business_monthly", label: "Bisnis — Bulanan",  price: 149000,  suffix: "/bulan", show: data.tier !== "business" },
              { plan_id: "business_yearly",  label: "Bisnis — Tahunan 🎁", price: 1490000, suffix: "/tahun (hemat 2 bln)", show: data.tier !== "business" },
            ].filter((p) => p.show).map((p) => (
              <div key={p.plan_id} className="rounded-xl border border-brand-line bg-brand-off/40 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">{p.label}</div>
                  <div className="text-sm text-brand-mute">Rp {p.price.toLocaleString("id-ID")}<span className="text-xs">{p.suffix}</span></div>
                </div>
                <Button
                  onClick={() => handleUpgrade(p.plan_id)}
                  disabled={paying === p.plan_id}
                  className="bg-brand text-white font-bold rounded-xl h-11 px-5 shrink-0"
                  data-testid={`upgrade-btn-${p.plan_id}`}>
                  {paying === p.plan_id ? (
                    <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Proses…</span>
                  ) : "Upgrade"}
                </Button>
              </div>
            ))}
          </div>
          <div className="text-xs text-brand-mute mt-3">
            Pembayaran diproses aman via <b>Midtrans</b>. Tier aktif otomatis segera setelah pembayaran terkonfirmasi.
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
