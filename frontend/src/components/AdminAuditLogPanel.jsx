import { useEffect, useState } from "react";
import api from "@/lib/api";
import { History, RefreshCw } from "lucide-react";

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

function shortValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 180);
  return String(value);
}

export default function AdminAuditLogPanel({ refreshKey = 0, targetUserId = "" }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/audit-logs", {
        params: {
          limit: 20,
          ...(targetUserId ? { target_user_id: targetUserId } : {}),
        },
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || "Gagal memuat audit log.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, targetUserId]);

  return (
    <div className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm" data-testid="admin-audit-log-panel">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-brand" />
            <h3 className="text-lg font-extrabold text-brand-ink">Audit Log Admin</h3>
          </div>
          <p className="mt-1 text-sm text-brand-mute">Aktivitas admin terbaru untuk trial, billing, dan perubahan operasional.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-2xl border border-brand-line bg-white px-3 py-2 text-sm font-bold text-brand-ink hover:bg-brand-off"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-brand-off/60 px-4 py-6 text-sm text-brand-mute">Memuat audit log...</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">{error}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-brand-off/60 px-4 py-6 text-sm text-brand-mute">Belum ada audit log.</div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.audit_id || item.created_at} className="rounded-2xl border border-brand-line bg-brand-off/40 p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="font-extrabold text-brand-ink">{item.action || "-"}</div>
                <div className="text-xs font-semibold text-brand-mute">{formatDate(item.created_at)}</div>
              </div>
              <div className="mt-1 text-xs text-brand-mute">
                Admin: <span className="font-bold text-brand-ink">{item.admin_email || item.admin_user_id || "-"}</span>
                {" · "}
                Target: <span className="font-bold text-brand-ink">{item.target_email || item.target_user_id || item.target_id || "-"}</span>
              </div>
              {item.reason ? <div className="mt-1 text-xs text-brand-mute">Alasan: {item.reason}</div> : null}
              <div className="mt-2 grid gap-2 text-[11px] md:grid-cols-2">
                <div className="rounded-xl bg-white/80 p-2">
                  <div className="font-bold text-brand-ink">Before</div>
                  <div className="break-words text-brand-mute">{shortValue(item.before)}</div>
                </div>
                <div className="rounded-xl bg-white/80 p-2">
                  <div className="font-bold text-brand-ink">After</div>
                  <div className="break-words text-brand-mute">{shortValue(item.after)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
