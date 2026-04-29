import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api, { rupiah } from "@/lib/api";
import { Sparkles, MessageCircle, Package } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Storefront() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
  const waLink = (productName) => {
    const num = (shop?.whatsapp || "").replace(/[^0-9]/g, "").replace(/^0/, "62");
    if (!num) return null;
    const text = encodeURIComponent(`Halo ${shop.name}, saya tertarik dengan ${productName}. Apakah masih ada?`);
    return `https://wa.me/${num}?text=${text}`;
  };

  return (
    <div className="min-h-screen bg-brand-sand">
      {/* Header */}
      <header className="bg-white border-b border-brand-line">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <div className="flex items-start gap-5">
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl grid place-items-center text-white shrink-0"
              style={{ background: brand }}
            >
              <span className="font-heading font-extrabold text-2xl sm:text-3xl">
                {(shop?.name || "L")[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="font-heading font-extrabold text-3xl sm:text-4xl tracking-tight" data-testid="storefront-shop-name">
                {shop?.name}
              </h1>
              {shop?.tagline && <p className="text-brand-mute mt-1">{shop.tagline}</p>}
              {shop?.description && <p className="mt-3 max-w-xl text-brand-ink/80 leading-relaxed">{shop.description}</p>}
            </div>
          </div>
        </div>
      </header>

      {/* Products */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-heading font-bold text-xl">Produk</h2>
          <span className="text-sm text-brand-mute">{products.length} produk</span>
        </div>

        {products.length === 0 ? (
          <div className="bg-white border border-brand-line rounded-2xl p-12 text-center shadow-card">
            <Package className="w-10 h-10 mx-auto text-brand-mute" />
            <p className="text-brand-mute mt-3">Belum ada produk di toko ini.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
            {products.map((p) => (
              <article
                key={p.product_id}
                className="bg-white rounded-2xl overflow-hidden border border-brand-line shadow-card card-hover hover:shadow-cardHover"
                data-testid={`storefront-product-${p.product_id}`}
              >
                <div className="aspect-square bg-brand-off">
                  {p.image_data ? (
                    <img
                      src={p.image_data.startsWith("data:") ? p.image_data : `data:image/png;base64,${p.image_data}`}
                      alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-brand-mute"><Package className="w-7 h-7" /></div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold leading-snug line-clamp-2">{p.name}</h3>
                  <div className="font-heading font-extrabold text-lg mt-1" style={{ color: brand }}>{rupiah(p.price)}</div>
                  {p.description && <p className="text-xs text-brand-mute mt-2 line-clamp-3">{p.description}</p>}
                  {waLink(p.name) ? (
                    <a href={waLink(p.name)} target="_blank" rel="noopener noreferrer">
                      <Button
                        className="mt-3 w-full rounded-xl text-white font-semibold btn-press"
                        style={{ background: brand }}
                        data-testid={`buy-${p.product_id}`}
                      >
                        <MessageCircle className="w-4 h-4 mr-2" /> Pesan WhatsApp
                      </Button>
                    </a>
                  ) : (
                    <div className="mt-3 text-xs text-brand-mute text-center py-2 border border-dashed border-brand-line rounded-xl">
                      Hubungi penjual
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-brand-line py-8 text-center">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-brand-mute hover:text-brand-ink">
          <Sparkles className="w-4 h-4" /> Powered by <span className="font-heading font-bold text-brand-ink">Lapakin</span>
        </Link>
      </footer>
    </div>
  );
}
