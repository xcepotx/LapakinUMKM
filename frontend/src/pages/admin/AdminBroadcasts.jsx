import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Megaphone, Trash2, Power } from "lucide-react";
import { toast } from "sonner";

const VARIANTS = [
  { id: "info", label: "Info", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { id: "success", label: "Sukses", color: "bg-green-100 text-green-800 border-green-200" },
  { id: "warning", label: "Penting", color: "bg-amber-100 text-amber-800 border-amber-200" },
];
const TARGETS = [
  { id: "all", label: "Banner di Dashboard (semua user)" },
  { id: "whatsapp", label: "Kirim via WhatsApp ke yang terhubung" },
];

export default function AdminBroadcasts() {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [variant, setVariant] = useState("info");
  const [target, setTarget] = useState("all");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const { data } = await api.get("/admin/broadcasts");
    setItems(data || []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!title || !message) { toast.error("Judul & pesan wajib diisi"); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post("/admin/broadcasts", { title, message, target, variant, active: true });
      toast.success(target === "whatsapp" ? `Terkirim ke ${data.wa_sent || 0} user WA` : "Banner aktif");
      setTitle(""); setMessage("");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal"); }
    finally { setSubmitting(false); }
  };

  const toggle = async (b) => {
    try {
      await api.put(`/admin/broadcasts/${b.broadcast_id}/active`, { featured: !b.active });
      load();
    } catch (e) { toast.error("Gagal"); }
  };
  const remove = async (b) => {
    if (!window.confirm("Hapus broadcast ini?")) return;
    try {
      await api.delete(`/admin/broadcasts/${b.broadcast_id}`);
      load();
    } catch (e) { toast.error("Gagal"); }
  };

  return (
    <AdminLayout title="Broadcast" subtitle="Kirim pengumuman ke semua user via banner atau WhatsApp.">
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Composer */}
        <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-brand" />
            <h2 className="font-heading font-bold text-lg">Buat Broadcast Baru</h2>
          </div>
          <div className="mt-5 space-y-4">
            <div>
              <Label>Judul</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
                placeholder="Contoh: Update fitur baru!"
                className="mt-1 rounded-xl border-brand-line h-12" data-testid="bc-title" />
            </div>
            <div>
              <Label>Pesan</Label>
              <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500}
                placeholder="Ceritakan apa yang baru…"
                className="mt-1 rounded-xl border-brand-line" data-testid="bc-message" />
            </div>
            <div>
              <Label>Tipe</Label>
              <div className="mt-2 flex gap-2">
                {VARIANTS.map((v) => (
                  <button key={v.id} onClick={() => setVariant(v.id)} type="button"
                    className={`text-sm font-semibold rounded-full px-4 py-2 border ${variant === v.id ? v.color + " border-current" : "bg-white border-brand-line"}`}
                    data-testid={`bc-variant-${v.id}`}>{v.label}</button>
                ))}
              </div>
            </div>
            <div>
              <Label>Tujuan</Label>
              <div className="mt-2 space-y-2">
                {TARGETS.map((t) => (
                  <button key={t.id} type="button" onClick={() => setTarget(t.id)}
                    className={`w-full text-left text-sm rounded-xl px-4 py-3 border ${target === t.id ? "bg-brand text-white border-brand" : "bg-white border-brand-line"}`}
                    data-testid={`bc-target-${t.id}`}>{t.label}</button>
                ))}
              </div>
            </div>
            <Button onClick={create} disabled={submitting}
              className="w-full bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
              data-testid="bc-create-btn">
              {submitting ? "Mengirim…" : "Kirim Broadcast"}
            </Button>
          </div>
        </div>

        {/* List */}
        <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
          <h2 className="font-heading font-bold text-lg">Riwayat Broadcast</h2>
          <div className="mt-4 space-y-3">
            {items.length === 0 ? (
              <div className="text-sm text-brand-mute py-6 text-center">Belum ada broadcast.</div>
            ) : items.map((b) => (
              <div key={b.broadcast_id} className="rounded-xl border border-brand-line p-4 bg-brand-off/30"
                data-testid={`bc-item-${b.broadcast_id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{b.title}</span>
                      {b.active && <span className="text-[10px] font-bold bg-green-600 text-white rounded px-1.5 py-0.5">AKTIF</span>}
                      <span className="text-[10px] uppercase tracking-wider font-bold text-brand-mute">{b.target}</span>
                    </div>
                    <p className="text-sm text-brand-mute mt-1 line-clamp-2">{b.message}</p>
                    <div className="text-xs text-brand-mute mt-2">{new Date(b.created_at).toLocaleString("id-ID")}</div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button variant="ghost" size="sm" onClick={() => toggle(b)} className={b.active ? "text-amber-600" : "text-green-700"}>
                      <Power className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(b)} className="text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
