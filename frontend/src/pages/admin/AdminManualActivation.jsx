import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCcw, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const TIERS = ["free", "starter", "pro", "business"];
const TIER_LABEL = { free: "Gratis", starter: "Starter", pro: "Pro", business: "Bisnis" };
function formatDate(value) { if (!value) return "-"; try { return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }); } catch { return value; } }

export default function AdminManualActivation() {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [tierDraft, setTierDraft] = useState({});
  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/users?q=${encodeURIComponent(q)}&limit=100`);
      const list = Array.isArray(res.data) ? res.data : [];
      setUsers(list);
      const next = {};
      list.forEach((user) => { next[user.user_id] = user.tier || "free"; });
      setTierDraft(next);
    } catch (err) { toast.error(err?.response?.data?.detail || "Gagal memuat user"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const activate = async (user) => {
    const tier = tierDraft[user.user_id] || user.tier || "free";
    if (!window.confirm(`Aktifkan tier ${TIER_LABEL[tier] || tier} untuk ${user.email}?`)) return;
    setBusy(user.user_id);
    try { await api.post(`/admin/users/${user.user_id}/tier`, { tier }); toast.success("Tier user berhasil diaktifkan manual"); await load(); }
    catch (err) { toast.error(err?.response?.data?.detail || "Gagal aktivasi tier manual"); }
    finally { setBusy(""); }
  };
  return <div className="min-h-screen bg-brand-sand"><header className="border-b border-brand-line bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4"><div><Link to="/admin" className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline"><ArrowLeft className="h-4 w-4" /> Admin</Link><h1 className="mt-1 font-heading text-2xl font-extrabold">Aktivasi Tier Manual</h1><p className="text-sm text-brand-mute">Aktifkan paket user secara manual selama payment upgrade belum tersedia.</p></div><Button onClick={load} variant="outline" className="rounded-xl border-brand-line" data-testid="admin-manual-activation-refresh"><RefreshCcw className="mr-2 h-4 w-4" /> Refresh</Button></div></header><main className="mx-auto max-w-6xl px-4 py-6"><div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="admin-manual-activation-note">QRIS Lapakin untuk upgrade tier sedang menunggu approval. Gunakan halaman ini untuk aktivasi manual user yang sudah kamu verifikasi secara offline.</div><form className="mt-5 flex flex-col gap-3 rounded-2xl border border-brand-line bg-white p-4 shadow-card sm:flex-row" onSubmit={(e) => { e.preventDefault(); load(); }}><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama/email user..." className="w-full rounded-xl border border-brand-line py-2 pl-9 pr-3 text-sm" data-testid="admin-manual-activation-search" /></div><Button type="submit" className="rounded-xl bg-brand text-white font-bold">Cari</Button></form>{loading ? <div className="mt-5 rounded-2xl border border-brand-line bg-white p-6 text-brand-mute" data-testid="admin-manual-activation-loading">Memuat user…</div> : users.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-brand-line bg-white p-6 text-center text-brand-mute" data-testid="admin-manual-activation-empty">User tidak ditemukan.</div> : <div className="mt-5 grid gap-4" data-testid="admin-manual-activation-list">{users.map((user) => <div key={user.user_id} className="rounded-2xl border border-brand-line bg-white p-5 shadow-card"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="font-heading text-xl font-extrabold">{user.name || "Tanpa nama"}</div><div className="text-sm text-brand-mute break-all">{user.email}</div><div className="mt-2 grid gap-1 text-xs text-brand-mute sm:grid-cols-2"><div>User ID: <span className="font-mono">{user.user_id}</span></div><div>Tier sekarang: <b>{TIER_LABEL[user.tier] || user.tier || "Gratis"}</b></div><div>Status: <b>{user.subscription_status || "-"}</b></div><div>Expired: {formatDate(user.subscription_expires_at)}</div></div></div><div className="flex flex-wrap items-center gap-2"><select value={tierDraft[user.user_id] || user.tier || "free"} onChange={(e) => setTierDraft((prev) => ({ ...prev, [user.user_id]: e.target.value }))} className="h-11 rounded-xl border border-brand-line bg-white px-3 text-sm font-bold" data-testid={`admin-manual-tier-select-${user.user_id}`}>{TIERS.map((tier) => <option key={tier} value={tier}>{TIER_LABEL[tier]}</option>)}</select><Button onClick={() => activate(user)} disabled={!!busy} className="rounded-xl bg-brand text-white font-bold" data-testid={`admin-manual-activate-${user.user_id}`}><ShieldCheck className="mr-2 h-4 w-4" />{busy === user.user_id ? "Menyimpan…" : "Aktifkan"}</Button></div></div></div>)}</div>}</main></div>;
}
