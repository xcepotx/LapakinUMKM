import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import api, { formatApiError } from "@/lib/api";
import { CheckCircle2, CreditCard, ExternalLink, RefreshCw, Search, XCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "Semua" },
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

function money(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function StatusPill({ status }) {
  const value = String(status || "-").toLowerCase();
  const cls =
    ["approved", "paid", "success", "completed"].includes(value)
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : ["rejected", "failed", "cancelled"].includes(value)
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${cls}`}>
      {value}
    </span>
  );
}

function paymentProofUrl(payment) {
  return (
    payment?.proof_url ||
    payment?.receipt_url ||
    payment?.payment_proof_url ||
    payment?.payment_proof ||
    payment?.proof_image ||
    payment?.receipt_image ||
    ""
  );
}

export default function AdminPayments() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState("");

  const load = async (nextStatus = status, nextQ = q) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/payments", {
        params: { status: nextStatus, q: nextQ, limit: 100 },
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setSummary(data?.summary || {});
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Gagal memuat payment");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("pending", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedLabel = useMemo(
    () => STATUS_FILTERS.find((item) => item.value === status)?.label || "Pending",
    [status]
  );

  const submitSearch = (event) => {
    event.preventDefault();
    setQ(search);
    load(status, search);
  };

  const changeStatus = (value) => {
    setStatus(value);
    load(value, q);
  };

  const actOnPayment = async (payment, action) => {
    const paymentId = payment.payment_id || payment.id;
    if (!paymentId) {
      toast.error("Payment ID tidak ditemukan.");
      return;
    }

    const label = action === "approve" ? "approve payment" : "reject payment";
    const defaultNote = action === "approve" ? "Pembayaran sudah diverifikasi admin" : "Pembayaran ditolak admin";
    const note = window.prompt(`Catatan admin untuk ${label}:`, defaultNote);
    if (note === null) return;

    setActingId(`${paymentId}:${action}`);
    try {
      await api.post(`/admin/payments/${paymentId}/${action}`, { note });
      toast.success(action === "approve" ? "Payment berhasil di-approve" : "Payment berhasil di-reject");
      await load(status, q);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || `Gagal ${label}`);
    } finally {
      setActingId("");
    }
  };

  return (
    <AdminLayout
      title="Payment Pending"
      subtitle="Review, approve, reject, dan audit pembayaran manual/deposit."
    >
      <div className="space-y-5" data-testid="admin-payments-page">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Pending</div>
            <div className="mt-1 text-2xl font-extrabold text-brand-ink">{summary.pending ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Approved</div>
            <div className="mt-1 text-2xl font-extrabold text-brand-ink">{summary.approved ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Rejected</div>
            <div className="mt-1 text-2xl font-extrabold text-brand-ink">{summary.rejected ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Nominal pending</div>
            <div className="mt-1 text-2xl font-extrabold text-brand-ink">{money(summary.pending_amount)}</div>
          </div>
        </div>

        <div className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-brand" />
                <h3 className="text-lg font-extrabold text-brand-ink">Daftar payment</h3>
              </div>
              <p className="mt-1 text-sm text-brand-mute">Filter aktif: {selectedLabel}</p>
            </div>

            <form onSubmit={submitSearch} className="flex gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari email/user/payment..."
                  className="w-72 rounded-2xl border border-brand-line bg-white py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <button type="submit" className="rounded-2xl bg-brand px-4 py-2 text-sm font-extrabold text-white">
                Cari
              </button>
              <button
                type="button"
                onClick={() => load(status, q)}
                className="rounded-2xl border border-brand-line bg-white px-3 py-2 text-brand-ink"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </form>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => changeStatus(item.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${
                  status === item.value
                    ? "border-brand bg-brand text-white"
                    : "border-brand-line bg-white text-brand-ink hover:bg-brand-off"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Memuat payment...</div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Tidak ada payment pada filter ini.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-brand-line text-xs uppercase text-brand-mute">
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">User/Toko</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Bukti</th>
                    <th className="px-4 py-3">Tanggal</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((payment) => {
                    const paymentId = payment.payment_id || payment.id || "-";
                    const proof = paymentProofUrl(payment);
                    const approveKey = `${paymentId}:approve`;
                    const rejectKey = `${paymentId}:reject`;
                    return (
                      <tr key={paymentId} className="border-b border-brand-line align-top">
                        <td className="px-4 py-4">
                          <div className="font-extrabold text-brand-ink">{paymentId}</div>
                          <div className="text-xs text-brand-mute">{payment.method || payment.payment_method || "-"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-bold text-brand-ink">{payment.email || payment.user_email || "-"}</div>
                          <div className="text-xs text-brand-mute">{payment.shop_name || payment.shop_slug || payment.user_id || "-"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-bold text-brand-ink">{payment.plan_id || payment.tier || payment.package || "-"}</div>
                          <div className="text-xs text-brand-mute">{payment.cycle || payment.subscription_cycle || "-"}</div>
                        </td>
                        <td className="px-4 py-4 font-extrabold text-brand-ink">
                          {money(payment.amount || payment.amount_total || payment.total || payment.nominal)}
                        </td>
                        <td className="px-4 py-4">
                          <StatusPill status={payment.status} />
                        </td>
                        <td className="px-4 py-4">
                          {proof ? (
                            <a
                              href={proof}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-xl border border-brand-line px-3 py-2 text-xs font-bold text-brand-ink hover:bg-brand-off"
                            >
                              Bukti <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span className="text-xs text-brand-mute">-</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs text-brand-mute">
                          <div>Dibuat: {formatDate(payment.created_at)}</div>
                          <div>Update: {formatDate(payment.updated_at)}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-[140px] flex-col gap-2">
                            <button
                              type="button"
                              onClick={() => actOnPayment(payment, "approve")}
                              disabled={actingId === approveKey}
                              className="inline-flex items-center justify-center gap-1 rounded-xl bg-brand px-3 py-2 text-xs font-extrabold text-white disabled:opacity-60"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => actOnPayment(payment, "reject")}
                              disabled={actingId === rejectKey}
                              className="inline-flex items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-60"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </button>
                          </div>
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
