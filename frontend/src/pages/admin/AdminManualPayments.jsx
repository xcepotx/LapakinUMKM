import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  ["pending_review", "Menunggu Review"],
  ["pending_payment", "Menunggu Bukti"],
  ["rejected", "Ditolak"],
  ["success", "Disetujui"],
  ["all", "Semua"],
];

function formatRupiah(value) {
  return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
}

export default function AdminManualPayments() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("pending_review");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/manual-payments?status=${encodeURIComponent(status)}`);
      setItems(res.data?.items || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Gagal memuat pembayaran manual");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const review = async (orderId, action) => {
    const label = action === "approve" ? "menyetujui" : "menolak";
    if (action === "approve" && !window.confirm("Setujui pembayaran ini dan aktifkan tier user?")) return;
    setBusy(`${action}:${orderId}`);
    try {
      await api.post(`/admin/manual-payments/${orderId}/${action}`, {
        admin_note: notes[orderId] || "",
      });
      toast.success(`Berhasil ${label} pembayaran`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || `Gagal ${label} pembayaran`);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="min-h-screen bg-brand-sand">
      <header className="bg-white border-b border-brand-line">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <Link to="/admin" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline">
              <ArrowLeft className="w-4 h-4" /> Admin
            </Link>
            <h1 className="font-heading font-extrabold text-2xl mt-1">Pembayaran Manual QRIS</h1>
            <p className="text-sm text-brand-mute">Review bukti bayar upgrade tier Lapakin.</p>
          </div>
          <Button onClick={load} variant="outline" className="rounded-xl border-brand-line" data-testid="admin-manual-payments-refresh">
            <RefreshCcw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-wrap gap-2 mb-5">
          {STATUS_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={`rounded-full border px-4 py-2 text-sm font-bold ${status === value ? "bg-brand text-white border-brand" : "bg-white border-brand-line text-brand-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-brand-line bg-white p-6 text-brand-mute" data-testid="admin-manual-payments-loading">
            Memuat pembayaran manual…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-brand-line bg-white p-6 text-brand-mute" data-testid="admin-manual-payments-empty">
            Belum ada pembayaran manual untuk status ini.
          </div>
        ) : (
          <div className="grid gap-4" data-testid="admin-manual-payments-list">
            {items.map((item) => {
              const isBusyApprove = busy === `approve:${item.order_id}`;
              const isBusyReject = busy === `reject:${item.order_id}`;
              const canReview = item.status !== "success";
              return (
                <div key={item.order_id} className="rounded-2xl border border-brand-line bg-white p-5 shadow-card">
                  <div className="grid lg:grid-cols-[1fr,260px] gap-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold uppercase text-brand">
                          {item.status}
                        </span>
                        <span className="font-mono text-xs text-brand-mute break-all">{item.order_id}</span>
                      </div>
                      <h2 className="font-heading font-extrabold text-xl mt-3">
                        {item.plan_label || item.plan_id} · {formatRupiah(item.amount)}
                      </h2>
                      <div className="mt-2 grid sm:grid-cols-2 gap-2 text-sm text-brand-mute">
                        <div><b>User:</b> {item.user_name || "-"}</div>
                        <div><b>Email:</b> {item.user_email || "-"}</div>
                        <div><b>Upload:</b> {formatDate(item.proof_uploaded_at)}</div>
                        <div><b>Dibuat:</b> {formatDate(item.created_at)}</div>
                      </div>

                      {item.admin_note ? (
                        <div className="mt-3 rounded-xl border border-brand-line bg-brand-off/50 p-3 text-sm">
                          <b>Catatan:</b> {item.admin_note}
                        </div>
                      ) : null}

                      {canReview ? (
                        <div className="mt-4">
                          <label className="block text-sm font-bold mb-1">Catatan admin opsional</label>
                          <textarea
                            rows={2}
                            value={notes[item.order_id] || ""}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [item.order_id]: e.target.value }))}
                            className="w-full rounded-xl border border-brand-line px-3 py-2 text-sm"
                            placeholder="Contoh: bukti valid / nominal kurang / QRIS tidak terbaca"
                          />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              onClick={() => review(item.order_id, "approve")}
                              disabled={!!busy || !item.proof_image}
                              className="rounded-xl bg-green-700 text-white font-bold"
                              data-testid={`admin-approve-manual-payment-${item.order_id}`}
                            >
                              {isBusyApprove ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                              Approve & Aktifkan Tier
                            </Button>
                            <Button
                              onClick={() => review(item.order_id, "reject")}
                              disabled={!!busy}
                              variant="outline"
                              className="rounded-xl border-red-200 text-red-700 hover:bg-red-50"
                              data-testid={`admin-reject-manual-payment-${item.order_id}`}
                            >
                              {isBusyReject ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                              Reject
                            </Button>
                          </div>
                          {!item.proof_image ? (
                            <div className="mt-2 text-xs text-orange-700 font-semibold">
                              User belum upload bukti pembayaran.
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-brand-line bg-brand-off/40 p-3">
                      {item.proof_image ? (
                        <a href={item.proof_image} target="_blank" rel="noreferrer">
                          <img src={item.proof_image} alt="Bukti bayar" className="w-full rounded-xl border border-brand-line object-contain bg-white" />
                        </a>
                      ) : (
                        <div className="aspect-square rounded-xl border border-dashed border-brand-line grid place-items-center text-sm text-brand-mute text-center px-4">
                          Belum ada bukti pembayaran
                        </div>
                      )}
                      <div className="mt-2 text-xs text-brand-mute break-all">
                        {item.proof_filename || "-"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
