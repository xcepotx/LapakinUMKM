import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import api, { formatApiError } from "@/lib/api";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Store,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "waiting", label: "Waiting" },
  { value: "done", label: "Done" },
  { value: "all", label: "Semua" },
];

const HEALTH_FILTERS = [
  { value: "attention", label: "Perlu perhatian" },
  { value: "critical", label: "Kritis" },
  { value: "onboarding", label: "Perlu onboarding" },
  { value: "healthy", label: "Sehat" },
  { value: "all", label: "Semua health" },
];

function formatDate(value, withTime = true) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function statusLabel(value) {
  if (value === "new") return "New";
  if (value === "contacted") return "Contacted";
  if (value === "waiting") return "Waiting";
  if (value === "done") return "Done";
  return value || "New";
}

function statusClass(value) {
  if (value === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "waiting") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "contacted") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function healthLabel(value) {
  if (value === "healthy") return "Sehat";
  if (value === "onboarding") return "Perlu onboarding";
  if (value === "critical") return "Kritis";
  return value || "-";
}

function healthClass(value) {
  if (value === "healthy") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "onboarding") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "critical") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function isoFromDateInput(value) {
  if (!value) return "";
  const date = new Date(`${value}T09:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function dateInputFromIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export default function AdminOnboardingQueue() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [status, setStatus] = useState("open");
  const [health, setHealth] = useState("attention");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState("");

  const load = async (nextStatus = status, nextHealth = health, nextQ = q) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/onboarding/queue", {
        params: {
          status: nextStatus,
          health: nextHealth,
          q: nextQ,
          limit: 100,
        },
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setSummary(data?.summary || {});
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Gagal memuat onboarding queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("open", "attention", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedStatusLabel = useMemo(
    () => STATUS_FILTERS.find((item) => item.value === status)?.label || "Open",
    [status]
  );
  const selectedHealthLabel = useMemo(
    () => HEALTH_FILTERS.find((item) => item.value === health)?.label || "Perlu perhatian",
    [health]
  );

  const submitSearch = (event) => {
    event.preventDefault();
    setQ(search);
    load(status, health, search);
  };

  const changeStatus = (value) => {
    setStatus(value);
    load(value, health, q);
  };

  const changeHealth = (value) => {
    setHealth(value);
    load(status, value, q);
  };

  const addNote = async (item) => {
    const note = window.prompt(`Catatan follow-up untuk ${item.name}:`, item.gaps?.[0] || "Follow up onboarding toko");
    if (note === null || !note.trim()) return;

    setActingId(`${item.shop_id}:note`);
    try {
      await api.post(`/admin/onboarding/${item.shop_id}/note`, { note });
      toast.success("Catatan follow-up ditambahkan");
      await load(status, health, q);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Gagal menambah catatan");
    } finally {
      setActingId("");
    }
  };

  const updateStatus = async (item, nextStatus) => {
    const note = window.prompt(`Catatan untuk status ${nextStatus}:`, "");
    if (note === null) return;

    const dateText = window.prompt("Next follow-up date (YYYY-MM-DD), kosongkan jika tidak perlu:", dateInputFromIso(item.next_follow_up_at));
    if (dateText === null) return;

    setActingId(`${item.shop_id}:status:${nextStatus}`);
    try {
      await api.post(`/admin/onboarding/${item.shop_id}/status`, {
        status: nextStatus,
        note,
        next_follow_up_at: isoFromDateInput(dateText),
      });
      toast.success(`Status onboarding diubah ke ${nextStatus}`);
      await load(status, health, q);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Gagal mengubah status");
    } finally {
      setActingId("");
    }
  };

  const markDone = async (item) => {
    const note = window.prompt(`Catatan penyelesaian onboarding untuk ${item.name}:`, "Onboarding selesai");
    if (note === null) return;

    setActingId(`${item.shop_id}:done`);
    try {
      await api.post(`/admin/onboarding/${item.shop_id}/done`, { note });
      toast.success("Onboarding ditandai selesai");
      await load(status, health, q);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Gagal menyelesaikan onboarding");
    } finally {
      setActingId("");
    }
  };

  return (
    <AdminLayout
      title="Onboarding Follow-up"
      subtitle="Queue toko yang butuh bantuan onboarding berdasarkan Store Health Score."
    >
      <div className="space-y-5" data-testid="admin-onboarding-queue-page">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Open</div>
            <div className="mt-1 text-2xl font-extrabold text-brand-ink">{summary.open ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Contacted</div>
            <div className="mt-1 text-2xl font-extrabold text-blue-700">{summary.contacted ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Waiting</div>
            <div className="mt-1 text-2xl font-extrabold text-amber-700">{summary.waiting ?? 0}</div>
          </div>
          <div className="rounded-3xl border border-brand-line bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-mute">Done</div>
            <div className="mt-1 text-2xl font-extrabold text-emerald-700">{summary.done ?? 0}</div>
          </div>
        </div>

        <div className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-brand" />
                <h3 className="text-lg font-extrabold text-brand-ink">Queue onboarding toko</h3>
              </div>
              <p className="mt-1 text-sm text-brand-mute">
                Status: {selectedStatusLabel} · Health: {selectedHealthLabel}
              </p>
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
                onClick={() => load(status, health, q)}
                className="rounded-2xl border border-brand-line bg-white px-3 py-2 text-brand-ink"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </form>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
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

          <div className="mb-4 flex flex-wrap gap-2">
            {HEALTH_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => changeHealth(item.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${
                  health === item.value
                    ? "border-brand bg-brand text-white"
                    : "border-brand-line bg-white text-brand-ink hover:bg-brand-off"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Memuat onboarding queue...</div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">Tidak ada toko pada filter ini.</div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.shop_id} className="rounded-3xl border border-brand-line bg-brand-off/30 p-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Store className="h-4 w-4 text-brand" />
                        <div className="font-extrabold text-brand-ink">{item.name || "-"}</div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${healthClass(item.health_status)}`}>
                          {healthLabel(item.health_status)} · {item.score}/100
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${statusClass(item.followup_status)}`}>
                          {statusLabel(item.followup_status)}
                        </span>
                      </div>

                      <div className="mt-1 text-xs text-brand-mute">
                        /{item.slug || "-"} · Owner: <span className="font-bold text-brand-ink">{item.owner_email || "-"}</span> · WA: {item.owner_whatsapp || item.whatsapp || "-"}
                      </div>

                      <div className="mt-3 grid gap-3 lg:grid-cols-3">
                        <div className="rounded-2xl bg-white/80 p-3">
                          <div className="mb-1 text-xs font-extrabold text-brand-ink">Gap utama</div>
                          <ul className="list-disc pl-4 text-xs text-brand-mute">
                            {(item.gaps || []).slice(0, 5).map((gap) => (
                              <li key={gap}>{gap}</li>
                            ))}
                            {(item.gaps || []).length === 0 ? <li>Semua indikator utama aman.</li> : null}
                          </ul>
                        </div>

                        <div className="rounded-2xl bg-white/80 p-3 text-xs text-brand-mute">
                          <div className="mb-1 font-extrabold text-brand-ink">Follow-up</div>
                          <div>Last: {formatDate(item.last_follow_up_at)}</div>
                          <div>Next: {formatDate(item.next_follow_up_at, false)}</div>
                          <div>Updated: {formatDate(item.followup_updated_at)}</div>
                          <div className="mt-1">Catatan: {item.last_note || "-"}</div>
                        </div>

                        <div className="rounded-2xl bg-white/80 p-3 text-xs text-brand-mute">
                          <div className="mb-1 font-extrabold text-brand-ink">Traffic/Billing</div>
                          <div>Kunjungan: {item.visits ?? 0}</div>
                          <div>Klik WA: {item.whatsapp_clicks ?? 0}</div>
                          <div>Produk: {item.products_count ?? 0}</div>
                          <div>Tier: {item.owner_tier || "free"}</div>
                          <div>Trial: {item.owner_trial ? "aktif" : item.owner_trial_expired ? "expired" : "-"}</div>
                        </div>
                      </div>
                    </div>

                    <div className="grid min-w-[180px] gap-2">
                      <button
                        type="button"
                        onClick={() => addNote(item)}
                        disabled={actingId === `${item.shop_id}:note`}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-brand px-3 py-2 text-xs font-extrabold text-white disabled:opacity-60"
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                        Tambah catatan
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(item, "contacted")}
                        disabled={actingId === `${item.shop_id}:status:contacted`}
                        className="rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-extrabold text-brand-ink hover:bg-brand-off disabled:opacity-60"
                      >
                        Set Contacted
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(item, "waiting")}
                        disabled={actingId === `${item.shop_id}:status:waiting`}
                        className="inline-flex items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-extrabold text-amber-700 disabled:opacity-60"
                      >
                        <CalendarClock className="h-3.5 w-3.5" />
                        Set Waiting
                      </button>
                      <button
                        type="button"
                        onClick={() => markDone(item)}
                        disabled={actingId === `${item.shop_id}:done`}
                        className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-700 disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Mark Done
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
