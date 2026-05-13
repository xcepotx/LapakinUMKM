/* LAPAKIN_ERROR_CENTER_PHASE3_ADMIN_UI_V1 */
import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock,
  Copy,
  EyeOff,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Smartphone,
} from "lucide-react";

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "all", label: "Semua status" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "Semua source" },
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "worker", label: "Worker" },
  { value: "nginx", label: "Nginx" },
];

const SEVERITY_OPTIONS = [
  { value: "all", label: "Semua severity" },
  { value: "critical", label: "Critical" },
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

function formatDate(value) {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function severityClass(value) {
  const severity = String(value || "").toLowerCase();

  if (severity === "critical") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "error") return "border-orange-200 bg-orange-50 text-orange-700";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusClass(value) {
  const status = String(value || "").toLowerCase();

  if (status === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "ignored") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-red-200 bg-red-50 text-red-700";
}

function sourceIcon(source) {
  return source === "backend" ? Server : Smartphone;
}

function clip(value, limit = 180) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

function StatCard({ title, value, tone = "default", icon: Icon = Bug }) {
  const toneClass = {
    critical: "border-red-200 bg-red-50 text-red-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    default: "border-brand-line bg-white text-brand-ink",
  }[tone] || "border-brand-line bg-white text-brand-ink";

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

function ErrorDetail({ item, onStatusChange, busy }) {
  const SourceIcon = sourceIcon(item.source);
  const metadata = item.metadata ? JSON.stringify(item.metadata, null, 2) : "";
  const stack = item.stack || "";

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text || "");
      toast.success(`${label} disalin`);
    } catch {
      toast.error("Gagal menyalin");
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-brand-line bg-brand-off/70 p-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-3">
          <div className="text-xs font-black uppercase text-brand-mute">Error ID</div>
          <button
            type="button"
            onClick={() => copyText(item.error_id, "Error ID")}
            className="mt-1 flex items-center gap-2 text-left text-sm font-bold text-brand-ink hover:underline"
          >
            {item.error_id}
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="rounded-xl bg-white p-3">
          <div className="text-xs font-black uppercase text-brand-mute">Source</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-bold text-brand-ink">
            <SourceIcon className="h-4 w-4" />
            {item.source || "-"} · {item.feature || "-"}
          </div>
        </div>

        <div className="rounded-xl bg-white p-3">
          <div className="text-xs font-black uppercase text-brand-mute">Last Seen</div>
          <div className="mt-1 text-sm font-bold text-brand-ink">{formatDate(item.last_seen)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-3">
          <div className="text-xs font-black uppercase text-brand-mute">Path</div>
          <div className="mt-1 break-all text-sm font-semibold text-brand-ink">{item.path || "-"}</div>
        </div>

        <div className="rounded-xl bg-white p-3">
          <div className="text-xs font-black uppercase text-brand-mute">Browser / Client</div>
          <div className="mt-1 break-all text-xs font-semibold text-brand-ink">{item.browser || "-"}</div>
        </div>
      </div>

      {stack ? (
        <div className="mt-4 rounded-xl bg-slate-950 p-4 text-slate-100">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase text-slate-400">Stack Trace</div>
            <button
              type="button"
              onClick={() => copyText(stack, "Stack trace")}
              className="rounded-lg bg-white/10 px-3 py-1 text-xs font-bold text-white hover:bg-white/20"
            >
              Copy
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{stack}</pre>
        </div>
      ) : null}

      {metadata ? (
        <div className="mt-4 rounded-xl bg-white p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase text-brand-mute">Metadata</div>
            <button
              type="button"
              onClick={() => copyText(metadata, "Metadata")}
              className="rounded-lg border border-brand-line px-3 py-1 text-xs font-bold text-brand-ink hover:bg-brand-off"
            >
              Copy
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-brand-ink">{metadata}</pre>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onStatusChange(item.error_id, "open")}
          className="rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-bold text-brand-ink hover:border-brand/40 disabled:opacity-50"
        >
          <RotateCcw className="mr-2 inline h-4 w-4" />
          Reopen
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onStatusChange(item.error_id, "resolved")}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <CheckCircle2 className="mr-2 inline h-4 w-4" />
          Resolve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onStatusChange(item.error_id, "ignored")}
          className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <EyeOff className="mr-2 inline h-4 w-4" />
          Ignore
        </button>
      </div>
    </div>
  );
}

export default function AdminErrorLogs() {
  const [data, setData] = useState({ items: [], summary: {} });
  // LAPAKIN_ERROR_CENTER_PHASE4A_OVERVIEW_RETENTION_V1
  const [overview, setOverview] = useState({ daily: [], by_source: [], by_severity: [], by_feature: [] });
  const [filters, setFilters] = useState({
    status: "open",
    source: "all",
    severity: "all",
    feature: "all",
    q: "",
    limit: 100,
  });
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState("");
  const [busyId, setBusyId] = useState("");
  // LAPAKIN_ERROR_CENTER_PHASE4B_BADGE_CLEANUP_UI_V4
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);

  const params = useMemo(() => ({ ...filters }), [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const [logsResponse, overviewResponse] = await Promise.all([
        api.get("/admin/error-logs", { params }),
        api.get("/admin/error-logs/overview", { params: { days: 14 } }),
      ]);

      setData(logsResponse.data || { items: [], summary: {} });
      setOverview(overviewResponse.data || { daily: [], by_source: [], by_severity: [], by_feature: [] });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal memuat Error Logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.status, params.source, params.severity, params.feature, params.limit]);

  const submitSearch = (event) => {
    event.preventDefault();
    load();
  };

  const updateStatus = async (errorId, status) => {
    setBusyId(errorId);
    try {
      await api.patch(`/admin/error-logs/${errorId}/status`, {
        status,
        note: `Updated from Error Logs UI to ${status}`,
      });
      toast.success(`Error ditandai ${status}`);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal update status error");
    } finally {
      setBusyId("");
    }
  };

  // LAPAKIN_ERROR_CENTER_PHASE4B_BADGE_CLEANUP_UI_V4
  const runCleanupDryRun = async () => {
    setCleanupBusy(true);
    setCleanupResult(null);

    try {
      const response = await api.post("/admin/error-logs/cleanup", {
        days: 30,
        statuses: ["resolved", "ignored"],
        dry_run: true,
      });

      setCleanupResult(response.data || null);
      toast.success("Dry-run cleanup selesai");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal menjalankan dry-run cleanup");
    } finally {
      setCleanupBusy(false);
    }
  };

  const items = data.items || [];
  const summary = data.summary || {};

  // LAPAKIN_ERROR_CENTER_PHASE4A_OVERVIEW_RETENTION_V1
  const dailyOverview = overview.daily || [];
  const maxDailyOverview = Math.max(1, ...dailyOverview.map((row) => Number(row.total || 0)));
  const topFeatureOverview = (overview.by_feature || []).slice(0, 6);
  const sourceOverview = overview.by_source || [];
  const severityOverview = overview.by_severity || [];

  return (
    <AdminLayout
      title="Error Logs"
      subtitle="Pantau error frontend/backend, dedupe otomatis, dan tandai resolved/ignored."
      actions={
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center rounded-xl bg-brand px-4 py-2 text-sm font-black text-white hover:bg-brand-dark disabled:opacity-60"
          data-testid="admin-error-logs-refresh"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
    >
      <div className="space-y-5" data-testid="admin-error-logs-page">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Open" value={summary.open} tone="critical" icon={AlertTriangle} />
          <StatCard title="Critical Open" value={summary.critical_open} tone="critical" icon={Bug} />
          <StatCard title="Hari Ini" value={summary.today} tone="warning" icon={Clock} />
          <StatCard title="Resolved" value={summary.resolved} tone="good" icon={CheckCircle2} />
        </div>


        {/* LAPAKIN_ERROR_CENTER_PHASE4A_OVERVIEW_RETENTION_V1 */}
        <div className="grid gap-4 xl:grid-cols-3" data-testid="admin-error-logs-overview">
          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card xl:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-lg font-black text-brand-ink">Trend Error 14 Hari</h2>
                <p className="mt-1 text-xs text-brand-mute">Total weighted by count/fingerprint, bukan hanya jumlah row.</p>
              </div>
              <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-black text-brand-mute">
                {dailyOverview.reduce((sum, row) => sum + Number(row.total || 0), 0)} total
              </span>
            </div>

            <div className="mt-4 h-44 rounded-2xl border border-brand-line bg-brand-off/50 px-3 pb-3 pt-8">
              {dailyOverview.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-brand-mute">Belum ada data trend.</div>
              ) : (
                <div className="flex h-full items-stretch gap-2">
                  {dailyOverview.map((row) => {
                    const total = Number(row.total || 0);
                    const percent = total > 0 ? Math.max(8, (total / maxDailyOverview) * 100) : 0;

                    return (
                      <div key={row.date} className="flex min-w-0 flex-1 flex-col items-center gap-2" title={`${row.date}: ${total} error`}>
                        <div className="relative flex min-h-0 w-full flex-1 items-end justify-center border-b border-brand-line/70">
                          {total > 0 ? (
                            <span className="absolute -top-6 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-brand-ink shadow-sm">
                              {total}
                            </span>
                          ) : null}
                          <div
                            className={`w-full max-w-[46px] rounded-t-xl ${total > 0 ? "bg-brand" : "bg-brand-line/80"}`}
                            style={{ height: total > 0 ? `${percent}%` : "4px" }}
                          />
                        </div>
                        <span className="w-full truncate text-center text-[10px] text-brand-mute">{row.date?.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card">
            <h2 className="font-heading text-lg font-black text-brand-ink">Open Breakdown</h2>
            <p className="mt-1 text-xs text-brand-mute">Sumber dan severity error yang masih open.</p>

            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 text-xs font-black uppercase text-brand-mute">Source</div>
                <div className="space-y-2">
                  {sourceOverview.length === 0 ? (
                    <div className="text-sm text-brand-mute">Tidak ada open error.</div>
                  ) : sourceOverview.map((row) => (
                    <div key={row.key} className="flex items-center justify-between rounded-xl bg-brand-off px-3 py-2">
                      <span className="text-sm font-bold text-brand-ink">{row.key}</span>
                      <span className="text-sm font-black text-brand">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-black uppercase text-brand-mute">Severity</div>
                <div className="space-y-2">
                  {severityOverview.length === 0 ? (
                    <div className="text-sm text-brand-mute">Tidak ada open error.</div>
                  ) : severityOverview.map((row) => (
                    <div key={row.key} className="flex items-center justify-between rounded-xl bg-brand-off px-3 py-2">
                      <span className="text-sm font-bold text-brand-ink">{row.key}</span>
                      <span className="text-sm font-black text-brand">{row.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card xl:col-span-3">
            <h2 className="font-heading text-lg font-black text-brand-ink">Top Feature Bermasalah</h2>
            <p className="mt-1 text-xs text-brand-mute">Dipakai untuk menentukan area prioritas debugging.</p>

            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {topFeatureOverview.length === 0 ? (
                <div className="rounded-xl bg-brand-off px-3 py-3 text-sm text-brand-mute">Tidak ada open error.</div>
              ) : topFeatureOverview.map((row) => (
                <div key={row.key} className="flex items-center justify-between rounded-xl border border-brand-line bg-brand-off/70 px-4 py-3">
                  <span className="font-bold text-brand-ink">{row.key}</span>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-brand">{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>


        {/* LAPAKIN_ERROR_CENTER_PHASE4B_BADGE_CLEANUP_UI_V4 */}
        <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card" data-testid="admin-error-logs-cleanup">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-heading text-lg font-black text-brand-ink">Maintenance / Cleanup</h2>
              <p className="mt-1 text-xs text-brand-mute">
                Simulasi pembersihan log yang sudah resolved/ignored lebih dari 30 hari. Default masih dry-run, tidak menghapus data.
              </p>
            </div>

            <button
              type="button"
              onClick={runCleanupDryRun}
              disabled={cleanupBusy}
              className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-brand-off px-4 py-2 text-sm font-black text-brand-ink hover:border-brand/40 disabled:opacity-60"
              data-testid="admin-error-logs-cleanup-dryrun"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${cleanupBusy ? "animate-spin" : ""}`} />
              Dry-run Cleanup
            </button>
          </div>

          {cleanupResult ? (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl bg-brand-off p-3">
                <div className="text-xs font-black uppercase text-brand-mute">Matched</div>
                <div className="mt-1 text-xl font-black text-brand-ink">{cleanupResult.matched || 0}</div>
              </div>
              <div className="rounded-xl bg-brand-off p-3">
                <div className="text-xs font-black uppercase text-brand-mute">Deleted</div>
                <div className="mt-1 text-xl font-black text-brand-ink">{cleanupResult.deleted || 0}</div>
              </div>
              <div className="rounded-xl bg-brand-off p-3">
                <div className="text-xs font-black uppercase text-brand-mute">Mode</div>
                <div className="mt-1 text-xl font-black text-brand-ink">{cleanupResult.dry_run ? "Dry-run" : "Delete"}</div>
              </div>
              <div className="rounded-xl bg-brand-off p-3">
                <div className="text-xs font-black uppercase text-brand-mute">Cutoff</div>
                <div className="mt-1 text-xs font-bold text-brand-ink">{formatDate(cleanupResult.cutoff)}</div>
              </div>
            </div>
          ) : null}
        </div>

        <form
          onSubmit={submitSearch}
          className="rounded-2xl border border-brand-line bg-white p-4 shadow-card"
          data-testid="admin-error-logs-filters"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="block">
              <span className="text-xs font-black uppercase text-brand-mute">Status</span>
              <select
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase text-brand-mute">Source</span>
              <select
                value={filters.source}
                onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
                className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
              >
                {SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase text-brand-mute">Severity</span>
              <select
                value={filters.severity}
                onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}
                className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
              >
                {SEVERITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase text-brand-mute">Feature</span>
              <input
                value={filters.feature === "all" ? "" : filters.feature}
                onChange={(e) => setFilters((f) => ({ ...f, feature: e.target.value.trim() || "all" }))}
                placeholder="all / dashboard / storefront"
                className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
              />
            </label>

            <label className="block xl:col-span-2">
              <span className="text-xs font-black uppercase text-brand-mute">Search</span>
              <div className="mt-1 flex gap-2">
                <input
                  value={filters.q}
                  onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                  placeholder="Cari message, path, feature, error_id..."
                  className="h-11 min-w-0 flex-1 rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                />
                <button
                  type="submit"
                  className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark"
                >
                  <Search className="mr-2 h-4 w-4" />
                  Cari
                </button>
              </div>
            </label>
          </div>
        </form>

        <div className="rounded-2xl border border-brand-line bg-white shadow-card">
          {loading ? (
            <div className="p-12 text-center text-brand-mute">Memuat error logs...</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center">
              <div className="font-heading text-xl font-black text-brand-ink">Tidak ada error log</div>
              <p className="mt-2 text-sm text-brand-mute">Filter ini belum punya data error.</p>
            </div>
          ) : (
            <div className="divide-y divide-brand-line">
              {items.map((item) => {
                const SourceIcon = sourceIcon(item.source);
                const isExpanded = expandedId === item.error_id;

                return (
                  <div key={item.error_id} className="p-4" data-testid={`admin-error-log-${item.error_id}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? "" : item.error_id)}
                      className="w-full text-left"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${severityClass(item.severity)}`}>
                              {item.severity || "error"}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${statusClass(item.status)}`}>
                              {item.status || "open"}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-brand-line bg-brand-off px-2.5 py-1 text-[11px] font-black uppercase text-brand-mute">
                              <SourceIcon className="mr-1 h-3.5 w-3.5" />
                              {item.source || "-"}
                            </span>
                            <span className="rounded-full border border-brand-line bg-white px-2.5 py-1 text-[11px] font-black uppercase text-brand-mute">
                              x{Number(item.count || 1).toLocaleString("id-ID")}
                            </span>
                          </div>

                          <div className="mt-3 font-heading text-base font-black text-brand-ink">
                            {clip(item.message, 220)}
                          </div>

                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-brand-mute">
                            <span>{item.feature || "general"}</span>
                            <span>·</span>
                            <span className="break-all">{item.path || "-"}</span>
                            <span>·</span>
                            <span>{formatDate(item.last_seen)}</span>
                          </div>
                        </div>

                        <div className="text-xs font-bold text-brand-mute">
                          {isExpanded ? "Tutup detail" : "Lihat detail"}
                        </div>
                      </div>
                    </button>

                    {isExpanded ? (
                      <ErrorDetail item={item} onStatusChange={updateStatus} busy={busyId === item.error_id} />
                    ) : null}
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
