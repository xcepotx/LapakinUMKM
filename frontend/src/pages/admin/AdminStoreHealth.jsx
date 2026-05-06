import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import api, { formatApiError } from "@/lib/api";
import { Activity, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Search, Store } from "lucide-react";
import { toast } from "sonner";

const FILTERS = [
  { value: "all", label: "Semua" },
  { value: "healthy", label: "Sehat" },
  { value: "onboarding", label: "Perlu onboarding" },
  { value: "critical", label: "Kritis" },
];

function statusLabel(status) {
  if (status === "healthy") return "Sehat";
  if (status === "onboarding") return "Perlu onboarding";
  if (status === "critical") return "Kritis";
  return status || "-";
}

function statusClass(status) {
  if (status === "healthy") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "onboarding") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "critical") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function ScoreBar({ score }) {
  const width = `${Math.max(4, Math.min(100, Number(score || 0)))}%`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-extrabold text-brand-ink">{score}/100</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-brand-off">
        <div className="h-full rounded-full bg-brand" style={{ width }} />
      </div>
    </div>
  );
}

function ChecklistItem({ label, ok }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${
      ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"
    }`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}
    </span>
  );
}

export default function AdminStoreHealth() {
  const [summary, setSummary] = useState({});
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (nextFilter = filter, nextQ = q) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/store-health", {
        params: { status: nextFilter, q: nextQ, limit: 100 },
      });
      setSummary(data?.summary || {});
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Gagal memuat Store Health Score");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("all", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedLabel = useMemo(
    () => FILTERS.find((item) => item.value === filter)?.label || "Semua",
    [filter]
  );

  const submitSearch = (event) => {
    event.preventDefault();
    setQ(search);
    load(filter, search);
  };

  const changeFilter = (value) => {
    setFilter(value);
    load(value, q);
  };

  return (
    <AdminLayout
      title="Store Health Score"
      subtitle="Prioritaskan toko yang perlu dibantu onboarding agar siap jualan."
    >
      <div className="space-y-5" data-testid="admin-store-health-page">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Total toko</div>
            <div className="mt-1 text-2xl font-extrabold text-brand-ink">{summary.total ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Sehat</div>
            <div className="mt-1 text-2xl font-extrabold text-emerald-700">{summary.healthy ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Perlu onboarding</div>
            <div className="mt-1 text-2xl font-extrabold text-amber-700">{summary.onboarding ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Kritis</div>
            <div className="mt-1 text-2xl font-extrabold text-red-700">{summary.critical ?? 0}</div>
          </div>
        </div>

        <div className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-brand" />
                <h3 className="text-lg font-extrabold text-brand-ink">Daftar toko berdasarkan health score</h3>
              </div>
              <p className="mt-1 text-sm text-brand-mute">Filter aktif: {selectedLabel}</p>
            </div>

            <form onSubmit={submitSearch} className="flex gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari toko/slug/owner..."
                  className="w-72 rounded-2xl border border-brand-line bg-white py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <button type="submit" className="rounded-2xl bg-brand px-4 py-2 text-sm font-extrabold text-white">
                Cari
              </button>
              <button
                type="button"
                onClick={() => load(filter, q)}
                className="rounded-2xl border border-brand-line bg-white px-3 py-2 text-brand-ink"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </form>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => changeFilter(item.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${
                  filter === item.value
                    ? "border-brand bg-brand text-white"
                    : "border-brand-line bg-white text-brand-ink hover:bg-brand-off"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Memuat health score toko...</div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Tidak ada toko pada filter ini.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-brand-line text-xs uppercase text-brand-mute">
                    <th className="px-4 py-3">Toko</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Checklist</th>
                    <th className="px-4 py-3">Traffic</th>
                    <th className="px-4 py-3">Owner/Billing</th>
                    <th className="px-4 py-3">Gap utama</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const checks = item.checks || {};
                    return (
                      <tr key={item.shop_id || item.slug} className="border-b border-brand-line align-top">
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-2">
                            <Store className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                            <div>
                              <div className="font-extrabold text-brand-ink">{item.name || "-"}</div>
                              <div className="text-xs text-brand-mute">/{item.slug || "-"}</div>
                              <div className="mt-1 text-[11px] text-brand-mute">Dibuat: {formatDate(item.created_at)}</div>
                              {item.public_url ? (
                                <a
                                  href={item.public_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"
                                >
                                  Buka toko <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 min-w-[150px]">
                          <ScoreBar score={item.score} />
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${statusClass(item.health_status)}`}>
                            {statusLabel(item.health_status)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex max-w-[360px] flex-wrap gap-1.5">
                            <ChecklistItem label="Produk" ok={checks.products_ok} />
                            <ChecklistItem label="WA" ok={checks.whatsapp_ok} />
                            <ChecklistItem label="Payment" ok={checks.payment_ok} />
                            <ChecklistItem label="SEO" ok={checks.seo_ok} />
                            <ChecklistItem label="Template" ok={checks.template_ok} />
                            <ChecklistItem label="Storefront" ok={checks.storefront_ok} />
                            <ChecklistItem label="Traffic" ok={checks.traffic_ok} />
                            <ChecklistItem label="Billing" ok={checks.billing_ok} />
                          </div>
                        </td>
                        <td className="px-4 py-4 text-xs text-brand-mute">
                          <div>Kunjungan: <span className="font-bold text-brand-ink">{item.visits ?? 0}</span></div>
                          <div>Klik WA: <span className="font-bold text-brand-ink">{item.whatsapp_clicks ?? 0}</span></div>
                          <div>Produk: <span className="font-bold text-brand-ink">{item.products_count ?? 0}</span></div>
                        </td>
                        <td className="px-4 py-4 text-xs text-brand-mute">
                          <div className="font-bold text-brand-ink">{item.owner_email || "-"}</div>
                          <div>Tier: {item.owner_tier || "free"}</div>
                          <div>Trial: {item.owner_trial ? "aktif" : item.owner_trial_expired ? "expired" : "-"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <ul className="max-w-[280px] list-disc pl-4 text-xs text-brand-mute">
                            {(item.gaps || []).slice(0, 5).map((gap) => (
                              <li key={gap}>{gap}</li>
                            ))}
                            {(item.gaps || []).length === 0 ? <li>Semua indikator utama aman.</li> : null}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
