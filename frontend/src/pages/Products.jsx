import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, rupiah } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import EditProductDialog from "@/components/EditProductDialog";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Package, Pencil, Image as ImageIcon, Smartphone, Share2, Instagram, Loader2, Search, Tag } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const rupiahShort = (n) => `Rp ${(n || 0).toLocaleString("id-ID")}`;

// LAPAKIN_PRODUCT_CATEGORY_MVP
function getProductCategoryName(product) {
  return String(
    product?.category_name ||
    product?.category ||
    product?.product_category ||
    product?.type ||
    ""
  ).trim();
}

function getProductCategoryKey(product) {
  return getProductCategoryName(product).toLowerCase();
}

function productMatchesSearch(product, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;

  return [
    product?.name,
    product?.description,
    getProductCategoryName(product),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

// LAPAKIN_PRODUCT_AVAILABILITY_F1
const PRODUCT_AVAILABILITY_OPTIONS = [
  { value: "active", label: "Tampil", badge: "bg-green-50 text-green-700 border-green-200" },
  { value: "out_of_stock", label: "Habis", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "hidden", label: "Disembunyikan", badge: "bg-slate-100 text-slate-600 border-slate-200" },
];

function getProductAvailabilityStatus(product) {
  const raw = String(product?.availability_status || "").trim().toLowerCase();
  if (raw === "out_of_stock" || raw === "hidden") return raw;
  if (product?.is_active === false) return "hidden";
  return "active";
}

function getProductAvailabilityMeta(product) {
  const status = getProductAvailabilityStatus(product);
  return PRODUCT_AVAILABILITY_OPTIONS.find((item) => item.value === status) || PRODUCT_AVAILABILITY_OPTIONS[0];
}


// Web-Share-API-aware share. Tries to attach the IG Story PNG.
// On mobile Chrome/Safari/WhatsApp browser, opens the OS share sheet which
// includes "WhatsApp → Status" as a target. Falls back to wa.me text-only on desktop.
async function sharePhotoOrFallback({ url, filename, caption, fallbackUrl }) {
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error("fetch fail");
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: caption, title: filename });
      return "shared";
    }
    // No file share support → trigger download then open WA Web
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(dlUrl), 2000);
    if (fallbackUrl) window.open(fallbackUrl, "_blank");
    return "downloaded";
  } catch (e) {
    if (fallbackUrl) window.open(fallbackUrl, "_blank");
    return "error";
  }
}

export default function Products() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPaid = (user?.tier || "free") !== "free";
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [publishingIG, setPublishingIG] = useState(null);
  const [productSearch, setProductSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, p, c] = await Promise.all([
        api.get("/shops/me"),
        api.get("/products"),
        api.get("/product-categories"),
      ]);
      if (!s.data) { navigate("/onboarding"); return; }
      setShop(s.data);
      setProducts(p.data || []);
      setCategories(c.data || []);
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

  // LAPAKIN_PRODUCT_CATEGORY_MANAGER_A
  const activeCategories = categories.filter((category) => category?.is_active !== false);
  const assignableCategories = activeCategories.filter((category) => category?.category_id);

  const handleCreateCategory = async () => {
    const name = String(newCategoryName || "").trim();
    if (!name) {
      toast.error("Nama kategori wajib diisi");
      return;
    }

    setCategoryBusy(true);
    try {
      const { data } = await api.post("/product-categories", { name });
      setCategories((items) => {
        const exists = items.some((item) => item.category_id === data.category_id || item.slug === data.slug);
        if (exists) {
          return items.map((item) =>
            item.category_id === data.category_id || item.slug === data.slug ? data : item
          );
        }
        return [...items, data];
      });
      setNewCategoryName("");
      toast.success("Kategori ditambahkan");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal tambah kategori");
    } finally {
      setCategoryBusy(false);
    }
  };

  const handleRenameCategory = async (category) => {
    if (!category?.category_id) {
      toast.error("Kategori bawaan dari produk lama perlu dibuat ulang sebagai kategori baru");
      return;
    }

    const name = window.prompt("Nama kategori", category.name || "");
    if (name === null) return;

    const cleanName = String(name || "").trim();
    if (!cleanName) {
      toast.error("Nama kategori wajib diisi");
      return;
    }

    try {
      const { data } = await api.put(`/product-categories/${category.category_id}`, { name: cleanName });
      setCategories((items) => items.map((item) => item.category_id === data.category_id ? data : item));
      setProducts((items) =>
        items.map((product) =>
          product.category_id === data.category_id
            ? { ...product, category: data.name, category_name: data.name }
            : product
        )
      );
      toast.success("Kategori diperbarui");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal update kategori");
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!category?.category_id) {
      toast.error("Kategori bawaan dari produk lama belum bisa dinonaktifkan");
      return;
    }

    if (!window.confirm(`Nonaktifkan kategori "${category.name}"? Produk yang memakai kategori ini akan dilepas dari master kategori.`)) {
      return;
    }

    try {
      await api.delete(`/product-categories/${category.category_id}`);
      setCategories((items) => items.map((item) =>
        item.category_id === category.category_id ? { ...item, is_active: false } : item
      ));
      setProducts((items) => items.map((product) =>
        product.category_id === category.category_id ? { ...product, category_id: "" } : product
      ));
      if (categoryFilter === String(category.name || "").toLowerCase()) {
        setCategoryFilter("all");
      }
      toast.success("Kategori dinonaktifkan");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal nonaktifkan kategori");
    }
  };

  const handleAssignCategory = async (product, categoryId) => {
    const category = activeCategories.find((item) => item.category_id === categoryId);

    try {
      const { data } = await api.put(`/products/${product.product_id}/category`, {
        category_id: categoryId || "",
        category: category?.name || "",
        category_name: category?.name || "",
      });

      setProducts((arr) =>
        arr.map((p) => (p.product_id === product.product_id ? data : p))
      );
      toast.success(categoryId ? "Kategori produk diperbarui" : "Kategori produk dikosongkan");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal update kategori");
    }
  };

  const handleUpdateAvailability = async (product, availabilityStatus) => {
    try {
      const { data } = await api.put(`/products/${product.product_id}/availability`, {
        availability_status: availabilityStatus,
        is_active: availabilityStatus !== "hidden",
      });

      setProducts((arr) =>
        arr.map((p) => (p.product_id === product.product_id ? data : p))
      );

      toast.success("Status produk diperbarui");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal update status produk");
    }
  };

  const handleShareWA = async (p) => {
    const slug = shop?.slug || "";
    // /toko/<slug> works for both bots (via nginx rewrite) and humans.
    const shareUrl = `${window.location.origin}/toko/${slug}`;
    const caption = `${p.name} — ${rupiahShort(p.price)}\nPesan via ${shareUrl}`;
    const imgUrl = `${window.location.origin}/api/og/product/${p.product_id}/story.png`;
    const waText = encodeURIComponent(caption);
    const fallback = `https://api.whatsapp.com/send?text=${waText}`;
    toast.info("Menyiapkan kartu...");
    const res = await sharePhotoOrFallback({
      url: imgUrl,
      filename: `${p.name.replace(/[^a-zA-Z0-9]+/g, "_")}-lapakin.png`,
      caption,
      fallbackUrl: fallback,
    });
    if (res === "shared") toast.success("Dibagikan!");
    else if (res === "downloaded") toast.success("Gambar diunduh — buka WhatsApp & pilih dari galeri");
  };

  const handlePostIG = async (p) => {
    if (!window.confirm(`Post "${p.name}" ke Instagram sekarang?`)) return;

    setPublishingIG(p.product_id);
    try {
      const { data } = await api.post(`/instagram/products/${p.product_id}/publish`);
      toast.success("Produk berhasil diposting ke Instagram");
      if (data?.media_id) {
        console.log("Instagram media id:", data.media_id);
      }
    } catch (e) {
      const detail = formatApiError(e.response?.data?.detail) || "Gagal post ke Instagram";
      toast.error(detail);

      if (e.response?.status === 402) {
        navigate("/pricing#comparison");
      }
    } finally {
      setPublishingIG(null);
    }
  };

  const primaryImg = (p) => {
    const arr = Array.isArray(p.images) && p.images.length ? p.images : (p.image_data ? [p.image_data] : []);
    if (!arr.length) return null;
    const first = arr[0];
    return first?.startsWith("data:") ? first : `data:image/png;base64,${first}`;
  };
  const imgCount = (p) => (Array.isArray(p.images) ? p.images.length : (p.image_data ? 1 : 0));


  const handleMoveProductSortOrder = async (productId, direction) => {
    const currentIndex = products.findIndex((product) => product.product_id === productId);
    if (currentIndex < 0) return;

    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= products.length) return;

    const nextProducts = [...products];
    const [moved] = nextProducts.splice(currentIndex, 1);
    nextProducts.splice(nextIndex, 0, moved);

    const orderedProducts = nextProducts.map((product, index) => ({ ...product, sort_order: index }));
    setProducts(orderedProducts);

    try {
      await api.patch("/products/reorder", {
        ordered_product_ids: orderedProducts.map((product) => product.product_id),
      });
      toast.success("Urutan produk diperbarui");
    } catch (err) {
      console.error("Failed to reorder products", err);
      toast.error("Gagal menyimpan urutan produk");
      await load();
    }
  };

  const handleMoveCategorySortOrder = async (categoryId, direction) => {
    const currentIndex = activeCategories.findIndex((category) => category.category_id === categoryId);
    if (currentIndex < 0) return;

    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= activeCategories.length) return;

    const nextActiveCategories = [...activeCategories];
    const [moved] = nextActiveCategories.splice(currentIndex, 1);
    nextActiveCategories.splice(nextIndex, 0, moved);

    const orderById = new Map(
      nextActiveCategories
        .filter((category) => category?.category_id)
        .map((category, index) => [category.category_id, index])
    );

    setCategories((items) =>
      [...items]
        .map((category) =>
          orderById.has(category.category_id)
            ? { ...category, sort_order: orderById.get(category.category_id) }
            : category
        )
        .sort((a, b) => {
          const aOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 9999;
          const bOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 9999;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return String(a.name || "").localeCompare(String(b.name || ""));
        })
    );

    try {
      await api.patch("/product-categories/reorder", {
        ordered_category_ids: nextActiveCategories
          .filter((category) => category?.category_id)
          .map((category) => category.category_id),
      });
      toast.success("Urutan kategori diperbarui");
    } catch (err) {
      console.error("Failed to reorder categories", err);
      toast.error("Gagal menyimpan urutan kategori");
      await load();
    }
  };

  const categoryOptions = Array.from(
    new Set([
      ...activeCategories.map((category) => category.name).filter(Boolean),
      ...products.map(getProductCategoryName).filter(Boolean),
    ])
  ).sort((a, b) => a.localeCompare(b, "id"));

  const visibleProducts = products.filter((product) => {
    const categoryOk =
      categoryFilter === "all" ||
      getProductCategoryKey(product) === String(categoryFilter || "").toLowerCase();

    const availabilityOk =
      availabilityFilter === "all" ||
      getProductAvailabilityStatus(product) === availabilityFilter;

    return categoryOk && availabilityOk && productMatchesSearch(product, productSearch);
  });

  return (
    <DashboardLayout
      shop={shop}
      title="Produk"
      subtitle="Kelola katalog produk tokomu."
      actions={
        <div className="flex gap-2">
          {isPaid ? (
            <a href="/api/og/bulk-pack.zip" download
              className="hidden sm:inline-flex items-center gap-2 bg-brand-off border border-brand-line hover:bg-white rounded-xl px-4 h-12 font-semibold text-brand-ink"
              data-testid="bulk-pack-btn"
              title="Download ZIP semua kartu produk">
              <Package className="w-4 h-4" /> Bulk Card Pack
            </a>
          ) : (
            <button onClick={() => navigate("/pricing")}
              className="hidden sm:inline-flex items-center gap-2 bg-brand-off border border-dashed border-brand-line hover:bg-white rounded-xl px-4 h-12 font-semibold text-brand-mute opacity-70"
              data-testid="bulk-pack-locked"
              title="Fitur Bulk Card Pack khusus tier Pro & Bisnis">
              <Package className="w-4 h-4" /> Bulk Pack 🔒
            </button>
          )}
          <Button
            onClick={() => navigate("/dashboard/ai-studio")}
            className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
            data-testid="add-product-btn"
          >
            <Plus className="w-4 h-4 mr-2" /> Tambah dengan AI
          </Button>
        </div>
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
        <div className="space-y-4">
          <div
            className="bg-white border border-brand-line rounded-2xl p-4 shadow-card"
            data-testid="product-category-manager"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-brand-mute">Kategori Produk</p>
                <h3 className="font-heading font-bold text-lg text-brand-ink">Kelola kategori katalog</h3>
                <p className="text-sm text-brand-mute mt-1">
                  Buat kategori, lalu pilih kategori untuk tiap produk dari kartu produk.
                </p>
              </div>
              <span className="rounded-full bg-brand-off border border-brand-line px-3 py-1 text-xs font-bold text-brand-ink">
                {activeCategories.length} kategori aktif
              </span>
            </div>

            <div className="mt-4 grid sm:grid-cols-[1fr_auto] gap-2">
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCreateCategory();
                  }
                }}
                placeholder="Contoh: Makanan, Minuman, Paket Hemat"
                className="h-11 rounded-xl border border-brand-line px-3 text-sm"
                data-testid="product-category-name-input"
              />
              <Button
                type="button"
                onClick={handleCreateCategory}
                disabled={categoryBusy}
                className="h-11 rounded-xl bg-brand hover:bg-brand-hover text-white font-semibold"
                data-testid="product-category-add-btn"
              >
                Tambah kategori
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {activeCategories.length ? activeCategories.map((category, index) => (
                <span
                  key={category.category_id || category.slug || category.name}
                  className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-brand-off px-3 py-1.5 text-xs font-bold text-brand-ink"
                  data-testid="product-category-manager-chip"
                >
                  {category.name}

                  {category.category_id ? (
                    <span className="inline-flex gap-1" data-testid={`product-category-sort-controls-${category.category_id}`}>
                      <button
                        type="button"
                        onClick={() => handleMoveCategorySortOrder(category.category_id, -1)}
                        disabled={index === 0}
                        className="rounded-md border border-brand-line px-2 py-0.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                        title="Naikkan urutan kategori"
                      >
                        Naik
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveCategorySortOrder(category.category_id, 1)}
                        disabled={index === activeCategories.length - 1}
                        className="rounded-md border border-brand-line px-2 py-0.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                        title="Turunkan urutan kategori"
                      >
                        Turun
                      </button>
                    </span>
                  ) : null}

                  {category.is_virtual ? (
                    <span className="text-[10px] text-brand-mute">dari produk</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleRenameCategory(category)}
                        className="text-brand hover:underline"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(category)}
                        className="text-red-600 hover:underline"
                      >
                        Nonaktifkan
                      </button>
                    </>
                  )}
                </span>
              )) : (
                <span className="text-sm text-brand-mute">Belum ada kategori. Tambahkan kategori pertama.</span>
              )}
            </div>
          </div>

          <div
            className="bg-white border border-brand-line rounded-2xl p-4 shadow-card"
            data-testid="product-category-filter-panel"
          >
            <div className="grid md:grid-cols-[1fr_auto] gap-3">
              <label className="relative block">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Cari produk, deskripsi, atau kategori..."
                  className="w-full h-11 rounded-xl border border-brand-line pl-10 pr-3 text-sm"
                  data-testid="product-search-input"
                />
              </label>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-11 rounded-xl border border-brand-line px-3 text-sm font-semibold"
                data-testid="product-category-filter"
              >
                <option value="all">Semua kategori</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category.toLowerCase()}>{category}</option>
                ))}
              </select>

              <select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value)}
                className="h-11 rounded-xl border border-brand-line px-3 text-sm font-semibold"
                data-testid="product-availability-filter"
              >
                <option value="all">Semua status</option>
                {PRODUCT_AVAILABILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap mt-3 text-xs text-brand-mute">
              <span>
                Menampilkan {visibleProducts.length} dari {products.length} produk
              </span>
              {categoryOptions.length ? (
                <span>{categoryOptions.length} kategori</span>
              ) : (
                <span>Belum ada kategori produk</span>
              )}
            </div>
          </div>

          {visibleProducts.length === 0 ? (
            <div className="bg-white border border-brand-line rounded-2xl p-10 text-center shadow-card">
              <Package className="w-9 h-9 mx-auto text-brand-mute" />
              <h3 className="font-heading font-bold text-lg mt-3">Produk tidak ditemukan</h3>
              <p className="text-brand-mute mt-1">Coba ubah pencarian atau filter kategori.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {visibleProducts.map((p, index) => {
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
                  <div className="mt-3 grid gap-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span
                        className="inline-flex w-fit items-center gap-1 rounded-full bg-brand-off border border-brand-line px-2.5 py-1 text-[11px] font-bold text-brand-ink"
                        data-testid={`product-category-badge-${p.product_id}`}
                      >
                        <Tag className="w-3 h-3" />
                        {getProductCategoryName(p) || "Tanpa kategori"}
                      </span>

                      <span
                        className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-[11px] font-bold ${getProductAvailabilityMeta(p).badge}`}
                        data-testid={`product-availability-badge-${p.product_id}`}
                      >
                        {getProductAvailabilityMeta(p).label}
                      </span>

                      <div className="flex flex-wrap gap-2 pt-1" data-testid={`product-sort-controls-${p.product_id}`}>
                        <button
                          type="button"
                          onClick={() => handleMoveProductSortOrder(p.product_id, -1)}
                          disabled={index === 0}
                          className="rounded-lg border border-brand-line px-2.5 py-1 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
                          title="Naikkan urutan produk"
                        >
                          Naik
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveProductSortOrder(p.product_id, 1)}
                          disabled={index === visibleProducts.length - 1}
                          className="rounded-lg border border-brand-line px-2.5 py-1 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
                          title="Turunkan urutan produk"
                        >
                          Turun
                        </button>
                      </div>

                    </div>

                    <label className="text-[11px] font-bold text-brand-mute">
                      Kategori
                      <select
                        value={p.category_id || ""}
                        onChange={(event) => handleAssignCategory(p, event.target.value)}
                        className="mt-1 w-full h-9 rounded-xl border border-brand-line px-2 text-xs font-semibold text-brand-ink bg-white"
                        data-testid={`product-category-select-${p.product_id}`}
                      >
                        <option value="">Tanpa kategori</option>
                        {assignableCategories.map((category) => (
                          <option key={category.category_id || category.slug || category.name} value={category.category_id || ""}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-[11px] font-bold text-brand-mute">
                      Status Produk
                      <select
                        value={getProductAvailabilityStatus(p)}
                        onChange={(event) => handleUpdateAvailability(p, event.target.value)}
                        className="mt-1 w-full h-9 rounded-xl border border-brand-line px-2 text-xs font-semibold text-brand-ink bg-white"
                        data-testid={`product-availability-select-${p.product_id}`}
                      >
                        {PRODUCT_AVAILABILITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {/* TOKO CARDS (IG Post + Story + WA Status) */}
                  <div className="mt-3 flex gap-1.5">
                    <a href={`/api/og/product/${p.product_id}/post.png`} target="_blank" rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-2 py-2 bg-brand-off border border-brand-line hover:bg-white text-brand-ink"
                      data-testid={`download-post-${p.product_id}`}
                      title="Unduh kartu IG Post 1080×1080">
                      <ImageIcon className="w-3.5 h-3.5" /> IG Post
                    </a>
                    <a href={`/api/og/product/${p.product_id}/story.png`} target="_blank" rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-2 py-2 bg-brand-off border border-brand-line hover:bg-white text-brand-ink"
                      data-testid={`download-story-${p.product_id}`}
                      title="Unduh kartu IG Story 1080×1920">
                      <Smartphone className="w-3.5 h-3.5" /> Story
                    </a>
                    <button onClick={() => handleShareWA(p)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold rounded-lg px-2 py-2 bg-green-500 text-white hover:bg-green-600"
                      data-testid={`share-wa-${p.product_id}`}
                      title="Bagikan ke WhatsApp Status / kontak">
                      <Share2 className="w-3.5 h-3.5" /> WA
                    </button>
                    <button onClick={() => handlePostIG(p)}
                      disabled={publishingIG === p.product_id}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold rounded-lg px-2 py-2 bg-pink-500 text-white hover:bg-pink-600 disabled:opacity-60"
                      data-testid={`post-ig-${p.product_id}`}
                      title="Post langsung ke Instagram">
                      {publishingIG === p.product_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Instagram className="w-3.5 h-3.5" />
                      )}
                      IG
                    </button>
                  </div>

                  <div className="mt-2 flex justify-end gap-1">
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
        </div>
      )}

      <EditProductDialog
        product={editing}
        shop={shop}
        categories={activeCategories}
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
