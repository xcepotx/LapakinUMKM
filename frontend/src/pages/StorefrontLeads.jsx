import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MessageCircle, RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";

const STATUS_META = {
  new: { label: "Baru", cls: "bg-blue-100 text-blue-900 border-blue-200" },
  contacted: { label: "Dihubungi", cls: "bg-yellow-100 text-yellow-900 border-yellow-200" },
  done: { label: "Selesai", cls: "bg-green-100 text-green-900 border-green-200" },
  cancelled: { label: "Batal", cls: "bg-red-100 text-red-900 border-red-200" },
};

function formatCurrency(value) {
  if (value == null || value === "") return "-";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }); } catch { return value; }
}

function waHref(phone, lead) {
  const digits = String(phone || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  const text = `Halo ${lead.customer_name || ""}, saya dari toko. Mau follow up pesanan dari website Lapakin.`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
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
      toast.error(err?.response?.data?.detail || "Gagal memuat lead website");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      const status = lead.status || "new";
      if (filter !== "all" && status !== filter) return false;
      if (!q) return true;
      return [lead.customer_name, lead.customer_phone, lead.campaign_slug, lead.notes].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
    });
  }, [leads, filter, query]);

  const updateStatus = async (leadId, status) => {
    setBusy(`${leadId}:${status}`);
    try {
      const res = await api.put(`/shops/storefront-leads/${leadId}/status`, { status });
      const updated = res.data?.lead;
      setLeads((prev) => prev.map((lead) => (lead.lead_id === leadId ? { ...lead, ...(updated || {}), status } : lead)));
      toast.success("Status lead diperbarui");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Gagal update status lead");
    } finally {
      setBusy("");
    }
  };

  return (
    <DashboardLayout title="Lead Website" subtitle="Follow up calon pembeli dari storefront, campaign, dan checkout WhatsApp.">
      <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card" data-testid="lead-inbox-page">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama, nomor, campaign, catatan..." className="w-full rounded-xl border border-brand-line py-2 pl-9 pr-3 text-sm" data-testid="lead-inbox-search" />
          </div>
          <Button onClick={load} variant="outline" className="rounded-xl border-brand-line" data-testid="lead-inbox-refresh"><RefreshCcw className="mr-2 h-4 w-4" /> Refresh</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {["all", "new", "contacted", "done", "cancelled"].map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`rounded-full border px-4 py-2 text-xs font-extrabold ${filter === status ? "border-brand bg-brand text-white" : "border-brand-line bg-brand-off text-brand-ink"}`} data-testid={`lead-filter-${status}`}>{status === "all" ? "Semua" : STATUS_META[status].label}</button>)}
        </div>
        {loading ? <div className="mt-5 rounded-2xl border border-brand-line bg-brand-off p-5 text-brand-mute" data-testid="lead-inbox-loading">Memuat lead website…</div> : filtered.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-brand-line bg-brand-off p-6 text-center text-brand-mute" data-testid="lead-inbox-empty">Belum ada lead sesuai filter ini.</div> : <div className="mt-5 grid gap-4" data-testid="lead-inbox-list">{filtered.map((lead) => {
          const status = lead.status || "new";
          const meta = STATUS_META[status] || STATUS_META.new;
          const href = waHref(lead.customer_phone, lead);
          const itemNames = (lead.items || []).map((item) => item.name).filter(Boolean).slice(0, 3).join(", ");
          return <div key={lead.lead_id} className="rounded-2xl border border-brand-line bg-white p-4 shadow-sm" data-testid={`lead-inbox-item-${lead.lead_id}`}><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${meta.cls}`}>{meta.label}</span><span className="text-xs text-brand-mute">{formatDate(lead.created_at)}</span>{lead.campaign_slug ? <span className="rounded-full bg-brand-off px-2 py-1 text-xs font-bold text-brand">{lead.campaign_slug}</span> : null}</div><h2 className="mt-2 font-heading text-xl font-extrabold text-brand-ink">{lead.customer_name || "Tanpa nama"}</h2><div className="mt-1 text-sm text-brand-mute">{lead.customer_phone || "Nomor tidak diisi"} · Total {formatCurrency(lead.total)}</div>{itemNames ? <div className="mt-2 text-sm"><b>Item:</b> {itemNames}</div> : null}{lead.notes ? <div className="mt-2 rounded-xl bg-brand-off/70 p-3 text-sm text-brand-mute"><b>Catatan:</b> {lead.notes}</div> : null}</div><div className="flex flex-wrap gap-2 lg:justify-end">{href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xl bg-green-700 px-4 py-2 text-sm font-bold text-white hover:opacity-90"><MessageCircle className="mr-2 h-4 w-4" /> Chat WA</a> : null}{Object.entries(STATUS_META).map(([value, info]) => <Button key={value} type="button" variant={status === value ? "default" : "outline"} className="rounded-xl text-xs" disabled={!!busy || status === value} onClick={() => updateStatus(lead.lead_id, value)} data-testid={`lead-status-${lead.lead_id}-${value}`}>{busy === `${lead.lead_id}:${value}` ? "..." : status === value ? <CheckCircle2 className="h-4 w-4" /> : info.label}</Button>)}</div></div></div>;
        })}</div>}
      </div>
    </DashboardLayout>
  );
}
