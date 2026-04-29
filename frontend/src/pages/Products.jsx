import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, rupiah } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import EditProductDialog from "@/components/EditProductDialog";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Package, Pencil } from "lucide-react";
import { toast } from "sonner";

export default function Products() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([api.get("/shops/me"), api.get("/products")]);
      if (!s.data) { navigate("/onboarding"); return; }
      setShop(s.data);
      setProducts(p.data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const remove = async (id) => {
    if (!window.confirm("Hapus produk ini?")) return;
    try {
      await api.delete(`/products/${id}`);
      setProducts((arr) => arr.filter((p) => p.product_id !== id));
      toast.success("Produk dihapus");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal hapus");
    }
  };

  const onSaved = (updated) => {
    setProducts((arr) => arr.map((p) => p.product_id === updated.product_id ? updated : p));
  };

  const primaryImg = (p) => {
    const arr = Array.isArray(p.images) && p.images.length ? p.images : (p.image_data ? [p.image_data] : []);
    if (!arr.length) return null;
    const first = arr[0];
    return first?.startsWith("data:") ? first : `data:image/png;base64,${first}`;
  };
  const imgCount = (p) => (Array.isArray(p.images) ? p.images.length : (p.image_data ? 1 : 0));

  return (
    <DashboardLayout
      shop={shop}
      title="Produk"
      subtitle="Kelola katalog produk tokomu."
      actions={
        <Button
          onClick={() => navigate("/dashboard/ai-studio")}
          className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
          data-testid="add-product-btn"
        >
          <Plus className="w-4 h-4 mr-2" /> Tambah dengan AI
        </Button>
      }
    >
      {loading ? (
        <div className="text-brand-mute" data-testid="products-loading">Memuat produk…</div>
      ) : products.length === 0 ? (
        <div className="bg-white border border-brand-line rounded-2xl p-12 text-center shadow-card">
          <Package className="w-10 h-10 mx-auto text-brand-mute" />
          <h3 className="font-heading font-bold text-xl mt-4">Belum ada produk</h3>
          <p className="text-brand-mute mt-2">Mulai dengan upload satu foto produk dan biarkan AI yang bekerja.</p>
          <Button
            onClick={() => navigate("/dashboard/ai-studio")}
            className="mt-6 bg-brand hover:bg-brand-hover text-white rounded-xl btn-press"
            data-testid="empty-add-product-btn"
          >
            <Plus className="w-4 h-4 mr-2" /> Buat Produk Pertama
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p) => {
            const img = primaryImg(p);
            const cnt = imgCount(p);
            return (
              <div key={p.product_id}
                className="bg-white border border-brand-line rounded-2xl overflow-hidden shadow-card card-hover hover:shadow-cardHover hover:border-brand/40"
                data-testid={`product-card-${p.product_id}`}
              >
                <div className="aspect-square bg-brand-off relative">
                  {img ? (
                    <img src={img} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-brand-mute">
                      <Package className="w-8 h-8" />
                    </div>
                  )}
                  {cnt > 1 && (
                    <span className="absolute top-2 right-2 bg-black/65 text-white text-[11px] font-bold rounded-full px-2 py-0.5">+{cnt - 1}</span>
                  )}
                  {p.source === "whatsapp" && (
                    <span className="absolute top-2 left-2 bg-green-600 text-white text-[10px] font-bold tracking-wider uppercase rounded-full px-2 py-0.5">via WA</span>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-heading font-bold truncate">{p.name}</h3>
                  <div className="text-brand text-lg font-extrabold mt-1">{rupiah(p.price)}</div>
                  {(shop?.sells_by || "stock") === "stock" && (
                    <div className="text-xs text-brand-mute mt-1">Stok: {p.stock || 0}</div>
                  )}
                  {(shop?.sells_by || "stock") === "hours" && (
                    <div className="text-xs text-brand-mute mt-1" data-testid={`days-label-${p.product_id}`}>
                      {p.available_days?.length ? `Tersedia: ${formatDays(p.available_days)}` : "Setiap hari"}
                    </div>
                  )}
                  {(shop?.sells_by || "stock") === "always" && (
                    <div className="text-xs text-brand-mute mt-1">Selalu tersedia</div>
                  )}
                  {p.description && <p className="text-sm text-brand-mute mt-2 line-clamp-2">{p.description}</p>}
                  <div className="mt-3 flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p)}
                      className="text-brand-ink hover:text-brand hover:bg-brand-off"
                      data-testid={`edit-${p.product_id}`}>
                      <Pencil className="w-4 h-4 mr-1" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(p.product_id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      data-testid={`delete-${p.product_id}`}>
                      <Trash2 className="w-4 h-4 mr-1" /> Hapus
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <EditProductDialog
        product={editing}
        shop={shop}
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onSaved={onSaved}
      />
    </DashboardLayout>
  );
}

const DAY_LABELS_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
function formatDays(arr) {
  if (!Array.isArray(arr) || !arr.length) return "Setiap hari";
  return [...arr].sort((a, b) => a - b).map((d) => DAY_LABELS_SHORT[d] || "").filter(Boolean).join(", ");
}
