import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api, { rupiah } from "@/lib/api";
import {
  Sparkles, MessageCircle, Package, X, ChevronLeft, ChevronRight,
  Instagram, Music2, ShoppingBag, MapPin, Clock, Tag, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Storefront() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [storyIdx, setStoryIdx] = useState(null); // index into shop.story when viewing reel

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/shops/by-slug/${slug}`);
        setData(r.data);
      } catch (e) {
        setError(e.response?.status === 404 ? "Toko tidak ditemukan" : "Gagal memuat toko");
      } finally { setLoading(false); }
    })();
  }, [slug]);

  if (loading) return <div className="min-h-screen grid place-items-center text-brand-mute">Memuat toko…</div>;
  if (error) return (
    <div className="min-h-screen grid place-items-center bg-brand-sand text-center px-4">
      <div>
        <h1 className="font-heading font-extrabold text-3xl">{error}</h1>
        <p className="text-brand-mute mt-2">URL mungkin salah atau toko sudah dihapus.</p>
        <Link to="/" className="inline-block mt-6 text-brand font-semibold hover:underline">Kembali ke Lapakin</Link>
      </div>
    </div>
  );

  const { shop, products } = data || { shop: null, products: [] };
  const brand = shop?.brand_color || "#C04A3B";
  const waNumber = (shop?.whatsapp || "").replace(/[^0-9]/g, "").replace(/^0/, "62");
  const waLink = (text) =>
    waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}` : null;

  const productImages = (p) => {
    const imgs = Array.isArray(p.images) && p.images.length ? p.images : (p.image_data ? [p.image_data] : []);
    return imgs.map((i) => (i?.startsWith("data:") ? i : `data:image/png;base64,${i}`));
  };

  // Filler placeholders so grid never feels empty
  const fillerCount = Math.max(0, 4 - products.length);

  return (
    <div className="min-h-screen bg-brand-sand">
      {/* COVER BANNER */}
      <div className="relative" data-testid="storefront-cover">
        {shop?.cover_image ? (
          <div className="aspect-[16/6] sm:aspect-[16/5] w-full overflow-hidden bg-brand-off">
            <img src={shop.cover_image} alt="cover" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-brand-sand" />
          </div>
        ) : (
          <div className="aspect-[16/6] sm:aspect-[16/5] w-full relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${brand}, ${brand}dd)` }}>
            <div className="absolute inset-0 opacity-25"
              style={{ background: "radial-gradient(ellipse at top right, rgba(255,255,255,.4), transparent 60%)" }} />
          </div>
        )}
        {/* Header overlay */}
        <header className="max-w-5xl mx-auto px-4 sm:px-6 -mt-20 sm:-mt-24 relative">
          <div className="bg-white rounded-3xl shadow-cardHover border border-brand-line p-6 sm:p-8">
            <div className="flex items-start gap-5">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl grid place-items-center text-white shrink-0 shadow-lg"
                style={{ background: brand }}>
                <span className="font-heading font-extrabold text-2xl sm:text-3xl">
                  {(shop?.name || "L")[0].toUpperCase()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="font-heading font-extrabold text-3xl sm:text-4xl tracking-tight" data-testid="storefront-shop-name">
                  {shop?.name}
                </h1>
                {shop?.tagline && <p className="text-brand-mute mt-1">{shop.tagline}</p>}
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  <Chip icon={<Sparkles className="w-3 h-3" />} label="Verified UMKM" color={brand} />
                  {shop?.address && <Chip icon={<MapPin className="w-3 h-3" />} label={shop.address.split(",")[0]} />}
                  {shop?.hours && <Chip icon={<Clock className="w-3 h-3" />} label={shop.hours} />}
                </div>
              </div>
            </div>
          </div>
        </header>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {/* PROMO BANNER */}
        {shop?.promo_active && shop?.promo_title && (
          <div className="rounded-2xl p-5 mb-8 flex items-center gap-4 shadow-card border"
            style={{ background: `${brand}10`, borderColor: `${brand}40` }}
            data-testid="storefront-promo">
            <div className="w-12 h-12 rounded-xl grid place-items-center text-white shrink-0" style={{ background: brand }}>
              <Tag className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-heading font-bold text-lg" style={{ color: brand }}>{shop.promo_title}</div>
              {shop.promo_description && <p className="text-sm text-brand-ink/80 mt-0.5">{shop.promo_description}</p>}
            </div>
            {shop.promo_code && (
              <div className="shrink-0">
                <div className="text-[10px] uppercase tracking-wider font-bold text-brand-mute">Kode</div>
                <div className="font-mono font-bold text-base bg-white rounded-lg px-3 py-1 border-2 border-dashed" style={{ borderColor: brand }}>
                  {shop.promo_code}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SHOP STORY REEL */}
        {Array.isArray(shop?.story) && shop.story.length > 0 && (
          <section className="mb-10" data-testid="storefront-story-reel">
            <h2 className="text-xs uppercase tracking-[0.2em] font-bold text-brand-mute mb-3">Cerita Toko</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
              {shop.story.map((s, i) => (
                <button key={i} onClick={() => setStoryIdx(i)}
                  className="snap-start shrink-0 w-24 sm:w-28 group"
                  data-testid={`story-thumb-${i}`}>
                  <div className="aspect-[3/4] rounded-2xl overflow-hidden border-2 group-hover:scale-[1.02] transition-transform"
                    style={{ borderColor: brand }}>
                    <img src={s.image} alt="" className="w-full h-full object-cover" />
                  </div>
                  {s.caption && <div className="mt-1.5 text-[10px] text-brand-mute line-clamp-2 text-left">{s.caption}</div>}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* MAIN CONTENT GRID */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* PRODUCTS */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-heading font-bold text-xl">Produk</h2>
              <span className="text-sm text-brand-mute">{products.length} produk</span>
            </div>

            {products.length === 0 && fillerCount === 0 ? (
              <div className="bg-white border border-brand-line rounded-2xl p-12 text-center shadow-card">
                <Package className="w-10 h-10 mx-auto text-brand-mute" />
                <p className="text-brand-mute mt-3">Belum ada produk di toko ini.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {products.map((p) => {
                  const imgs = productImages(p);
                  return (
                    <article key={p.product_id}
                      className="bg-white rounded-2xl overflow-hidden border border-brand-line shadow-card card-hover hover:shadow-cardHover"
                      data-testid={`storefront-product-${p.product_id}`}>
                      <button onClick={() => imgs.length && setViewer({ product: p, idx: 0, imgs })}
                        className="block w-full aspect-square bg-brand-off relative">
                        {imgs.length ? (
                          <img src={imgs[0]} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-brand-mute"><Package className="w-7 h-7" /></div>
                        )}
                        {imgs.length > 1 && (
                          <span className="absolute top-2 right-2 bg-black/65 text-white text-[11px] font-bold rounded-full px-2 py-0.5">+{imgs.length - 1}</span>
                        )}
                      </button>
                      <div className="p-3">
                        <h3 className="font-semibold leading-snug line-clamp-2 text-sm">{p.name}</h3>
                        <div className="font-heading font-extrabold text-base mt-1" style={{ color: brand }}>{rupiah(p.price)}</div>
                        {waLink(`Halo ${shop.name}, saya mau pesan ${p.name}.`) ? (
                          <a href={waLink(`Halo ${shop.name}, saya mau pesan ${p.name}.`)} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" className="mt-2 w-full rounded-xl text-white font-semibold btn-press text-xs"
                              style={{ background: brand }}
                              data-testid={`buy-${p.product_id}`}>
                              <MessageCircle className="w-3.5 h-3.5 mr-1" /> Pesan
                            </Button>
                          </a>
                        ) : (
                          <div className="mt-2 text-[10px] text-brand-mute text-center py-1.5 border border-dashed border-brand-line rounded-lg">
                            Hubungi penjual
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
                {/* Filler "coming soon" */}
                {Array.from({ length: fillerCount }).map((_, i) => (
                  <div key={`f${i}`}
                    className="rounded-2xl border-2 border-dashed border-brand-line bg-white/50 aspect-[1/1.4] grid place-items-center text-brand-mute text-center px-3"
                    data-testid={`storefront-filler-${i}`}>
                    <div>
                      <Plus className="w-7 h-7 mx-auto opacity-50" />
                      <p className="text-xs mt-2">Produk baru<br />segera hadir</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SIDEBAR */}
          <aside className="space-y-5">
            {/* About */}
            {shop?.about && (
              <div className="bg-white rounded-2xl border border-brand-line p-5 shadow-card" data-testid="storefront-about">
                <h3 className="font-heading font-bold">Tentang Kami</h3>
                <p className="mt-3 text-sm text-brand-ink/85 leading-relaxed whitespace-pre-line">{shop.about}</p>
              </div>
            )}
            {/* Description fallback if no about */}
            {!shop?.about && shop?.description && (
              <div className="bg-white rounded-2xl border border-brand-line p-5 shadow-card">
                <p className="text-sm text-brand-ink/85 leading-relaxed">{shop.description}</p>
              </div>
            )}

            {/* Contact card */}
            <div className="bg-white rounded-2xl border border-brand-line p-5 shadow-card" data-testid="storefront-contact-card">
              <h3 className="font-heading font-bold">Hubungi Kami</h3>
              <div className="mt-3 space-y-3 text-sm">
                {shop?.address && (
                  <div className="flex gap-2 items-start">
                    <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-brand-mute" />
                    <span>{shop.address}</span>
                  </div>
                )}
                {shop?.hours && (
                  <div className="flex gap-2 items-start">
                    <Clock className="w-4 h-4 mt-0.5 shrink-0 text-brand-mute" />
                    <span>{shop.hours}</span>
                  </div>
                )}
                {!shop?.address && !shop?.hours && (
                  <p className="text-xs text-brand-mute">Hubungi penjual via WhatsApp untuk info lebih lanjut.</p>
                )}
              </div>
              {/* Social */}
              <div className="mt-4 pt-4 border-t border-brand-line flex flex-wrap gap-2">
                {shop?.instagram && (
                  <a href={`https://instagram.com/${shop.instagram}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 bg-brand-off border border-brand-line hover:bg-white"
                    data-testid="storefront-ig-link">
                    <Instagram className="w-3.5 h-3.5" /> @{shop.instagram}
                  </a>
                )}
                {shop?.tiktok && (
                  <a href={`https://tiktok.com/@${shop.tiktok}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 bg-brand-off border border-brand-line hover:bg-white"
                    data-testid="storefront-tiktok-link">
                    <Music2 className="w-3.5 h-3.5" /> @{shop.tiktok}
                  </a>
                )}
                {shop?.shopee && (
                  <a href={shop.shopee} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 bg-brand-off border border-brand-line hover:bg-white"
                    data-testid="storefront-shopee-link">
                    <ShoppingBag className="w-3.5 h-3.5" /> Shopee
                  </a>
                )}
              </div>
            </div>

            {/* Trust card */}
            <div className="rounded-2xl p-5 text-white shadow-card relative overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${brand}, ${brand}cc)` }}>
              <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
              <Sparkles className="w-5 h-5 relative" />
              <h3 className="font-heading font-bold mt-2 relative">Toko Lapakin</h3>
              <p className="text-sm text-white/85 mt-1 relative">
                Dikelola dengan AI Lapakin. Foto dan deskripsi produk dibuat khusus untuk pelanggan.
              </p>
            </div>
          </aside>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-brand-line py-8 text-center">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-brand-mute hover:text-brand-ink">
          <Sparkles className="w-4 h-4" /> Powered by <span className="font-heading font-bold text-brand-ink">Lapakin</span>
        </Link>
      </footer>

      {/* FLOATING WHATSAPP */}
      {waLink(`Halo ${shop.name}, saya mau tanya tentang produk.`) && (
        <a href={waLink(`Halo ${shop.name}, saya mau tanya tentang produk.`)} target="_blank" rel="noopener noreferrer"
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-green-500 text-white grid place-items-center shadow-cardHover hover:scale-110 transition-transform"
          data-testid="storefront-floating-wa"
          aria-label="WhatsApp">
          <MessageCircle className="w-6 h-6" />
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full">
            <span className="block w-full h-full bg-green-500 rounded-full animate-ping" />
          </span>
        </a>
      )}

      {/* PRODUCT IMAGE LIGHTBOX */}
      {viewer && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm grid place-items-center p-4" onClick={() => setViewer(null)}>
          <button className="absolute top-4 right-4 bg-white/10 text-white rounded-full p-2 hover:bg-white/20"
            onClick={() => setViewer(null)} aria-label="close">
            <X className="w-5 h-5" />
          </button>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="relative aspect-square bg-brand-off rounded-2xl overflow-hidden">
              <img src={viewer.imgs[viewer.idx]} alt="" className="w-full h-full object-contain" />
              {viewer.imgs.length > 1 && (
                <>
                  <button className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white rounded-full p-2"
                    onClick={() => setViewer((v) => ({ ...v, idx: (v.idx - 1 + v.imgs.length) % v.imgs.length }))}>
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white rounded-full p-2"
                    onClick={() => setViewer((v) => ({ ...v, idx: (v.idx + 1) % v.imgs.length }))}>
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
            <div className="text-white text-center mt-3 font-semibold">{viewer.product.name} <span className="text-white/60 text-sm">· {viewer.idx + 1}/{viewer.imgs.length}</span></div>
          </div>
        </div>
      )}

      {/* STORY VIEWER (IG-Story style) */}
      {storyIdx !== null && shop.story && shop.story[storyIdx] && (
        <div className="fixed inset-0 z-50 bg-black grid place-items-center p-4" onClick={() => setStoryIdx(null)}
          data-testid="storefront-story-viewer">
          <button className="absolute top-4 right-4 bg-white/10 text-white rounded-full p-2 hover:bg-white/20"
            onClick={() => setStoryIdx(null)} aria-label="close">
            <X className="w-5 h-5" />
          </button>
          <div className="max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            {/* Progress bars */}
            <div className="flex gap-1 mb-3">
              {shop.story.map((_, i) => (
                <div key={i} className={`h-0.5 flex-1 rounded-full ${i <= storyIdx ? "bg-white" : "bg-white/30"}`} />
              ))}
            </div>
            <div className="aspect-[3/4] rounded-2xl overflow-hidden bg-black relative">
              <img src={shop.story[storyIdx].image} alt="" className="w-full h-full object-cover" />
              {shop.story[storyIdx].caption && (
                <div className="absolute bottom-0 inset-x-0 p-5 bg-gradient-to-t from-black/85 to-transparent">
                  <p className="text-white font-medium leading-relaxed">{shop.story[storyIdx].caption}</p>
                </div>
              )}
              {storyIdx > 0 && (
                <button className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 rounded-full p-2 backdrop-blur"
                  onClick={() => setStoryIdx(storyIdx - 1)}>
                  <ChevronLeft className="w-4 h-4 text-white" />
                </button>
              )}
              {storyIdx < shop.story.length - 1 && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 rounded-full p-2 backdrop-blur"
                  onClick={() => setStoryIdx(storyIdx + 1)}>
                  <ChevronRight className="w-4 h-4 text-white" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ icon, label, color }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-brand-off border border-brand-line font-semibold"
      style={color ? { color } : {}}>
      {icon} {label}
    </span>
  );
}
