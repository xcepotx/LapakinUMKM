import { useEffect, useState } from "react";
import api, { formatApiError, rupiah } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function AdminProducts() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (search = "") => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/products`, { params: { q: search } });
      setItems(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (p) => {
    if (!window.confirm(`Hapus produk "${p.name}" dari toko? Aksi ini ter-log.`)) return;
    try {
      await api.delete(`/admin/products/${p.product_id}`);
      setItems((arr) => arr.filter((x) => x.product_id !== p.product_id));
      toast.success("Produk dihapus");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal"); }
  };

  return (
    <AdminLayout title="Moderasi Produk" subtitle="Hapus produk yang melanggar dari toko mana pun.">
      <div className="bg-white border border-brand-line rounded-2xl shadow-card overflow-hidden">
        <div className="p-4 border-b border-brand-line flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
            <Input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(q)}
              placeholder="Cari nama produk…"
              className="pl-10 rounded-xl border-brand-line h-10"
              data-testid="admin-products-search" />
          </div>
          <Button onClick={() => load(q)} variant="outline" className="rounded-xl border-brand-line">Cari</Button>
        </div>
        {loading ? <div className="p-8 text-brand-mute">Memuat…</div> : items.length === 0 ? (
          <div className="p-12 text-center text-brand-mute">Tidak ada produk.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-off/60 text-left text-brand-mute uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-5 py-3 font-bold">Produk</th>
                  <th className="px-5 py-3 font-bold">Toko</th>
                  <th className="px-5 py-3 font-bold">Harga</th>
                  <th className="px-5 py-3 font-bold">Stok</th>
                  <th className="px-5 py-3 font-bold">Sumber</th>
                  <th className="px-5 py-3 font-bold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {items.map((p) => (
                  <tr key={p.product_id} className="hover:bg-brand-off/30" data-testid={`admin-prod-row-${p.product_id}`}>
                    <td className="px-5 py-3 font-semibold">{p.name}</td>
                    <td className="px-5 py-3 text-xs text-brand-mute">{p.shop_id}</td>
                    <td className="px-5 py-3">{rupiah(p.price)}</td>
                    <td className="px-5 py-3">{p.stock || 0}</td>
                    <td className="px-5 py-3 text-xs">
                      {p.source === "whatsapp" ? <span className="bg-green-100 text-green-800 rounded px-2 py-0.5 text-[10px] font-bold">WA</span> : "web"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => remove(p)}
                        className="text-red-600" data-testid={`admin-del-${p.product_id}`}>
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Hapus
                      </Button>
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
