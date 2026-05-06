import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import api, { formatApiError } from "@/lib/api";
import { Activity, AlertTriangle, ClipboardList, CreditCard, History, RefreshCw, ShieldCheck, Store, Timer, Users } from "lucide-react";
import { toast } from "sonner";

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatCard({ icon: Icon, label, value, helper, to, tone = "brand" }) {
  const toneClass = tone === "danger" ? "bg-red-50 text-red-700" : tone === "warning" ? "bg-amber-50 text-amber-700" : tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-brand-off text-brand";
  const card = (
    <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">{label}</div>
          <div className="mt-1 text-2xl font-extrabold text-brand-ink">{value ?? 0}</div>
          {helper ? <div className="mt-1 text-xs text-brand-mute">{helper}</div> : null}
        </div>
        <div className={`rounded-2xl p-2 ${toneClass}`}><Icon className="h-5 w-5" /></div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{card}</Link> : card;
}

function TaskCard({ task }) {
  const high = task.priority === "high";
  return (
    <Link to={task.path || "/admin"} className={`block rounded-3xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${high ? "border-red-200 bg-red-50" : "border-brand-line bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-sm font-extrabold ${high ? "text-red-700" : "text-brand-ink"}`}>{task.label}</div>
          <div className="mt-1 text-xs text-brand-mute">{task.helper}</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-extrabold ${high ? "bg-red-100 text-red-700" : "bg-brand-off text-brand-ink"}`}>{task.count ?? 0}</div>
      </div>
    </Link>
  );
}

function AuditItem({ item }) {
  return (
    <div className="rounded-2xl border border-brand-line bg-brand-off/40 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-extrabold text-brand-ink">{item.action || "-"}</div>
        <div className="text-xs font-semibold text-brand-mute">{formatDate(item.created_at)}</div>
      </div>
      <div className="mt-1 text-xs text-brand-mute">
        Admin: <span className="font-bold text-brand-ink">{item.admin_email || item.admin_user_id || "-"}</span>
        {" · "}
        Target: <span className="font-bold text-brand-ink">{item.target_email || item.target_id || item.target_user_id || "-"}</span>
      </div>
      {item.reason ? <div className="mt-1 text-xs text-brand-mute">Reason: {item.reason}</div> : null}
    </div>
  );
}

export default function AdminOpsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: result } = await api.get("/admin/ops/overview");
      setData(result || {});
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Gagal memuat Daily Ops");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const summary = data?.summary || {};
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const auditLogs = Array.isArray(data?.recent_audit_logs) ? data.recent_audit_logs : [];

  return (
    <AdminLayout title="Daily Ops" subtitle="Ringkasan pekerjaan admin hari ini: billing, payment, store health, onboarding, dan audit.">
      <div className="space-y-5" data-testid="admin-ops-dashboard-page">
        <div className="flex flex-col gap-3 rounded-3xl border border-brand-line bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-brand" />
              <h3 className="text-lg font-extrabold text-brand-ink">Daily Ops Dashboard</h3>
            </div>
            <p className="mt-1 text-sm text-brand-mute">Fokus hari ini: trial, payment, toko critical, dan follow-up onboarding.</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-brand-line bg-white px-4 py-2 text-sm font-extrabold text-brand-ink hover:bg-brand-off">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="rounded-3xl bg-brand-off/60 px-5 py-10 text-sm text-brand-mute">Memuat Daily Ops Dashboard...</div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={Timer} label="Trial mau habis <= 7 hari" value={summary.trial_expiring_7d} helper="Follow-up sebelum trial habis" tone="warning" to="/admin/billing" />
              <StatCard icon={CreditCard} label="Payment pending" value={summary.payment_pending} helper="Butuh approve/reject" tone="danger" to="/admin/payments" />
              <StatCard icon={Store} label="Toko critical" value={summary.store_critical} helper="Prioritas onboarding" tone="danger" to="/admin/store-health" />
              <StatCard icon={ClipboardList} label="Follow-up due" value={summary.onboarding_due_today} helper="Onboarding jatuh tempo" tone="warning" to="/admin/onboarding" />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <StatCard icon={Users} label="User baru hari ini" value={summary.users_today} helper="Akun baru masuk" to="/admin/users" />
              <StatCard icon={Store} label="Toko baru hari ini" value={summary.shops_today} helper="Toko baru dibuat" to="/admin/shops" />
              <StatCard icon={ShieldCheck} label="Payment reviewed hari ini" value={summary.payments_reviewed_today} helper="Approve/reject hari ini" tone="success" to="/admin/payments" />
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              <div className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm xl:col-span-2">
                <div className="mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-brand" />
                  <h3 className="text-lg font-extrabold text-brand-ink">Yang harus dikerjakan hari ini</h3>
                </div>
                {tasks.length === 0 ? (
                  <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Tidak ada task prioritas. Semua indikator utama aman.</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {tasks.map((task) => <TaskCard key={task.key || task.label} task={task} />)}
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm">
                <h3 className="mb-4 text-lg font-extrabold text-brand-ink">Quick Actions</h3>
                <div className="grid gap-2">
                  <Link className="rounded-2xl border border-brand-line px-4 py-3 text-sm font-extrabold text-brand-ink hover:bg-brand-off" to="/admin/billing">Buka Billing Monitor</Link>
                  <Link className="rounded-2xl border border-brand-line px-4 py-3 text-sm font-extrabold text-brand-ink hover:bg-brand-off" to="/admin/payments">Review Payment Pending</Link>
                  <Link className="rounded-2xl border border-brand-line px-4 py-3 text-sm font-extrabold text-brand-ink hover:bg-brand-off" to="/admin/store-health">Cek Store Health</Link>
                  <Link className="rounded-2xl border border-brand-line px-4 py-3 text-sm font-extrabold text-brand-ink hover:bg-brand-off" to="/admin/onboarding">Buka Onboarding Queue</Link>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <History className="h-5 w-5 text-brand" />
                <h3 className="text-lg font-extrabold text-brand-ink">Audit log terbaru</h3>
              </div>
              {auditLogs.length === 0 ? (
                <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Belum ada audit log.</div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {auditLogs.map((item) => <AuditItem key={item.audit_id || `${item.action}-${item.created_at}`} item={item} />)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
