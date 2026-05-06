import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import api, { formatApiError } from "@/lib/api";
import { AlertCircle, CreditCard, RefreshCw, Search, ShieldCheck, Timer, Users } from "lucide-react";
import { toast } from "sonner";

const BILLING_OVERVIEW_API = "/admin/billing/overview";
const BILLING_USERS_API = "/admin/billing/users";

const FILTERS = [
  { value: "all", label: "Semua" },
  { value: "trial_active", label: "Trial aktif" },
  { value: "trial_expiring_7d", label: "Mau habis 7 hari" },
  { value: "trial_expired", label: "Trial expired" },
  { value: "paid_active", label: "Paid aktif" },
  { value: "payment_pending", label: "Payment pending" },
];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysLeft(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function money(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function StatCard({ icon: Icon, label, value, helper }) {
  return (
    <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-mute">{label}</p>
          <p className="mt-1 text-2xl font-extrabold text-brand-ink">{value ?? 0}</p>
          {helper ? <p className="mt-1 text-xs text-brand-mute">{helper}</p> : null}
        </div>
        <div className="rounded-2xl bg-brand-off p-2 text-brand">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function TierPill({ tier }) {
  const value = tier || "free";
  return (
    <span className="inline-flex rounded-full border border-brand-line bg-brand-off px-2.5 py-1 text-[11px] font-extrabold uppercase text-brand-ink">
      {value}
    </span>
  );
}

function TrialPill({ user }) {
  const status = user?.trial
    ? "aktif"
    : user?.trial_expired
      ? "expired"
      : user?.trial_used
        ? "pernah"
        : "belum";

  const cls = user?.trial
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : user?.trial_expired
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-slate-50 text-slate-600 border-slate-200";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${cls}`}>
      {status}
    </span>
  );
}

export default function AdminBillingMonitor() {
  const [overview, setOverview] = useState(null);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("trial_expiring_7d");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (nextFilter = filter, nextQ = q) => {
    setLoading(true);
    try {
      const [overviewRes, usersRes] = await Promise.all([
        api.get(BILLING_OVERVIEW_API),
        api.get(BILLING_USERS_API, {
          params: { filter: nextFilter, q: nextQ, limit: 100 },
        }),
      ]);
      setOverview(overviewRes.data || {});
      setRows(Array.isArray(usersRes.data?.items) ? usersRes.data.items : []);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Gagal memuat billing monitor");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("trial_expiring_7d", "");
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

  const stats = overview || {};

  return (
    <AdminLayout
      title="Billing Monitor"
      subtitle="Pantau trial, subscription, dan payment pending dari satu tempat."
    >
      <div className="space-y-5" data-testid="admin-billing-monitor-page">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatCard icon={Timer} label="Trial aktif" value={stats.trial_active} helper="User yang sedang trial" />
          <StatCard icon={AlertCircle} label="Habis <= 7 hari" value={stats.trial_expiring_7d} helper="Butuh follow up" />
          <StatCard icon={AlertCircle} label="Trial expired" value={stats.trial_expired} helper="Trial sudah lewat" />
          <StatCard icon={ShieldCheck} label="Paid aktif" value={stats.paid_active} helper="Starter/Pro/Business" />
          <StatCard icon={CreditCard} label="Payment pending" value={stats.payment_pending} helper="Menunggu review" />
        </div>

        <div className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-extrabold text-brand-ink">Daftar user billing</h3>
              <p className="text-sm text-brand-mute">Filter aktif: {selectedLabel}</p>
            </div>

            <form onSubmit={submitSearch} className="flex gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari email/nama..."
                  className="w-64 rounded-2xl border border-brand-line bg-white py-2 pl-9 pr-3 text-sm"
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
            <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Memuat billing monitor...</div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Tidak ada user pada filter ini.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-brand-line text-xs uppercase text-brand-mute">
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Toko</th>
                    <th className="px-4 py-3">Tier</th>
                    <th className="px-4 py-3">Trial</th>
                    <th className="px-4 py-3">Sisa</th>
                    <th className="px-4 py-3">Subscription</th>
                    <th className="px-4 py-3">Payment/Deposit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((user) => {
                    const left = daysLeft(user.trial_expires_at);
                    const deposit = user.admin_deposit || {};
                    const shop = user.admin_shop || {};
                    return (
                      <tr key={user.user_id || user.email} className="border-b border-brand-line align-top">
                        <td className="px-4 py-4">
                          <div className="font-extrabold text-brand-ink">{user.name || "-"}</div>
                          <div className="text-xs text-brand-mute">{user.email}</div>
                          <div className="mt-1 text-[11px] text-brand-mute">Dibuat: {formatDate(user.account_created_at || user.created_at)}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-bold text-brand-ink">{shop.name || user.shop_name || "-"}</div>
                          <div className="text-xs text-brand-mute">{shop.slug || user.shop_slug || "-"}</div>
                          <div className="mt-1 text-[11px] text-brand-mute">{shop.status || user.shop_status || "-"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <TierPill tier={user.tier} />
                          <div className="mt-2 text-[11px] text-brand-mute">Diubah: {formatDate(user.tier_updated_at)}</div>
                        </td>
                        <td className="px-4 py-4">
                          <TrialPill user={user} />
                          <div className="mt-2 text-[11px] text-brand-mute">Mulai: {formatDate(user.trial_started_at)}</div>
                          <div className="text-[11px] text-brand-mute">Akhir: {formatDate(user.trial_expires_at)}</div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`font-extrabold ${left !== null && left <= 3 ? "text-red-600" : "text-brand-ink"}`}>
                            {left === null ? "-" : `${left} hari`}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs text-brand-mute">
                          <div>Status: {user.subscription_status || "-"}</div>
                          <div>Mulai: {formatDate(user.subscription_started_at)}</div>
                          <div>Akhir: {formatDate(user.subscription_expires_at)}</div>
                        </td>
                        <td className="px-4 py-4 text-xs text-brand-mute">
                          <div>Saldo: {money(deposit.balance)}</div>
                          <div>Sukses: {money(deposit.total_success_amount)}</div>
                          <div>Pending: {deposit.pending_count ?? 0}</div>
                          <div>Last: {formatDate(deposit.last_payment_at)}</div>
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
