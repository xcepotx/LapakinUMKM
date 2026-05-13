/* LAPAKIN_MALL_PHASE1G_PUBLIC_POLISH_V1 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { rupiah } from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowRight,
  ExternalLink,
  Filter,
  MessageCircle,
  RotateCcw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tags,
} from "lucide-react";

function formatPrice(value) {
  try {
    return rupiah(Number(value || 0));
  } catch {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
  }
}

function isMallSubdomainHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host === "mall.lapakin.my.id" ||
    host === "mall-dev.lapakin.my.id" ||
    host === "mall.dev.lapakin.my.id" ||
    host.startsWith("mall.")
  );
}

function mallHomePath() {
  return isMallSubdomainHost() ? "/" : "/mall";
}

function mallDetailPath(item) {
  const id = item?.listing_id || item?.product_id || "";
  return isMallSubdomainHost() ? `/p/${id}` : item?.links?.detail || `/mall/p/${id}`;
}

function ProductImage({ item }) {
  const image = item?.image;

  if (image) {
    return (
      <img
        src={image}
        alt={item?.name || "Produk Lapakin Mall"}
        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        loading="lazy"
      />
    );
  }

  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-brand-off via-white to-brand-soft/50 text-brand">
      <ShoppingBag className="h-12 w-12" />
    </div>
  );
}

function trackMallEvent(event, item, extra = {}) {
  try {
    api
      .post("/mall/events", {
        event,
        listing_id: item?.listing_id || "",
        product_id: item?.product_id || "",
        shop_id: item?.shop_id || "",
        path: window.location.pathname,
        ...extra,
      })
      .catch(() => {});
  } catch {
    // no-op
  }
}

function sortMallItems(items, sortMode) {
  const rows = [...items];

  if (sortMode === "price_low") {
    return rows.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  }

  if (sortMode === "price_high") {
    return rows.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  }

  if (sortMode === "name_az") {
    return rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "id"));
  }

  if (sortMode === "newest") {
    return rows.sort((a, b) => String(b.listing_id || "").localeCompare(String(a.listing_id || "")));
  }

  return rows.sort((a, b) => {
    const featured = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    if (featured !== 0) return featured;
    return Number(a.rank || 100) - Number(b.rank || 100);
  });
}

function MallProductCard({ item }) {
  const orderUrl = item?.links?.order;
  const storefront = item?.links?.storefront || `/toko/${item?.shop?.slug || ""}`;
  const detailUrl = mallDetailPath(item);

  const handleOrder = () => {
    trackMallEvent("mall_order_click", item);
    if (orderUrl) {
      window.open(orderUrl, "_blank", "noopener,noreferrer");
    } else {
      toast.error("Nomor WhatsApp toko belum tersedia.");
    }
  };

  return (
    <article
      className="group overflow-hidden rounded-[1.75rem] border border-brand-line bg-white shadow-card transition hover:-translate-y-1 hover:border-brand/40 hover:shadow-cardHover"
      data-testid={`mall-product-${item.product_id}`}
    >
      <Link to={detailUrl} onClick={() => trackMallEvent("mall_product_click", item)} className="block">
        <div className="relative aspect-square overflow-hidden bg-brand-off">
          <ProductImage item={item} />

          <div className="absolute inset-x-0 top-0 flex flex-wrap gap-2 p-3">
            {item.featured ? (
              <span className="rounded-full bg-brand px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white shadow-sm">
                Unggulan
              </span>
            ) : null}

            {item.badge ? (
              <span className="rounded-full bg-white/95 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-brand-ink shadow-sm">
                {item.badge}
              </span>
            ) : null}
          </div>

          <div className="absolute bottom-3 left-3 right-3">
            <div className="inline-flex max-w-full items-center rounded-full bg-white/95 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-brand-mute shadow-sm">
              <Tags className="mr-1.5 h-3 w-3 shrink-0" />
              <span className="truncate">{item.category || "Produk UMKM"}</span>
            </div>
          </div>
        </div>

        <div className="p-4">
          <h2 className="line-clamp-2 font-heading text-lg font-black leading-snug text-brand-ink">
            {item.name}
          </h2>

          <div className="mt-2 text-xl font-black text-brand">{formatPrice(item.price)}</div>

          {item.description ? (
            <p className="mt-2 line-clamp-2 text-sm font-medium leading-relaxed text-brand-mute">
              {item.description}
            </p>
          ) : null}

          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-brand-off p-3">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black text-white"
              style={{ background: item?.shop?.brand_color || "#C04A3B" }}
            >
              {(item?.shop?.name || "T").slice(0, 1).toUpperCase()}
            </div>

            <div className="min-w-0">
              <div className="truncate text-sm font-black text-brand-ink">
                {item?.shop?.name || "Toko Lapakin"}
              </div>
              <div className="truncate text-xs font-semibold text-brand-mute">
                {item?.shop?.city || item?.shop?.business_type || "UMKM Lapakin"}
              </div>
            </div>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-2 border-t border-brand-line p-3">
        <button
          type="button"
          onClick={handleOrder}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-3 text-sm font-black text-white hover:bg-brand-dark"
          data-testid={`mall-order-${item.product_id}`}
        >
          <MessageCircle className="mr-2 h-4 w-4" />
          Pesan
        </button>

        <Link
          to={storefront}
          onClick={() => trackMallEvent("mall_store_click", item)}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-brand-line bg-white px-3 text-sm font-black text-brand-ink hover:bg-brand-off"
          data-testid={`mall-store-${item.product_id}`}
        >
          <Store className="mr-2 h-4 w-4" />
          Toko
        </Link>
      </div>
    </article>
  );
}

export default function Mall() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState({});
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [sortMode, setSortMode] = useState("featured");
  const [loading, setLoading] = useState(true);

  const sortedItems = useMemo(() => sortMallItems(items, sortMode), [items, sortMode]);
  const featured = useMemo(() => sortedItems.filter((item) => item.featured).slice(0, 6), [sortedItems]);
  const activeFilterCount = [q.trim() ? 1 : 0, category !== "all" ? 1 : 0].reduce((a, b) => a + b, 0);

  const load = async (next = {}) => {
    setLoading(true);

    const params = {
      q,
      category,
      limit: 100,
      ...next,
    };

    try {
      const response = await api.get("/mall/listings", { params });
      setItems(response.data?.items || []);
      setCategories(response.data?.categories || []);
      setSummary(response.data?.summary || {});

      trackMallEvent(params.q ? "mall_search" : "mall_view", null, {
        query: params.q || "",
        category: params.category || "all",
      });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal memuat Lapakin Mall");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load({ category });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const submitSearch = (event) => {
    event.preventDefault();
    load({ q, category });
  };

  const resetFilters = () => {
    setQ("");
    setCategory("all");
    setSortMode("featured");
    load({ q: "", category: "all" });
  };

  return (
    <div className="min-h-screen bg-[#FBF7F1] text-brand-ink" data-testid="lapakin-mall-page">
      <header className="sticky top-0 z-40 border-b border-brand-line bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to={mallHomePath()} className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand text-white shadow-sm">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <div className="font-heading text-lg font-black leading-none">Lapakin Mall</div>
              <div className="text-xs font-bold text-brand-mute">Etalase UMKM pilihan</div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off sm:inline-flex"
            >
              Masuk Tenant
            </Link>
            <Link
              to="/register"
              className="inline-flex rounded-xl bg-brand px-4 py-2 text-sm font-black text-white hover:bg-brand-dark"
            >
              Buka Toko
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-brand-line bg-gradient-to-br from-brand-off via-white to-[#F3D7C7]">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-amber-300/20 blur-3xl" />

          <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-16">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-brand shadow-sm">
                <Sparkles className="h-4 w-4" />
                Produk unggulan dari toko lokal
              </div>

              <h1 className="mt-5 max-w-3xl font-heading text-4xl font-black leading-tight text-brand-ink sm:text-5xl lg:text-6xl">
                Belanja langsung ke UMKM favorit dari satu etalase.
              </h1>

              <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-brand-mute sm:text-lg">
                Temukan produk pilihan tenant Lapakin. Tidak perlu login customer,
                tidak ada checkout ribet — klik produk, pesan langsung ke toko via WhatsApp.
              </p>

              <form onSubmit={submitSearch} className="mt-7 rounded-[1.5rem] border border-brand-line bg-white p-2 shadow-card">
                <div className="grid gap-2 md:grid-cols-[1fr_220px_auto]">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-mute" />
                    <input
                      value={q}
                      onChange={(event) => setQ(event.target.value)}
                      placeholder="Cari makanan, minuman, hampers, jasa..."
                      className="h-14 w-full rounded-2xl border border-transparent bg-brand-off/60 pl-12 pr-4 text-sm font-bold text-brand-ink outline-none focus:border-brand focus:bg-white"
                      data-testid="mall-search-input"
                    />
                  </div>

                  <select
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value)}
                    className="h-14 rounded-2xl border border-transparent bg-brand-off/60 px-4 text-sm font-bold text-brand-ink outline-none focus:border-brand focus:bg-white"
                    data-testid="mall-sort-select"
                  >
                    <option value="featured">Featured dulu</option>
                    <option value="newest">Terbaru</option>
                    <option value="price_low">Harga rendah</option>
                    <option value="price_high">Harga tinggi</option>
                    <option value="name_az">Nama A-Z</option>
                  </select>

                  <button
                    type="submit"
                    className="inline-flex h-14 items-center justify-center rounded-2xl bg-brand px-6 text-sm font-black text-white hover:bg-brand-dark"
                    data-testid="mall-search-submit"
                  >
                    Cari
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </div>
              </form>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-bold text-brand-mute">
                <span>{loading ? "Memuat produk..." : `${summary.total || sortedItems.length} produk tampil`}</span>
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-brand">
                    {activeFilterCount} filter aktif
                  </span>
                ) : null}
              </div>
            </div>

            <div className="hidden lg:block">
              <div className="rounded-[2rem] border border-brand-line bg-white p-4 shadow-cardHover">
                <div className="rounded-[1.5rem] bg-brand p-6 text-white">
                  <div className="text-sm font-black uppercase tracking-[0.18em] text-white/75">Cara order</div>
                  <div className="mt-8 space-y-4">
                    {[
                      ["1", "Pilih produk unggulan"],
                      ["2", "Klik Pesan ke Toko"],
                      ["3", "Lanjut chat WhatsApp langsung dengan UMKM"],
                    ].map(([step, text]) => (
                      <div key={step} className="flex items-center gap-3 rounded-2xl bg-white/10 p-4">
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-white font-black text-brand">{step}</div>
                        <div className="font-bold">{text}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 rounded-2xl bg-white/10 p-4 text-sm font-semibold leading-relaxed text-white/85">
                    Lapakin Mall bukan marketplace checkout lintas toko. Customer tetap pesan langsung ke pemilik toko.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
          <div className="rounded-[1.5rem] border border-brand-line bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-heading text-lg font-black text-brand-ink">
                <Filter className="h-5 w-5 text-brand" />
                Kategori
              </div>

              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-black text-brand-ink hover:bg-brand-off"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Reset
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setCategory("all")}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-black transition ${
                  category === "all"
                    ? "bg-brand text-white shadow-sm"
                    : "border border-brand-line bg-brand-off text-brand-ink hover:border-brand/40"
                }`}
                data-testid="mall-category-chip-all"
              >
                Semua
              </button>

              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-black transition ${
                    category === item
                      ? "bg-brand text-white shadow-sm"
                      : "border border-brand-line bg-brand-off text-brand-ink hover:border-brand/40"
                  }`}
                  data-testid={`mall-category-chip-${item}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </section>

        {featured.length > 0 ? (
          <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-brand">Featured</div>
                <h2 className="font-heading text-2xl font-black text-brand-ink">Produk unggulan minggu ini</h2>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((item) => (
                <MallProductCard key={item.listing_id || item.product_id} item={item} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-brand">Katalog Mall</div>
              <h2 className="font-heading text-2xl font-black text-brand-ink">Semua produk pilihan</h2>
            </div>

            <div className="inline-flex items-center rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-black text-brand-mute">
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Sort: {sortMode === "featured" ? "Featured" : sortMode === "newest" ? "Terbaru" : sortMode === "price_low" ? "Harga rendah" : sortMode === "price_high" ? "Harga tinggi" : "Nama A-Z"}
            </div>
          </div>

          {loading ? (
            <div className="rounded-[2rem] border border-brand-line bg-white p-12 text-center font-bold text-brand-mute shadow-card">
              Memuat Lapakin Mall...
            </div>
          ) : sortedItems.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-brand-line bg-white p-12 text-center shadow-card" data-testid="mall-empty-state">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-brand-off text-brand">
                <ShoppingBag className="h-8 w-8" />
              </div>
              <div className="mt-5 font-heading text-2xl font-black text-brand-ink">Produk belum ditemukan</div>
              <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-relaxed text-brand-mute">
                Coba keyword lain, pilih kategori berbeda, atau reset filter untuk melihat semua produk pilihan UMKM.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-5 inline-flex rounded-xl bg-brand px-5 py-3 text-sm font-black text-white hover:bg-brand-dark"
              >
                Reset Filter
              </button>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedItems.map((item) => (
                <MallProductCard key={item.listing_id || item.product_id} item={item} />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-brand-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm font-semibold text-brand-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>© Lapakin Mall — Etalase UMKM pilihan.</div>
          <div className="flex gap-4">
            <Link to="/" className="hover:text-brand">Lapakin</Link>
            <Link to="/register" className="hover:text-brand">Daftar Toko</Link>
            <a href="https://lapakin.my.id" target="_blank" rel="noreferrer" className="inline-flex items-center hover:text-brand">
              Website <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
