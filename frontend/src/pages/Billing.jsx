import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Sparkles, Zap, Rocket, Check, ExternalLink } from "lucide-react";

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

  useEffect(() => {
    api.get("/billing/me").then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

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
          <h2 className="font-heading font-bold text-xl mb-4">Fitur Aktif di Tier {data.tier_label}</h2>
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

        <div className="mt-6 rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm">
          <div className="font-bold text-yellow-900">ℹ️ Pembayaran belum aktif</div>
          <p className="text-yellow-900/80 mt-1">
            Untuk upgrade tier saat ini, hubungi admin Lapakin via{" "}
            <a href="https://wa.me/628123456789" className="font-semibold underline" target="_blank" rel="noopener noreferrer">
              WhatsApp <ExternalLink className="w-3 h-3 inline" />
            </a>.
            Pembayaran otomatis (Midtrans/Stripe) akan tersedia di update berikutnya.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
