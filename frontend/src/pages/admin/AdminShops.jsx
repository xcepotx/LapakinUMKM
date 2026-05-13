import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, StarOff, Power, ExternalLink, Search, Trash2, LayoutDashboard} from "lucide-react";
import { toast } from "sonner";

export default function AdminShops() {
  const [shops, setShops] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  // LAPAKIN_ADMIN_SHOP_SOFT_DELETE_V1
  const [deletingId, setDeletingId] = useState("");

  const load = async (search = "") => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/shops`, { params: { q: search } });
      setShops((data || []).filter((shop) => !shop.deleted_at && shop.status !== "deleted"));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleStatus = async (s) => {
    const next = s.status === "suspended" ? "active" : "suspended";
    if (next === "suspended" && !window.confirm(`Suspend toko "${s.name}"?`)) return;
    try {
      await api.put(`/admin/shops/${s.shop_id}/status`, { status: next });
      toast.success(`Toko ${next === "active" ? "diaktifkan" : "disuspend"}`);
      setShops((arr) => arr.map((x) => x.shop_id === s.shop_id ? { ...x, status: next } : x));
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal"); }
  };
  const toggleFeatured = async (s) => {
    const next = !s.featured;
    try {
      await api.put(`/admin/shops/${s.shop_id}/featured`, { featured: next });
      toast.success(next ? "Ditandai unggulan" : "Dihapus dari unggulan");
      setShops((arr) => arr.map((x) => x.shop_id === s.shop_id ? { ...x, featured: next } : x));
    } catch (e) { toast.error("Gagal"); }
  };

  // LAPAKIN_ADMIN_SHOP_SOFT_DELETE_V1
  const softDeleteShop = async (s) => {
    if (!s?.shop_id) return;

    const slug = String(s.slug || "").trim();
    const typed = window.prompt(
      `Hapus toko "${s.name || slug}"?\n\n` +
      "Ini adalah soft delete: produk, sales, leads, dan analytics tetap disimpan, " +
      "tapi toko tidak tampil publik dan hilang dari list admin.\n\n" +
      `Ketik slug toko untuk konfirmasi: ${slug}`
    );

    if (typed === null) return;

    if (typed.trim() !== slug) {
      toast.error("Konfirmasi gagal. Slug tidak cocok.");
      return;
    }

    if (!window.confirm(`Konfirmasi terakhir: hapus/arsipkan toko "${s.name || slug}" sekarang?`)) return;

    setDeletingId(s.shop_id);

    try {
      const { data } = await api.delete(`/admin/shops/${s.shop_id}`);
      const counts = data?.dependency_counts || {};
      const totalDependencies = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);

      setShops((arr) => arr.filter((x) => x.shop_id !== s.shop_id));
      toast.success(
        totalDependencies
          ? `Toko dihapus. ${totalDependencies} data terkait tetap diarsipkan.`
          : "Toko dihapus."
      );
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal menghapus toko");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <AdminLayout title="Toko UMKM" subtitle="Kelola semua toko di platform.">
      <div className="bg-white border border-brand-line rounded-2xl shadow-card overflow-hidden">
        <div className="p-4 border-b border-brand-line flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(q)}
              placeholder="Cari nama atau slug…"
              className="pl-10 rounded-xl border-brand-line h-10"
              data-testid="admin-shops-search"
            />
          </div>
          <Button onClick={() => load(q)} variant="outline" className="rounded-xl border-brand-line" data-testid="admin-shops-search-btn">
            Cari
          </Button>
        </div>

        {loading ? (
          <div className="p-8 text-brand-mute" data-testid="admin-shops-loading">Memuat…</div>
        ) : shops.length === 0 ? (
          <div className="p-12 text-center text-brand-mute">Tidak ada toko.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-off/60 text-left text-brand-mute uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-5 py-3 font-bold">Toko</th>
                  <th className="px-5 py-3 font-bold">Owner</th>
                  <th className="px-5 py-3 font-bold">Tipe</th>
                  <th className="px-5 py-3 font-bold text-center">Produk</th>
                  <th className="px-5 py-3 font-bold">Status</th>
                  <th className="px-5 py-3 font-bold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {shops.map((s) => (
                  <tr key={s.shop_id} className="hover:bg-brand-off/30" data-testid={`admin-shop-row-${s.shop_id}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg grid place-items-center text-white font-bold text-xs"
                          style={{ background: s.brand_color || "#C04A3B" }}>
                          {(s.name || "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold flex items-center gap-1.5">
                            {s.name}
                            {s.featured && <Star className="w-3.5 h-3.5 fill-brand-accent text-brand-accent" />}
                          </div>
                          <div className="text-xs text-brand-mute">/toko/{s.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-xs">{s.owner?.name || "-"}</div>
                      <div className="text-xs text-brand-mute">{s.owner?.email}</div>
                      {["starter", "pro", "business"].includes(s.owner?.tier) && <span className="text-[10px] font-bold rounded bg-brand-accent/20 text-brand px-1.5 py-0.5">{String(s.owner?.tier || "").toUpperCase()}</span>}
                    </td>
                    <td className="px-5 py-3 text-xs">{s.business_type}</td>
                    <td className="px-5 py-3 text-center">{s.product_count}</td>
                    <td className="px-5 py-3">
                      {s.status === "suspended" ? (
                        <span className="text-xs font-bold rounded-full bg-red-100 text-red-700 px-2 py-1">SUSPEND</span>
                      ) : (
                        <span className="text-xs font-bold rounded-full bg-green-100 text-green-800 px-2 py-1">AKTIF</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {/* LAPAKIN_ADMIN_TENANT_VIEW_PHASE1B_READONLY_V2 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(`/admin/tenant-view/${s.shop_id}`, "_blank")}
                          title="Lihat dashboard tenant (read-only)"
                          className="text-brand"
                          data-testid={`tenant-view-${s.shop_id}`}
                        >
                          <LayoutDashboard className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => window.open(`/toko/${s.slug}`, "_blank")} title="Lihat storefront publik">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleFeatured(s)}
                          className="text-brand-accent" data-testid={`featured-${s.shop_id}`}>
                          {s.featured ? <Star className="w-4 h-4 fill-brand-accent" /> : <StarOff className="w-4 h-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleStatus(s)}
                          className={s.status === "suspended" ? "text-green-700" : "text-red-600"}
                          data-testid={`status-${s.shop_id}`}>
                          <Power className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => softDeleteShop(s)}
                          disabled={deletingId === s.shop_id}
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          title="Hapus toko"
                          data-testid={`delete-${s.shop_id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
