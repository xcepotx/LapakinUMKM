/* LAPAKIN_MALL_PHASE1G_PUBLIC_POLISH_V1 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { rupiah } from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  MessageCircle,
  Search,
  Share2,
  ShoppingBag,
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

function ProductImage({ item, large = false }) {
  const image = item?.image;

  if (image) {
    return (
      <img
        src={image}
        alt={item?.name || "Produk Lapakin Mall"}
        className="h-full w-full object-cover"
        loading={large ? "eager" : "lazy"}
      />
    );
  }

  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-brand-off via-white to-brand-soft/50 text-brand">
      <ShoppingBag className={large ? "h-20 w-20" : "h-10 w-10"} />
    </div>
  );
}

function RelatedCard({ item }) {
  const detailUrl = item?.links?.detail || `/mall/p/${item?.listing_id || item?.product_id || ""}`;

  return (
    <Link
      to={detailUrl}
      onClick={() => trackMallEvent("mall_product_click", item)}
      className="group overflow-hidden rounded-2xl border border-brand-line bg-white shadow-sm transition hover:-translate-y-1 hover:border-brand/40 hover:shadow-card"
    >
      <div className="aspect-square overflow-hidden bg-brand-off">
        <ProductImage item={item} />
      </div>

      <div className="p-3">
        <div className="text-[11px] font-black uppercase tracking-wide text-brand-mute">
          {item.category || "Produk"}
        </div>
        <div className="mt-1 line-clamp-2 font-heading text-sm font-black leading-snug text-brand-ink">
          {item.name}
        </div>
        <div className="mt-1 text-sm font-black text-brand">{formatPrice(item.price)}</div>
        <div className="mt-2 truncate text-xs font-semibold text-brand-mute">
          {item?.shop?.name || "Toko Lapakin"}
        </div>
      </div>
    </Link>
  );
}

export default function MallProductDetail() {
  const { listingId } = useParams();
  const [item, setItem] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);

  const shareUrl = useMemo(() => {
    if (!item) return "";
    return item?.links?.share_og || `${window.location.origin}/api/og/mall/${item.listing_id || item.product_id}`;
  }, [item]);

  const detailUrl = useMemo(() => {
    if (!item) return "";
    return item?.links?.public_detail || window.location.href;
  }, [item]);

  const load = async () => {
    setLoading(true);

    try {
      const response = await api.get(`/mall/listings/${listingId}`);
      const payload = response.data || {};
      const nextItem = payload.item || null;

      setItem(nextItem);
      setRelated(payload.related || []);

      if (nextItem) {
        trackMallEvent("mall_product_view", nextItem);
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Produk Mall tidak ditemukan");
      setItem(null);
      setRelated([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const handleOrder = () => {
    trackMallEvent("mall_order_click", item);

    if (item?.links?.order) {
      window.open(item.links.order, "_blank", "noopener,noreferrer");
    } else {
      toast.error("Nomor WhatsApp toko belum tersedia.");
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl || detailUrl);
      toast.success("Share link produk disalin");
    } catch {
      toast.error("Gagal menyalin share link");
    }
  };

  const nativeShare = async () => {
    const url = shareUrl || detailUrl;

    try {
      if (navigator.share) {
        await navigator.share({
          title: item?.name || "Produk Lapakin Mall",
          text: `${item?.name || "Produk"} dari ${item?.shop?.name || "Lapakin Mall"}`,
          url,
        });
        trackMallEvent("mall_product_click", item, { action: "native_share" });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Browser belum support native share, link sudah disalin");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        toast.error("Gagal share produk");
      }
    }
  };

  const copyDetailLink = async () => {
    try {
      await navigator.clipboard.writeText(detailUrl);
      toast.success("Link detail produk disalin");
    } catch {
      toast.error("Gagal menyalin link produk");
    }
  };

  return (
    <div className="min-h-screen bg-[#FBF7F1] text-brand-ink" data-testid="mall-product-detail-page">
      <header className="sticky top-0 z-40 border-b border-brand-line bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to={mallHomePath()} className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand text-white shadow-sm">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <div className="font-heading text-lg font-black leading-none">Lapakin Mall</div>
              <div className="text-xs font-bold text-brand-mute">Detail produk pilihan</div>
            </div>
          </Link>

          <Link
            to={mallHomePath()}
            className="inline-flex rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off"
          >
            <Search className="mr-2 h-4 w-4" />
            Cari Produk
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        <Link to={mallHomePath()} className="mb-5 inline-flex items-center text-sm font-black text-brand hover:text-brand-dark">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Kembali ke Mall
        </Link>

        {loading ? (
          <div className="rounded-[2rem] border border-brand-line bg-white p-12 text-center font-bold text-brand-mute shadow-card">
            Memuat produk Mall...
          </div>
        ) : !item ? (
          <div className="rounded-[2rem] border border-dashed border-brand-line bg-white p-12 text-center shadow-card">
            <div className="font-heading text-2xl font-black text-brand-ink">Produk tidak ditemukan</div>
            <p className="mt-2 text-sm text-brand-mute">Produk mungkin belum approved, hidden, atau sudah tidak tersedia.</p>
            <Link to={mallHomePath()} className="mt-5 inline-flex rounded-xl bg-brand px-5 py-3 text-sm font-black text-white hover:bg-brand-dark">
              Buka Lapakin Mall
            </Link>
          </div>
        ) : (
          <>
            <section className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="overflow-hidden rounded-[2rem] border border-brand-line bg-white p-3 shadow-card">
                <div className="aspect-square overflow-hidden rounded-[1.5rem] bg-brand-off">
                  <ProductImage item={item} large />
                </div>
              </div>

              <div className="rounded-[2rem] border border-brand-line bg-white p-6 shadow-card lg:p-8">
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-xs font-black uppercase tracking-wide text-white">
                    <Sparkles className="mr-1 h-3.5 w-3.5" />
                    Lapakin Mall
                  </span>

                  {item.featured ? (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-700">
                      Produk Unggulan
                    </span>
                  ) : null}

                  {item.badge ? (
                    <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-black uppercase tracking-wide text-brand-mute">
                      {item.badge}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 inline-flex items-center rounded-full border border-brand-line bg-brand-off px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-brand-mute">
                  <Tags className="mr-1.5 h-3.5 w-3.5" />
                  {item.category || "Produk UMKM"}
                </div>

                <h1 className="mt-3 font-heading text-3xl font-black leading-tight text-brand-ink sm:text-4xl">
                  {item.name}
                </h1>

                <div className="mt-4 text-3xl font-black text-brand">{formatPrice(item.price)}</div>

                {item.description ? (
                  <p className="mt-5 whitespace-pre-wrap text-base font-medium leading-relaxed text-brand-mute">
                    {item.description}
                  </p>
                ) : null}

                <div className="mt-6 rounded-3xl border border-brand-line bg-brand-off/60 p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="grid h-12 w-12 place-items-center rounded-2xl text-lg font-black text-white"
                      style={{ background: item?.shop?.brand_color || "#C04A3B" }}
                    >
                      {(item?.shop?.name || "T").slice(0, 1).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="font-heading text-lg font-black text-brand-ink">
                        {item?.shop?.name || "Toko Lapakin"}
                      </div>
                      <div className="text-sm font-semibold text-brand-mute">
                        {item?.shop?.city || item?.shop?.business_type || "UMKM Lapakin"}
                      </div>
                    </div>
                  </div>

                  {item?.shop?.tagline ? (
                    <p className="mt-3 text-sm font-medium leading-relaxed text-brand-mute">
                      {item.shop.tagline}
                    </p>
                  ) : null}
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleOrder}
                    className="inline-flex h-14 items-center justify-center rounded-2xl bg-brand px-5 text-sm font-black text-white hover:bg-brand-dark"
                    data-testid="mall-detail-order"
                  >
                    <MessageCircle className="mr-2 h-5 w-5" />
                    Pesan ke Toko
                  </button>

                  <button
                    type="button"
                    onClick={nativeShare}
                    className="inline-flex h-14 items-center justify-center rounded-2xl border border-brand-line bg-white px-5 text-sm font-black text-brand-ink hover:bg-brand-off"
                    data-testid="mall-detail-native-share"
                  >
                    <Share2 className="mr-2 h-5 w-5" />
                    Share Produk
                  </button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Link
                    to={item?.links?.storefront || `/toko/${item?.shop?.slug || ""}`}
                    onClick={() => trackMallEvent("mall_store_click", item)}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-brand-line bg-white px-5 text-sm font-black text-brand-ink hover:bg-brand-off"
                    data-testid="mall-detail-store"
                  >
                    <Store className="mr-2 h-4 w-4" />
                    Toko
                  </Link>

                  <button
                    type="button"
                    onClick={copyShareLink}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-brand-line bg-white px-5 text-sm font-black text-brand-ink hover:bg-brand-off"
                    data-testid="mall-detail-copy-share"
                  >
                    <Share2 className="mr-2 h-4 w-4" />
                    Copy OG
                  </button>

                  <button
                    type="button"
                    onClick={copyDetailLink}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-brand-line bg-white px-5 text-sm font-black text-brand-ink hover:bg-brand-off"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Link
                  </button>
                </div>

                <div className="mt-4 rounded-2xl bg-brand-off p-3 text-xs font-semibold leading-relaxed text-brand-mute">
                  Share Produk memakai native share jika tersedia. Copy OG dipakai untuk preview WhatsApp/FB yang lebih rapi.
                </div>
              </div>
            </section>

            {related.length > 0 ? (
              <section className="mt-12">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-brand">Produk lain</div>
                    <h2 className="font-heading text-2xl font-black text-brand-ink">Rekomendasi terkait</h2>
                  </div>

                  <Link to={mallHomePath()} className="hidden text-sm font-black text-brand hover:text-brand-dark sm:inline-flex">
                    Lihat semua
                    <ExternalLink className="ml-1.5 h-4 w-4" />
                  </Link>
                </div>

                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  {related.map((row) => (
                    <RelatedCard key={row.listing_id || row.product_id} item={row} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
