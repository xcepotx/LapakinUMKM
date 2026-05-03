import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import BroadcastBanner from "@/components/BroadcastBanner";
import { Button } from "@/components/ui/button";
import { Wand2, Package, ExternalLink, Plus, Sparkles, Share2, Copy, Power, PowerOff, Coffee, X, Calendar } from "lucide-react";
import { rupiah } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import ShareHealthCard from "@/components/ShareHealthCard";
import DailyTipCard from "@/components/DailyTipCard";

function formatTrialDate(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
  }).format(new Date(value));
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
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
  // OG-aware share URL — works for WhatsApp/FB/Twitter crawlers immediately,
  // even before nginx is configured. Humans get auto-redirected to /toko/<slug>.
  const shareUrl = `${window.location.origin}/api/og/shop/${shop?.slug}`;

  const sellsByHours = (shop?.sells_by || "stock") === "hours";
  const isOpen = shop?.is_open !== false;
  const sellsByStock = (shop?.sells_by || "stock") === "stock";

  const toggleOpen = async () => {
    try {
      const { data } = await api.post("/shops/me/toggle-open");
      setShop((s) => ({ ...s, is_open: data.is_open }));
      toast.success(data.is_open ? "Toko dibuka 🟢" : "Toko ditutup 🔴");
    } catch (e) {
      toast.error("Gagal ubah status. Coba lagi.");
    }
  };

  const snoozeShop = async (minutes) => {
    try {
      const { data } = await api.post("/shops/me/snooze", { minutes });
      setShop((s) => ({ ...s, snooze_until: data.snooze_until }));
      if (minutes === 0) toast.success("Snooze dibatalkan");
      else toast.success(`Toko istirahat ${minutes} menit ☕`);
    } catch (e) {
      toast.error("Gagal set snooze. Coba lagi.");
    }
  };

  const snoozeUntil = shop?.snooze_until ? new Date(shop.snooze_until) : null;
  const isSnoozed = snoozeUntil && snoozeUntil > new Date();
  const snoozeMinsLeft = isSnoozed
    ? Math.max(1, Math.ceil((snoozeUntil - new Date()) / 60000))
    : 0;

  return (
    <DashboardLayout
      shop={shop}
      title={`Halo, ${shop?.name || "Bos"} 👋`}
      subtitle="Kelola produkmu dan biarkan AI mengerjakan bagian susahnya."
      actions={
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => navigate("/dashboard/content-studio")}
            variant="outline"
            className="border-brand-line bg-white hover:bg-brand-sand rounded-xl px-4 h-12 font-semibold btn-press"
            data-testid="dashboard-cta-content-studio"
          >
            <Sparkles className="w-4 h-4 mr-2" /> Content Studio
          </Button>
          <Button
            onClick={() => navigate("/dashboard/ai-studio")}
            className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
            data-testid="dashboard-cta-ai-studio"
          >
            <Wand2 className="w-4 h-4 mr-2" /> Buka AI Studio
          </Button>
        </div>
      }
    >
    {user?.trial_expired && !user?.trial && (
      <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50 p-5 text-orange-950 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-orange-800">
              Trial Pro Berakhir
            </div>
            <div className="mt-1 text-lg font-extrabold">
              Trial Pro kamu sudah selesai.
            </div>
            <p className="mt-1 text-sm text-orange-800">
              Beberapa fitur Pro seperti Analitik, custom subdomain, dan fitur premium lainnya akan terkunci kembali.
            </p>
          </div>

          <a
            href="/dashboard/billing"
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-orange-900 px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            Lihat Paket
          </a>
        </div>
      </div>
    )}

    {user?.trial && user?.trial_expires_at && (
      <div className="mb-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-yellow-950 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-yellow-800">
              Trial Pro Aktif 🎉
            </div>
            <div className="mt-1 text-lg font-extrabold">
              Nikmati fitur Pro sampai {formatTrialDate(user.trial_expires_at)}
            </div>
            <p className="mt-1 text-sm text-yellow-800">
              Selama trial, kamu bisa mencoba analitik, custom subdomain, fitur AI, dan fitur Pro lainnya.
            </p>
          </div>

          <a
            href="/dashboard/billing"
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-yellow-900 px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            Kelola Paket
          </a>
        </div>
      </div>
    )}
      <BroadcastBanner />

      {/* TRIAL PRO BANNER */}
      {user && user.trial && user.trial_expires_at && (() => {
        const expires = new Date(user.trial_expires_at);
        if (isNaN(expires.getTime())) return null;
        const daysLeft = Math.max(0, Math.ceil((expires - new Date()) / (1000 * 60 * 60 * 24)));
        if (daysLeft <= 0) return null;
        return (
          <div className="mb-6 rounded-2xl p-5 border-2 border-yellow-300 bg-gradient-to-r from-yellow-50 to-amber-50 flex items-center justify-between gap-4 flex-wrap shadow-card"
            data-testid="dashboard-trial-banner">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-yellow-400 text-yellow-900 grid place-items-center shrink-0 shadow-md">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <div className="text-xs font-bold tracking-[0.2em] uppercase text-yellow-700">Trial Pro Aktif</div>
                <div className="font-heading font-extrabold text-xl text-yellow-900">
                  Tinggal {daysLeft} hari lagi
                </div>
                <div className="text-xs text-yellow-900/70 mt-0.5">
                  Semua fitur Pro aktif gratis sampai {expires.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.
                </div>
              </div>
            </div>
            <Link to="/pricing">
              <Button className="bg-yellow-500 hover:bg-yellow-600 text-yellow-900 font-bold rounded-xl h-11 px-5"
                data-testid="trial-upgrade-cta">
                Upgrade Sekarang →
              </Button>
            </Link>
          </div>
        );
      })()}


      {/* SHOP OPEN/CLOSED TOGGLE — only when sells_by='hours' */}
      {sellsByHours && (
        <div
          className={`mb-6 rounded-2xl p-5 border-2 flex items-center justify-between gap-4 flex-wrap shadow-card ${
            isOpen
              ? "bg-green-50 border-green-300"
              : "bg-red-50 border-red-300"
          }`}
          data-testid="dashboard-open-banner">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-12 h-12 rounded-xl grid place-items-center ${isOpen ? "bg-green-600" : "bg-red-600"} text-white shrink-0 shadow-md`}>
              {isOpen ? <Power className="w-6 h-6" /> : <PowerOff className="w-6 h-6" />}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold tracking-[0.2em] uppercase opacity-70">Status Toko</div>
              <div className={`font-heading font-extrabold text-2xl ${isOpen ? "text-green-800" : "text-red-800"}`}>
                {isOpen ? "BUKA SEKARANG" : "TUTUP"}
              </div>
              <div className="text-xs text-brand-mute mt-0.5">
                {isOpen ? "Pelanggan bisa pesan langsung. Klik Tutup kalau habis bahan / jam tutup." : "Pelanggan lihat banner 'lagi tutup'. Cart disabled."}
              </div>
            </div>
          </div>
          <Button
            onClick={toggleOpen}
            className={`${isOpen ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"} text-white rounded-xl px-6 h-12 font-bold btn-press`}
            data-testid="dashboard-toggle-open">
            {isOpen ? <><PowerOff className="w-4 h-4 mr-2" /> Tutup Toko</> : <><Power className="w-4 h-4 mr-2" /> Buka Toko</>}
          </Button>
        </div>
      )}

      {/* SNOOZE BUKA — istirahat singkat 15/30/60 menit (F&B) */}
      {sellsByHours && isOpen && (
        <div className={`mb-6 rounded-2xl p-4 border-2 shadow-card flex items-center justify-between gap-4 flex-wrap ${
          isSnoozed ? "bg-amber-50 border-amber-300" : "bg-brand-off border-brand-line"
        }`}
          data-testid="dashboard-snooze-card">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
              isSnoozed ? "bg-amber-500 text-white" : "bg-white text-brand-mute border border-brand-line"
            }`}>
              <Coffee className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              {isSnoozed ? (
                <>
                  <div className="text-xs font-bold tracking-widest uppercase text-amber-700">Istirahat</div>
                  <div className="font-heading font-bold text-lg text-amber-900" data-testid="snooze-active-label">
                    Buka lagi {snoozeMinsLeft} menit lagi
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs font-bold tracking-widest uppercase text-brand-mute">Istirahat Singkat</div>
                  <div className="font-heading font-bold text-base">Tutup sebentar tanpa perlu toggle</div>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSnoozed ? (
              <Button
                onClick={() => snoozeShop(0)}
                variant="outline"
                size="sm"
                className="rounded-lg border-amber-400 text-amber-900 bg-white hover:bg-amber-50 font-semibold h-10 px-4"
                data-testid="snooze-cancel">
                <X className="w-4 h-4 mr-1.5" /> Batalkan
              </Button>
            ) : (
              [15, 30, 60].map((m) => (
                <Button key={m}
                  onClick={() => snoozeShop(m)}
                  size="sm"
                  variant="outline"
                  className="rounded-lg border-brand-line bg-white hover:bg-brand-sand font-semibold h-10 px-3.5 text-sm"
                  data-testid={`snooze-${m}`}>
                  {m} mnt
                </Button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Produk" value={products.length} icon={<Package className="w-5 h-5" />} tid="stat-products" />
        {sellsByStock ? (
          <>
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
          </>
        ) : sellsByHours ? (
          <>
            <StatCard
              label="Menu Hari Ini"
              value={products.filter((p) => !p.available_days?.length || p.available_days.includes((new Date().getDay() + 6) % 7)).length}
              icon={<Sparkles className="w-5 h-5" />}
              tid="stat-today"
            />
            <StatCard
              label="Status"
              value={isOpen ? "🟢 Buka" : "🔴 Tutup"}
              icon={<Power className="w-5 h-5" />}
              tid="stat-open"
            />
          </>
        ) : (
          <StatCard
            label="Mode"
            value="♾️ Selalu Ada"
            icon={<Sparkles className="w-5 h-5" />}
            tid="stat-mode"
          />
        )}
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

          {/* DAILY TIP — personalized AI/rule-based motivation */}
          <DailyTipCard />

          {/* SHARE HEALTH — live DNS + OG status, subdomain for Pro+ */}
          <ShareHealthCard shop={shop} />

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

            {/* Share-aware URL field */}
            <div className="mt-4 rounded-xl bg-brand-off border border-brand-line p-3">
              <div className="text-[11px] uppercase font-bold tracking-wider text-brand-mute">Link Toko (untuk dibagikan)</div>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-xs sm:text-sm font-mono bg-white border border-brand-line rounded-lg px-2 py-2 truncate" data-testid="share-url-text">
                  {storefrontUrl}
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(storefrontUrl); toast.success("Link disalin"); }}
                  className="inline-flex items-center gap-1.5 bg-brand text-white rounded-lg px-3 py-2 text-xs font-bold hover:bg-brand-dark"
                  data-testid="copy-share-link">
                  <Copy className="w-3.5 h-3.5" /> Salin
                </button>
              </div>
              <p className="text-[11px] text-brand-mute mt-2 leading-relaxed">
                ✨ Bagikan link ini ke WhatsApp/IG/FB — preview banner toko muncul otomatis (asal nginx config sudah di-setup di VPS).
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a href={ogImageUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-sm font-semibold"
                data-testid="download-og-image">
                <ExternalLink className="w-4 h-4" /> Lihat Gambar OG
              </a>
              <button
                onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Link alternatif disalin"); }}
                className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-sm font-semibold"
                data-testid="copy-storefront-direct"
                title="Untuk hosting yang BELUM punya nginx config — bypasses /toko prefix">
                <Copy className="w-4 h-4" /> Salin Link Alt (/api/og/shop/...)
              </button>
              <a href="https://developers.facebook.com/tools/debug/" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-sm font-semibold"
                data-testid="open-fb-debugger">
                <ExternalLink className="w-4 h-4" /> Refresh Cache FB/WA
              </a>
            </div>
            <p className="text-[11px] text-brand-mute mt-3 leading-relaxed">
              💡 Tips: Setelah ganti cover/tagline, klik <b>Refresh Cache FB/WA</b> → paste link toko → klik "Scrape Again" supaya WhatsApp ambil preview baru (cache mereka 1-7 hari).
            </p>
          </div>

          {/* Products preview */}
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-heading font-bold text-xl">Produk Terbaru</h2>
              <div className="flex items-center gap-3">
                <Link to="/dashboard/daily-menu"
                  className="text-sm font-semibold text-brand-mute hover:text-brand-ink inline-flex items-center gap-1"
                  data-testid="dashboard-daily-menu-link">
                  <Calendar className="w-3.5 h-3.5" /> Menu Per-Hari
                </Link>
                <Link to="/dashboard/products" className="text-sm font-semibold text-brand hover:underline">Lihat semua</Link>
              </div>
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
