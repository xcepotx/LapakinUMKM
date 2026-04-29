import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import BroadcastBanner from "@/components/BroadcastBanner";
import { Button } from "@/components/ui/button";
import { Wand2, Package, ExternalLink, Plus, Sparkles, Share2, Copy } from "lucide-react";
import { rupiah } from "@/lib/api";

export default function Dashboard() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, p] = await Promise.all([api.get("/shops/me"), api.get("/products")]);
        if (!s.data) { navigate("/onboarding"); return; }
        setShop(s.data);
        setProducts(p.data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="text-brand-mute" data-testid="dashboard-loading">Memuat dashboard…</div>
      </DashboardLayout>
    );
  }

  const storefrontUrl = `${window.location.origin}/toko/${shop?.slug}`;
  const ogImageUrl = `${window.location.origin}/api/og/shop/${shop?.slug}.png`;

  return (
    <DashboardLayout
      shop={shop}
      title={`Halo, ${shop?.name || "Bos"} 👋`}
      subtitle="Kelola produkmu dan biarkan AI mengerjakan bagian susahnya."
      actions={
        <Button
          onClick={() => navigate("/dashboard/ai-studio")}
          className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
          data-testid="dashboard-cta-ai-studio"
        >
          <Wand2 className="w-4 h-4 mr-2" /> Buka AI Studio
        </Button>
      }
    >
      <BroadcastBanner />
      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Produk" value={products.length} icon={<Package className="w-5 h-5" />} tid="stat-products" />
        <StatCard
          label="Stok Total"
          value={products.reduce((s, p) => s + (p.stock || 0), 0)}
          icon={<Sparkles className="w-5 h-5" />}
          tid="stat-stock"
        />
        <StatCard
          label="Estimasi Nilai Stok"
          value={rupiah(products.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0))}
          icon={<Sparkles className="w-5 h-5" />}
          tid="stat-value"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Quick actions */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-heading font-bold text-xl">Tokomu sudah online 🎉</h2>
                <p className="text-brand-mute mt-1 text-sm">Bagikan link berikut ke pelangganmu.</p>
                <div className="mt-3 inline-flex items-center gap-2 bg-brand-off rounded-xl px-3 py-2 border border-brand-line text-sm">
                  <span className="text-brand-mute truncate max-w-[260px]">{storefrontUrl}</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(storefrontUrl); }}
                    className="text-brand font-semibold text-xs hover:underline"
                    data-testid="copy-storefront-link"
                  >
                    Salin
                  </button>
                </div>
              </div>
              <Button
                variant="outline" className="rounded-xl border-brand-line"
                onClick={() => window.open(`/toko/${shop?.slug}`, "_blank")}
                data-testid="open-storefront-btn"
              >
                <ExternalLink className="w-4 h-4 mr-2" /> Buka Toko
              </Button>
            </div>
          </div>

          {/* SHARE PREVIEW — bagaimana link tampil di WhatsApp/IG/FB */}
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card" data-testid="share-preview-card">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="font-heading font-bold text-xl flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-brand" /> Pratinjau Saat Dibagikan
                </h2>
                <p className="text-brand-mute mt-1 text-sm">
                  Beginilah link tokomu akan muncul saat dikirim di WhatsApp, Instagram, atau Facebook.
                </p>
              </div>
            </div>
            {/* Mock chat bubble */}
            <div className="rounded-2xl bg-[#dcf8c6] p-3 max-w-md">
              <div className="bg-white rounded-xl overflow-hidden border border-black/5 shadow-sm">
                <div className="aspect-[1200/630] bg-brand-off">
                  <img src={ogImageUrl}
                    alt="Pratinjau share"
                    className="w-full h-full object-cover"
                    data-testid="share-preview-image"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
                <div className="p-3 border-t border-black/5">
                  <div className="text-[11px] uppercase text-gray-500 truncate">{window.location.host}</div>
                  <div className="font-semibold text-sm mt-0.5 line-clamp-1">{shop?.name} · Lapakin</div>
                  <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                    {shop?.tagline || shop?.description || "Toko online UMKM Indonesia di Lapakin."}
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-gray-500 mt-1 text-right">contoh tampilan</div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(storefrontUrl); }}
                className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-sm font-semibold"
                data-testid="copy-share-link">
                <Copy className="w-4 h-4" /> Salin Link Share
              </button>
              <a href={ogImageUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-sm font-semibold"
                data-testid="download-og-image">
                <ExternalLink className="w-4 h-4" /> Lihat Gambar OG
              </a>
            </div>
            <p className="text-[11px] text-brand-mute mt-3 leading-relaxed">
              Tip: Kalau cover toko diganti, pratinjau ini akan otomatis update. Untuk WhatsApp/Facebook,
              kadang preview di-cache 1-7 hari — bisa di-refresh manual via{" "}
              <a href="https://developers.facebook.com/tools/debug/" target="_blank" rel="noopener noreferrer"
                className="text-brand hover:underline">Sharing Debugger</a>.
            </p>
          </div>

          {/* Products preview */}
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading font-bold text-xl">Produk Terbaru</h2>
              <Link to="/dashboard/products" className="text-sm font-semibold text-brand hover:underline">Lihat semua</Link>
            </div>
            {products.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-brand-line rounded-xl bg-brand-off/40">
                <p className="text-brand-mute">Belum ada produk.</p>
                <Button
                  className="mt-4 bg-brand text-white rounded-xl btn-press"
                  onClick={() => navigate("/dashboard/ai-studio")}
                  data-testid="empty-add-product-btn"
                >
                  <Plus className="w-4 h-4 mr-1" /> Tambah dengan AI
                </Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {products.slice(0, 4).map((p) => (
                  <div key={p.product_id} className="flex gap-3 p-3 rounded-xl border border-brand-line bg-brand-off/40">
                    <div className="w-16 h-16 rounded-lg bg-white border border-brand-line overflow-hidden grid place-items-center">
                      {p.image_data ? (
                        <img src={p.image_data.startsWith("data:") ? p.image_data : `data:image/png;base64,${p.image_data}`}
                          alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-5 h-5 text-brand-mute" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-sm text-brand-mute">{rupiah(p.price)} · stok {p.stock}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className="bg-brand text-white rounded-2xl p-6 shadow-card relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-brand-accent/40 blur-2xl" />
            <Wand2 className="w-6 h-6" />
            <h3 className="font-heading font-bold text-xl mt-3">Tambah produk dengan AI</h3>
            <p className="text-white/85 text-sm mt-2">Foto seadanya pun jadi profesional. Caption IG &amp; TikTok jalan terus.</p>
            <Button
              onClick={() => navigate("/dashboard/ai-studio")}
              className="mt-5 bg-white text-brand hover:bg-brand-sand rounded-xl font-semibold btn-press w-full"
              data-testid="rail-ai-studio-btn"
            >
              Buka AI Studio
            </Button>
          </div>
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <h3 className="font-heading font-bold">Tips hari ini</h3>
            <p className="text-sm text-brand-mute mt-2">
              Foto dari atas (top-down) dengan latar polos biasanya menghasilkan hasil AI paling tajam.
            </p>
          </div>
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <h3 className="font-heading font-bold">WhatsApp Bot</h3>
            </div>
            <p className="text-sm text-brand-mute">
              Kelola produk lewat WhatsApp! Kirim foto + harga, AI tayang otomatis.
            </p>
            <Button onClick={() => navigate("/dashboard/whatsapp")}
              variant="outline"
              className="mt-3 w-full rounded-xl border-brand-line"
              data-testid="rail-whatsapp-btn">
              Hubungkan WhatsApp
            </Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatCard({ label, value, icon, tid }) {
  return (
    <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card flex items-center gap-4 card-hover" data-testid={tid}>
      <div className="w-12 h-12 rounded-xl bg-brand-off grid place-items-center text-brand">{icon}</div>
      <div>
        <div className="text-xs uppercase tracking-[0.15em] text-brand-mute font-bold">{label}</div>
        <div className="font-heading font-extrabold text-2xl mt-0.5">{value}</div>
      </div>
    </div>
  );
}
