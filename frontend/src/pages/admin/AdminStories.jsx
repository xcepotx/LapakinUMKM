import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Plus, Eye, EyeOff, Trash2, Sparkles, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

/**
 * AdminStories — manage UMKM success stories.
 * Admin can: generate AI draft from a shop, edit content, publish/unpublish, delete.
 */
export default function AdminStories() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftSlug, setDraftSlug] = useState("");
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/stories");
      setItems(r.data.items || []);
    } catch (_e) {
      toast.error("Gagal load cerita");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const generateDraft = async () => {
    if (!draftSlug.trim()) {
      toast.error("Masukkan slug toko (mis. warung-sari)");
      return;
    }
    setGenerating(true);
    try {
      const r = await api.post("/admin/stories/draft", { shop_slug: draftSlug.trim() });
      setItems((prev) => [r.data, ...prev]);
      setEditing(r.data);
      setDraftSlug("");
      toast.success("Draft dibuat — review & edit sebelum publish");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal generate draft");
    } finally {
      setGenerating(false);
    }
  };

  const saveEdit = async () => {
    try {
      const r = await api.patch(`/admin/stories/${editing.story_id}`, {
        title: editing.title,
        content_md: editing.content_md,
      });
      setItems((prev) => prev.map((s) => s.story_id === r.data.story_id ? r.data : s));
      setEditing(null);
      toast.success("Tersimpan");
    } catch (_e) {
      toast.error("Gagal simpan");
    }
  };

  const togglePublish = async (s) => {
    try {
      if (s.status === "published") {
        await api.post(`/admin/stories/${s.story_id}/unpublish`);
        toast.success("Cerita di-unpublish");
      } else {
        await api.post(`/admin/stories/${s.story_id}/publish`);
        toast.success("Cerita dipublikasikan ✨");
      }
      load();
    } catch (_e) {
      toast.error("Gagal ubah status");
    }
  };

  const remove = async (s) => {
    if (!confirm(`Hapus cerita "${s.title}" permanen?`)) return;
    try {
      await api.delete(`/admin/stories/${s.story_id}`);
      setItems((prev) => prev.filter((x) => x.story_id !== s.story_id));
      toast.success("Cerita dihapus");
    } catch (_e) {
      toast.error("Gagal hapus");
    }
  };

  return (
    <div className="min-h-screen bg-brand-paper">
      <div className="border-b border-brand-line bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link to="/admin" className="text-sm text-brand-mute hover:text-brand-ink font-semibold" data-testid="admin-stories-back">
              ← Admin
            </Link>
            <span className="text-brand-mute">/</span>
            <h1 className="font-heading font-bold">Cerita UMKM</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Generate new draft */}
        <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card mb-6">
          <h2 className="font-heading font-bold text-lg flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-brand" /> Generate Cerita Baru
          </h2>
          <p className="text-sm text-brand-mute mb-3">
            Masukkan slug toko (mis. <code className="bg-brand-off px-1 rounded">warung-sari</code>).
            AI akan generate draft cerita dari data toko + produk-produknya.
          </p>
          <div className="flex gap-2 flex-wrap">
            <input
              value={draftSlug}
              onChange={(e) => setDraftSlug(e.target.value)}
              placeholder="warung-sari"
              className="flex-1 min-w-0 rounded-lg border border-brand-line bg-white px-3 h-10 text-sm focus:outline-none focus:border-brand"
              data-testid="admin-stories-slug-input"
            />
            <Button
              onClick={generateDraft}
              disabled={generating}
              className="bg-brand text-white hover:bg-brand-dark rounded-lg h-10 px-4 font-bold"
              data-testid="admin-stories-generate">
              {generating
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Generating…</>
                : <><Plus className="w-4 h-4 mr-1.5" /> Generate Draft</>}
            </Button>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-8 text-brand-mute">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-brand-line">
            <p className="text-brand-mute">Belum ada cerita. Generate yang pertama!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((s) => (
              <div key={s.story_id} className="bg-white border border-brand-line rounded-2xl p-4 shadow-card"
                data-testid={`admin-story-${s.slug}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-brand-mute">
                        {s.shop_name}
                      </span>
                      <span className={`text-[10px] uppercase tracking-widest font-bold rounded-full px-2 py-0.5 ${
                        s.status === "published"
                          ? "bg-green-100 text-green-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}>
                        {s.status === "published" ? "Live" : "Draft"}
                      </span>
                    </div>
                    <h3 className="font-heading font-bold text-base">{s.title}</h3>
                    <p className="text-sm text-brand-mute mt-1 line-clamp-2">{s.excerpt}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {s.status === "published" && (
                      <Link to={`/cerita/${s.slug}`} target="_blank"
                        className="px-3 h-9 grid place-items-center rounded-lg border border-brand-line text-xs font-bold hover:bg-brand-off"
                        data-testid={`admin-story-view-${s.slug}`}>
                        Lihat
                      </Link>
                    )}
                    <Button onClick={() => setEditing(s)} variant="outline" size="sm"
                      className="rounded-lg border-brand-line h-9"
                      data-testid={`admin-story-edit-${s.slug}`}>
                      Edit
                    </Button>
                    <Button onClick={() => togglePublish(s)} variant="outline" size="sm"
                      className="rounded-lg border-brand-line h-9"
                      data-testid={`admin-story-toggle-${s.slug}`}>
                      {s.status === "published"
                        ? <><EyeOff className="w-3.5 h-3.5 mr-1" /> Unpublish</>
                        : <><Eye className="w-3.5 h-3.5 mr-1" /> Publish</>}
                    </Button>
                    <button onClick={() => remove(s)}
                      className="w-9 h-9 grid place-items-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                      data-testid={`admin-story-delete-${s.slug}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm grid place-items-center z-50 p-4"
          data-testid="admin-story-edit-modal">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-cardHover">
            <div className="p-5 border-b border-brand-line flex items-center justify-between">
              <h3 className="font-heading font-bold">Edit Cerita</h3>
              <button onClick={() => setEditing(null)} className="w-8 h-8 grid place-items-center rounded-lg hover:bg-brand-off"
                data-testid="admin-story-edit-close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-brand-mute">Judul</label>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="w-full mt-1 rounded-lg border border-brand-line bg-white px-3 h-10 text-sm focus:outline-none focus:border-brand"
                  data-testid="admin-story-edit-title"
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-brand-mute">Konten (Markdown)</label>
                <textarea
                  value={editing.content_md}
                  onChange={(e) => setEditing({ ...editing, content_md: e.target.value })}
                  rows={20}
                  className="w-full mt-1 rounded-lg border border-brand-line bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand"
                  data-testid="admin-story-edit-content"
                />
              </div>
            </div>
            <div className="p-5 border-t border-brand-line flex justify-end gap-2">
              <Button onClick={() => setEditing(null)} variant="outline" className="rounded-lg border-brand-line">Batal</Button>
              <Button onClick={saveEdit} className="bg-brand text-white hover:bg-brand-dark rounded-lg font-bold"
                data-testid="admin-story-edit-save">
                <Save className="w-4 h-4 mr-1.5" /> Simpan
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
