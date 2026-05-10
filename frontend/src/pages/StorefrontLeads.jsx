import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MessageCircle, RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";

const STATUS_META = {
  new: { label: "Baru", cls: "bg-blue-100 text-blue-900 border-blue-200" },
  contacted: { label: "Diproses", cls: "bg-yellow-100 text-yellow-900 border-yellow-200" },
  done: { label: "Selesai", cls: "bg-green-100 text-green-900 border-green-200" },
  cancelled: { label: "Batal", cls: "bg-red-100 text-red-900 border-red-200" },
};

const STATUS_FILTERS = ["all", "new", "contacted", "done", "cancelled"];

function formatCurrency(value) {
  if (value == null || value === "") return "-";

  const amount = Number(value || 0);

  if (!Number.isFinite(amount)) return "-";

  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

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

function formatFulfillment(value) {
  const raw = String(value || "").trim();

  if (raw === "pickup") return "Ambil di tempat";
  if (raw === "delivery") return "Kirim/delivery";
  if (raw === "discuss") return "Diskusikan via WhatsApp";

  return raw || "-";
}

function getLeadItems(lead) {
  return Array.isArray(lead?.items) ? lead.items : [];
}

function normalizeWhatsappPhone(phone) {
  const digits = String(phone || "").replace(/[^0-9]/g, "");

  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;

  return digits;
}

function buildFollowUpMessage(lead) {
  const items = getLeadItems(lead)
    .map((item, index) => {
      const name = item.name || item.product_name || `Item ${index + 1}`;
      const qty = Number(item.qty || 1);
      const subtotal = Number(item.price || 0) * qty;

      return `${index + 1}. ${name} x${qty}${subtotal ? ` - ${formatCurrency(subtotal)}` : ""}`;
    })
    .join("\n");

  return [
    `Halo ${lead.customer_name || ""}, saya dari toko.`,
    "Mau follow up pesanan dari website Lapakin.",
    "",
    items ? `Pesanan:\n${items}` : "",
    lead.total != null ? `Total: ${formatCurrency(lead.total)}` : "",
  ].filter(Boolean).join("\n");
}

function waHref(phone, lead) {
  const normalized = normalizeWhatsappPhone(phone);

  if (!normalized) return "";

  return `https://wa.me/${normalized}?text=${encodeURIComponent(buildFollowUpMessage(lead))}`;
}

function countByStatus(leads, status) {
  return leads.filter((lead) => (lead.status || "new") === status).length;
}

export default function StorefrontLeads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);

    try {
      const res = await api.get("/shops/storefront-leads?limit=100");
      setLeads(res.data?.leads || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Gagal memuat Order Inbox");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    return {
      total: leads.length,
      new: countByStatus(leads, "new"),
      contacted: countByStatus(leads, "contacted"),
      done: countByStatus(leads, "done"),
    };
  }, [leads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return leads.filter((lead) => {
      const status = lead.status || "new";

      if (filter !== "all" && status !== filter) return false;
      if (!q) return true;

      const itemText = getLeadItems(lead)
        .map((item) => item.name || item.product_name || "")
        .join(" ");

      return [
        lead.customer_name,
        lead.customer_phone,
        lead.campaign_slug,
        lead.notes,
        lead.internal_notes,
        lead.fulfillment_method,
        itemText,
        status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [leads, filter, query]);

  const updateStatus = async (leadId, status) => {
    setBusy(`${leadId}:${status}`);

    try {
      const res = await api.put(`/shops/storefront-leads/${leadId}/status`, { status });
      const updated = res.data?.lead;

      setLeads((prev) =>
        prev.map((lead) =>
          lead.lead_id === leadId ? { ...lead, ...(updated || {}), status } : lead
        )
      );

      toast.success("Status order diperbarui");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Gagal update status order");
    } finally {
      setBusy("");
    }
  };

  const updateInternalNotes = async (leadId, internalNotes) => {
    try {
      const res = await api.put(`/shops/storefront-leads/${leadId}/notes`, {
        internal_notes: internalNotes,
      });

      const updatedLead = res?.data || {};

      setLeads((items) =>
        items.map((lead) =>
          lead.lead_id === leadId
            ? { ...lead, ...updatedLead, internal_notes: internalNotes }
            : lead
        )
      );
    } catch (err) {
      console.error("Failed to update internal lead notes", err);
      toast.error("Gagal menyimpan catatan internal");
    }
  };

  return (
    <DashboardLayout
      title="Order Inbox"
      subtitle="Kelola pesanan dan lead dari checkout WhatsApp storefront."
    >
      <div className="space-y-5" data-testid="order-inbox-page">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card">
            <div className="text-xs font-extrabold uppercase tracking-wide text-brand-mute">Total masuk</div>
            <div className="mt-1 text-2xl font-black text-brand-ink">{stats.total}</div>
          </div>
          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card">
            <div className="text-xs font-extrabold uppercase tracking-wide text-brand-mute">Baru</div>
            <div className="mt-1 text-2xl font-black text-blue-700">{stats.new}</div>
          </div>
          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card">
            <div className="text-xs font-extrabold uppercase tracking-wide text-brand-mute">Diproses</div>
            <div className="mt-1 text-2xl font-black text-yellow-700">{stats.contacted}</div>
          </div>
          <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card">
            <div className="text-xs font-extrabold uppercase tracking-wide text-brand-mute">Selesai</div>
            <div className="mt-1 text-2xl font-black text-green-700">{stats.done}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card" data-testid="lead-inbox-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari nama, nomor, item, catatan..."
                className="w-full rounded-xl border border-brand-line py-2 pl-9 pr-3 text-sm"
                data-testid="lead-inbox-search"
              />
            </div>

            <Button
              onClick={load}
              variant="outline"
              className="rounded-xl border-brand-line"
              data-testid="lead-inbox-refresh"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setFilter(status)}
                className={`rounded-full border px-4 py-2 text-xs font-extrabold ${
                  filter === status
                    ? "border-brand bg-brand text-white"
                    : "border-brand-line bg-brand-off text-brand-ink"
                }`}
                data-testid={`lead-filter-${status}`}
              >
                {status === "all" ? "Semua" : STATUS_META[status].label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="mt-5 rounded-2xl border border-brand-line bg-brand-off p-5 text-brand-mute" data-testid="lead-inbox-loading">
              Memuat Order Inbox…
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-brand-line bg-brand-off p-6 text-center text-brand-mute" data-testid="lead-inbox-empty">
              Belum ada order sesuai filter ini.
            </div>
          ) : (
            <div className="mt-5 grid gap-4" data-testid="lead-inbox-list">
              {filtered.map((lead) => {
                const status = lead.status || "new";
                const meta = STATUS_META[status] || STATUS_META.new;
                const href = waHref(lead.customer_phone, lead);
                const items = getLeadItems(lead);

                return (
                  <div
                    key={lead.lead_id}
                    className="rounded-2xl border border-brand-line bg-white p-4 shadow-sm"
                    data-testid={`lead-inbox-item-${lead.lead_id}`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${meta.cls}`}>
                            {meta.label}
                          </span>
                          <span className="text-xs text-brand-mute">{formatDate(lead.created_at)}</span>
                          {lead.campaign_slug ? (
                            <span className="rounded-full bg-brand-off px-2 py-1 text-xs font-bold text-brand">
                              {lead.campaign_slug}
                            </span>
                          ) : null}
                        </div>

                        <h2 className="mt-2 font-heading text-xl font-extrabold text-brand-ink">
                          {lead.customer_name || "Tanpa nama"}
                        </h2>

                        <div className="mt-1 text-sm text-brand-mute">
                          {lead.customer_phone || "Nomor tidak diisi"} · {formatFulfillment(lead.fulfillment_method)}
                        </div>

                        <div className="mt-3 rounded-2xl bg-brand-off/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-extrabold uppercase tracking-wide text-brand-mute">
                              Ringkasan pesanan
                            </span>
                            <strong className="text-brand-ink">{formatCurrency(lead.total)}</strong>
                          </div>

                          {items.length ? (
                            <div className="mt-3 grid gap-2" data-testid={`lead-order-items-${lead.lead_id}`}>
                              {items.map((item, index) => {
                                const qty = Math.max(1, Number(item.qty || 1));
                                const price = Number(item.price || 0);
                                const subtotal = price * qty;
                                const name = item.name || item.product_name || `Item ${index + 1}`;

                                return (
                                  <div
                                    key={`${lead.lead_id}-${index}`}
                                    className="flex items-start justify-between gap-3 text-sm"
                                  >
                                    <span className="font-semibold text-brand-ink">
                                      {name} <span className="text-xs font-extrabold text-brand-mute">x{qty}</span>
                                    </span>
                                    <strong className="whitespace-nowrap text-brand-ink">
                                      {subtotal ? formatCurrency(subtotal) : "-"}
                                    </strong>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-brand-mute">Item pesanan tidak tercatat.</p>
                          )}
                        </div>

                        {lead.notes ? (
                          <div className="mt-3 rounded-xl bg-white p-3 text-sm text-brand-mute ring-1 ring-brand-line">
                            <b>Catatan customer:</b> {lead.notes}
                          </div>
                        ) : null}

                        <textarea
                          defaultValue={lead.internal_notes || ""}
                          onBlur={(event) => updateInternalNotes(lead.lead_id, event.target.value)}
                          rows={2}
                          className="mt-3 w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm text-brand-ink"
                          placeholder="Catatan internal follow-up"
                          data-testid={`lead-internal-notes-${lead.lead_id}`}
                        />
                      </div>

                      <div className="flex flex-wrap gap-2 lg:max-w-xs lg:justify-end">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-xl bg-green-700 px-4 py-2 text-sm font-bold text-white hover:opacity-90"
                          >
                            <MessageCircle className="mr-2 h-4 w-4" />
                            Chat WA
                          </a>
                        ) : null}

                        {Object.entries(STATUS_META).map(([value, info]) => (
                          <Button
                            key={value}
                            type="button"
                            variant={status === value ? "default" : "outline"}
                            className="rounded-xl text-xs"
                            disabled={!!busy || status === value}
                            onClick={() => updateStatus(lead.lead_id, value)}
                            data-testid={`lead-status-${lead.lead_id}-${value}`}
                          >
                            {busy === `${lead.lead_id}:${value}`
                              ? "..."
                              : status === value
                                ? <CheckCircle2 className="h-4 w-4" />
                                : info.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
