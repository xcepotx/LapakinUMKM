/* LAPAKIN_ADMIN_SUPPORT_QUEUE_PHASE2D_V1 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
} from "lucide-react";

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
}

function statusLabel(value) {
  if (value === "in_progress") return "In Progress";
  if (value === "resolved") return "Resolved";
  return "Open";
}

function statusClass(value) {
  if (value === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "in_progress") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-700";
}

function priorityClass(value) {
  if (value === "urgent") return "border-red-200 bg-red-50 text-red-700";
  if (value === "high") return "border-orange-200 bg-orange-50 text-orange-700";
  if (value === "low") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-brand-line bg-brand-off text-brand-mute";
}

function StatCard({ title, value, icon: Icon, tone = "default" }) {
  const toneClass = {
    danger: "border-red-200 bg-red-50 text-red-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    default: "border-brand-line bg-white text-brand-ink",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide opacity-70">{title}</div>
          <div className="mt-1 text-2xl font-black">{Number(value || 0).toLocaleString("id-ID")}</div>
        </div>
        <Icon className="h-6 w-6 opacity-70" />
      </div>
    </div>
  );
}

export default function AdminSupportQueue() {
  const [data, setData] = useState({ items: [], summary: {} });
  const [filters, setFilters] = useState({
    status: "active",
    priority: "all",
    q: "",
    limit: 100,
  });
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => ({ ...filters }), [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/admin/support-cases", { params });
      setData(response.data || { items: [], summary: {} });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal memuat support queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.status, params.priority, params.limit]);

  const submitSearch = (event) => {
    event.preventDefault();
    load();
  };

  const items = data.items || [];
  const summary = data.summary || {};

  return (
    <AdminLayout
      title="Support Queue"
      subtitle="Daftar toko dengan support case aktif untuk follow-up admin."
      actions={
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center rounded-xl bg-brand px-4 py-2 text-sm font-black text-white hover:bg-brand-dark disabled:opacity-60"
          data-testid="admin-support-queue-refresh"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
    >
      <div className="space-y-5" data-testid="admin-support-queue-page">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Active" value={summary.active} icon={ShieldCheck} tone="danger" />
          <StatCard title="Open" value={summary.open} icon={AlertTriangle} tone="danger" />
          <StatCard title="In Progress" value={summary.in_progress} icon={Clock} tone="warning" />
          <StatCard title="Urgent" value={summary.urgent} icon={AlertTriangle} tone="danger" />
          <StatCard title="Resolved" value={summary.resolved} icon={CheckCircle2} tone="good" />
        </div>

        <form onSubmit={submitSearch} className="rounded-2xl border border-brand-line bg-white p-4 shadow-card" data-testid="admin-support-queue-filters">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="block">
              <span className="text-xs font-black uppercase text-brand-mute">Status</span>
              <select
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
              >
                <option value="active">Active Cases</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="all">All Status</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase text-brand-mute">Priority</span>
              <select
                value={filters.priority}
                onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}
                className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
              >
                <option value="all">All Priority</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </label>

            <label className="block xl:col-span-3">
              <span className="text-xs font-black uppercase text-brand-mute">Search</span>
              <div className="mt-1 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
                  <input
                    value={filters.q}
                    onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                    placeholder="Cari toko, slug, summary, next step, admin..."
                    className="h-11 w-full rounded-xl border border-brand-line bg-white pl-9 pr-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark"
                >
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                </button>
              </div>
            </label>
          </div>
        </form>

        <div className="rounded-2xl border border-brand-line bg-white shadow-card">
          {loading ? (
            <div className="p-12 text-center text-brand-mute">Memuat support queue...</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center">
              <div className="font-heading text-xl font-black text-brand-ink">Tidak ada support case</div>
              <p className="mt-2 text-sm text-brand-mute">Filter ini belum punya case.</p>
            </div>
          ) : (
            <div className="divide-y divide-brand-line">
              {items.map((item) => {
                const shop = item.shop || {};
                const owner = item.owner || {};

                return (
                  <div key={item.case_id || item.shop_id} className="p-5" data-testid={`support-case-${item.shop_id}`}>
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${statusClass(item.status)}`}>
                            {statusLabel(item.status)}
                          </span>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${priorityClass(item.priority)}`}>
                            {item.priority || "normal"}
                          </span>
                          <span className="rounded-full border border-brand-line bg-brand-off px-2.5 py-1 text-[11px] font-black uppercase text-brand-mute">
                            {shop.status || "active"}
                          </span>
                        </div>

                        <div className="mt-3 flex items-start gap-3">
                          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-off text-brand">
                            <Store className="h-5 w-5" />
                          </div>

                          <div className="min-w-0">
                            <div className="font-heading text-xl font-black text-brand-ink">
                              {item.shop_name || shop.name || "-"}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-brand-mute">
                              <span>{item.shop_id}</span>
                              {item.shop_slug || shop.slug ? <span>/toko/{item.shop_slug || shop.slug}</span> : null}
                              {owner.email ? <span>{owner.email}</span> : null}
                            </div>
                          </div>
                        </div>

                        {item.summary ? (
                          <div className="mt-4 rounded-2xl bg-brand-off/70 p-4">
                            <div className="text-xs font-black uppercase text-brand-mute">Summary</div>
                            <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-brand-ink">{item.summary}</p>
                          </div>
                        ) : null}

                        {item.next_step ? (
                          <div className="mt-3 rounded-2xl bg-amber-50 p-4">
                            <div className="text-xs font-black uppercase text-amber-700">Next Step</div>
                            <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-amber-900">{item.next_step}</p>
                          </div>
                        ) : null}

                        <div className="mt-3 text-xs font-bold text-brand-mute">
                          Updated {formatDate(item.updated_at)} by {item.updated_by_email || "-"}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2 xl:flex-col">
                        <Link
                          to={`/admin/tenant-view/${item.shop_id}`}
                          className="inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-black text-white hover:bg-brand-dark"
                          data-testid={`open-tenant-view-${item.shop_id}`}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Open Tenant View
                        </Link>

                        {item.shop_slug || shop.slug ? (
                          <a
                            href={`/toko/${item.shop_slug || shop.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off"
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Storefront
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
