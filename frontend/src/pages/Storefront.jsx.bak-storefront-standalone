import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api, { rupiah } from "@/lib/api";
import {
  Sparkles, MessageCircle, Package, X, ChevronLeft, ChevronRight,
  Instagram, Music2, ShoppingBag, MapPin, Clock, Tag, Plus, Minus,
  ShoppingCart, Trash2, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Storefront({ tenantSlug = null }) {
  // Slug resolution priority:
  // 1) URL param /toko/:slug (main-domain route)
  // 2) tenantSlug prop injected by AppRouter when visiting <slug>.lapakin.my.id
  const { slug: paramSlug } = useParams();
  const slug = paramSlug || tenantSlug;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [storyIdx, setStoryIdx] = useState(null); // index into shop.story when viewing reel
  const [todayOnly, setTodayOnly] = useState(true); // F&B "Menu Hari Ini" filter

  // ---- CART STATE (client-side, persisted in localStorage per shop slug) ----
  const cartKey = `lapakin_cart_${slug}`;
  // Lazy init reads localStorage synchronously BEFORE first render so the persist
  // effect never overwrites a saved cart with the initial `{}` value.
  const [cart, setCart] = useState(() => {
    try {
      const raw = localStorage.getItem(`lapakin_cart_${slug}`);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(null); // product_id flash

  // Persist cart on change
  useEffect(() => {
    try { localStorage.setItem(cartKey, JSON.stringify(cart)); } catch { /* ignore */ }
  }, [cart, cartKey]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/shops/by-slug/${slug}`);
        setData(r.data);
        // Fire-and-forget analytics: track shop view
        try { api.post("/analytics/track", { event: "view_shop", slug }); } catch (_) { /* ignore */ }
      } catch (e) {
        setError(e.response?.status === 404 ? "Toko tidak ditemukan" : "Gagal memuat toko");
      } finally { setLoading(false); }
    })();
  }, [slug]);

  // ---- Derived data (declared before early returns to satisfy hook rules) ----
  const products = data?.products || [];
  const productMap = useMemo(() => {
    const m = {};
    products.forEach((p) => { m[p.product_id] = p; });
    return m;
  }, [products]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([pid, qty]) => ({ product: productMap[pid], qty }))
      .filter((it) => it.product && it.qty > 0);
  }, [cart, productMap]);

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

  const { shop } = data;
  const brand = shop?.brand_color || "#C04A3B";
  const waNumber = (shop?.whatsapp || "").replace(/[^0-9]/g, "").replace(/^0/, "62");
  const waLink = (text) =>
    waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}` : null;

  // ---- SALES MODE (Iteration 7) ----
  const sellsBy = shop?.sells_by || "stock";
  const isOpen = shop?.is_open !== false;
  const shopClosed = sellsBy === "hours" && !isOpen;
  // Schedule status from backend (Iteration 8)
  const scheduleStatus = shop?.schedule_status || {};
  const autoSchedule = !!scheduleStatus.auto;
  const isSnoozed = !!scheduleStatus.snoozed;
  const notAcceptingOrders = scheduleStatus.accepting_orders === false;
  const lastOrderAt = scheduleStatus.last_order_at || null;
  // Today index (0=Mon..6=Sun) — JS Date.getDay() returns 0=Sun..6=Sat
  const todayIdx = (new Date().getDay() + 6) % 7;
  const DAY_LABELS_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const isAvailableToday = (p) => {
    if (sellsBy !== "hours") return true;
    if (!Array.isArray(p.available_days) || p.available_days.length === 0) return true;
    return p.available_days.includes(todayIdx);
  };
  const formatDays = (arr) =>
    [...arr].sort((a, b) => a - b).map((d) => DAY_LABELS_SHORT[d] || "").filter(Boolean).join(", ");

  // ---- CART HELPERS ----
  const cartCount = cartItems.reduce((s, it) => s + it.qty, 0);
  const cartTotal = cartItems.reduce((s, it) => s + it.qty * (it.product.price || 0), 0);

  const maxQty = (p) => {
    if (sellsBy === "stock") return p.stock && p.stock > 0 ? p.stock : 99;
    return 99; // hours/always: no per-product cap
  };

  const canAdd = (p) => {
    if (shopClosed) return false;
    if (notAcceptingOrders) return false; // past last-order cutoff OR snoozed
    if (sellsBy === "hours" && !isAvailableToday(p)) return false;
    if (sellsBy === "stock" && (p.stock !== undefined && p.stock !== null && p.stock <= 0)) return false;
    return true;
  };

  const addToCart = (p) => {
    const cur = cart[p.product_id] || 0;
    const next = Math.min(cur + 1, maxQty(p));
    if (next === cur) return; // out of stock
    setCart({ ...cart, [p.product_id]: next });
    setJustAdded(p.product_id);
    setTimeout(() => setJustAdded((v) => (v === p.product_id ? null : v)), 1200);
  };
  const setQty = (pid, qty) => {
    const p = productMap[pid];
    if (!p) return;
    const clamped = Math.max(0, Math.min(qty, maxQty(p)));
    const next = { ...cart };
    if (clamped <= 0) delete next[pid]; else next[pid] = clamped;
    setCart(next);
  };
  const removeFromCart = (pid) => {
    const next = { ...cart }; delete next[pid]; setCart(next);
  };
  const clearCart = () => setCart({});

  const buildCartMessage = () => {
    if (!cartItems.length) return "";
    const lines = [`Halo ${shop.name}, saya mau pesan:`, ""];
    cartItems.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.product.name} — ${it.qty}x ${rupiah(it.product.price)} = ${rupiah(it.qty * it.product.price)}`);
    });
    lines.push("─────────────");
    lines.push(`Total: ${rupiah(cartTotal)}`);
    lines.push("");
    if (shopClosed) {
      lines.push("(Toko sedang tutup — saya menanyakan ketersediaan.)");
    }
    lines.push("Mohon konfirmasi ketersediaan & ongkir ya. Terima kasih!");
    return lines.join("\n");
  };

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
                  {sellsBy === "hours" ? (
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-bold ${
                      isOpen ? "bg-green-100 text-green-700 border border-green-300" : "bg-red-100 text-red-700 border border-red-300"
                    }`} data-testid="storefront-status-badge">
                      <span className={`w-2 h-2 rounded-full ${isOpen ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
                      {isOpen ? "Buka Sekarang" : "Lagi Tutup"}
                    </span>
                  ) : sellsBy === "always" ? (
                    <Chip icon={<Sparkles className="w-3 h-3" />} label="Selalu Tersedia" color={brand} />
                  ) : (
                    <Chip icon={<Sparkles className="w-3 h-3" />} label="Verified UMKM" color={brand} />
                  )}
                  {shop?.address && <Chip icon={<MapPin className="w-3 h-3" />} label={shop.address.split(",")[0]} />}
                  {shop?.hours && <Chip icon={<Clock className="w-3 h-3" />} label={shop.hours} />}
                </div>
              </div>
            </div>
          </div>
        </header>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {/* SNOOZE BANNER — F&B istirahat singkat */}
        {isSnoozed && (
          <div className="rounded-2xl p-5 mb-6 flex items-center gap-4 bg-amber-50 border-2 border-amber-300 shadow-card"
            data-testid="storefront-snooze-banner">
            <div className="w-12 h-12 rounded-xl bg-amber-500 text-white grid place-items-center shrink-0 shadow-md text-2xl">
              ☕
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-heading font-extrabold text-lg text-amber-900">Lagi istirahat sebentar 🙏</div>
              <p className="text-sm text-amber-900/85 mt-0.5">
                Penjual lagi istirahat singkat. Boleh chat WhatsApp untuk info lebih lanjut ya.
              </p>
            </div>
          </div>
        )}

        {/* LAST-ORDER BANNER — F&B pre-order cutoff passed (masih buka, tapi stop order) */}
        {!shopClosed && !isSnoozed && notAcceptingOrders && lastOrderAt && (
          <div className="rounded-2xl p-5 mb-6 flex items-center gap-4 bg-yellow-50 border-2 border-yellow-300 shadow-card"
            data-testid="storefront-cutoff-banner">
            <div className="w-12 h-12 rounded-xl bg-yellow-500 text-white grid place-items-center shrink-0 shadow-md">
              <Clock className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-heading font-extrabold text-lg text-yellow-900">
                Pesanan hari ini sudah ditutup
              </div>
              <p className="text-sm text-yellow-900/85 mt-0.5">
                Last order tadi pukul <b>{lastOrderAt} WIB</b>. Dapur lagi siap-siap tutup. Sampai jumpa besok! 🍽️
              </p>
            </div>
          </div>
        )}

        {/* CLOSED BANNER (mode=hours & is_open=false) */}
        {shopClosed && (
          <div className="rounded-2xl p-5 mb-6 flex items-center gap-4 bg-red-50 border-2 border-red-300 shadow-card"
            data-testid="storefront-closed-banner">
            <div className="w-12 h-12 rounded-xl bg-red-600 text-white grid place-items-center shrink-0 shadow-md">
              <Clock className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-heading font-extrabold text-lg text-red-800">Maaf, lagi tutup 🙏</div>
              <p className="text-sm text-red-900/80 mt-0.5">
                {autoSchedule && scheduleStatus.opens_at
                  ? <>Buka lagi: <b>{scheduleStatus.opens_at} WIB</b>. Boleh kontak via WhatsApp untuk pre-order.</>
                  : <>Pesanan tidak bisa diproses sekarang. {shop?.hours ? `Jam buka: ${shop.hours}.` : "Cek lagi nanti ya!"} Boleh kontak via WhatsApp untuk pre-order.</>}
              </p>
            </div>
          </div>
        )}

        {/* AUTO-SCHEDULE OPEN HINT (when open + closing soon) */}
        {sellsBy === "hours" && isOpen && autoSchedule && scheduleStatus.closes_at && (
          <div className="rounded-2xl p-3 mb-6 flex items-center gap-2 bg-green-50 border border-green-300 text-sm flex-wrap"
            data-testid="storefront-closes-at">
            <Clock className="w-4 h-4 text-green-700" />
            <span className="text-green-800">
              Tutup hari ini jam <b>{scheduleStatus.closes_at} WIB</b>
            </span>
            {lastOrderAt && !notAcceptingOrders && (
              <span className="text-green-700 ml-2" data-testid="storefront-last-order-hint">
                · Last order <b>{lastOrderAt} WIB</b>
              </span>
            )}
          </div>
        )}

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
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h2 className="font-heading font-bold text-xl">
                  {sellsBy === "hours" && todayOnly ? "Menu Hari Ini" : "Produk"}
                </h2>
                {sellsBy === "hours" && (
                  <span className="text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5 bg-brand-off border border-brand-line text-brand-mute">
                    {DAY_LABELS_SHORT[todayIdx]}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {sellsBy === "hours" && products.some((p) => Array.isArray(p.available_days) && p.available_days.length > 0) && (
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none"
                    data-testid="storefront-today-filter">
                    <input type="checkbox" checked={todayOnly}
                      onChange={(e) => setTodayOnly(e.target.checked)}
                      className="w-4 h-4 accent-brand" />
                    Tampilkan menu hari ini saja
                  </label>
                )}
                <span className="text-sm text-brand-mute">{products.length} produk</span>
              </div>
            </div>

            {(() => {
              const visibleProducts = (sellsBy === "hours" && todayOnly)
                ? products.filter(isAvailableToday)
                : products;
              const visibleFiller = Math.max(0, 4 - visibleProducts.length);

              if (visibleProducts.length === 0 && visibleFiller === 0) {
                return (
                  <div className="bg-white border border-brand-line rounded-2xl p-12 text-center shadow-card">
                    <Package className="w-10 h-10 mx-auto text-brand-mute" />
                    <p className="text-brand-mute mt-3">Belum ada produk di toko ini.</p>
                  </div>
                );
              }
              if (visibleProducts.length === 0 && sellsBy === "hours" && todayOnly) {
                return (
                  <div className="bg-white border border-brand-line rounded-2xl p-12 text-center shadow-card"
                    data-testid="storefront-no-menu-today">
                    <Clock className="w-10 h-10 mx-auto text-brand-mute" />
                    <p className="text-brand-mute mt-3">Tidak ada menu di hari {DAY_LABELS_SHORT[todayIdx]}.</p>
                    <button onClick={() => setTodayOnly(false)}
                      className="mt-3 text-sm text-brand font-semibold hover:underline"
                      data-testid="storefront-show-all-days">
                      Lihat semua menu →
                    </button>
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {visibleProducts.map((p) => {
                    const imgs = productImages(p);
                    const inCart = cart[p.product_id] || 0;
                    const available = canAdd(p);
                    const hasDayLimit = sellsBy === "hours" && Array.isArray(p.available_days) && p.available_days.length > 0;
                    const notToday = sellsBy === "hours" && hasDayLimit && !p.available_days.includes(todayIdx);

                    return (
                      <article key={p.product_id}
                        className={`bg-white rounded-2xl overflow-hidden border border-brand-line shadow-card card-hover hover:shadow-cardHover ${notToday ? "opacity-70" : ""}`}
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
                          {hasDayLimit && (
                            <span className="absolute bottom-2 left-2 bg-white/95 text-[10px] font-bold rounded-full px-2 py-0.5 border border-brand-line"
                              data-testid={`day-badge-${p.product_id}`}>
                              📅 {formatDays(p.available_days)}
                            </span>
                          )}
                        </button>
                        <div className="p-3">
                          <h3 className="font-semibold leading-snug line-clamp-2 text-sm">{p.name}</h3>
                          <div className="font-heading font-extrabold text-base mt-1" style={{ color: brand }}>{rupiah(p.price)}</div>

                          {/* Cart action — adaptive per mode */}
                          {shopClosed ? (
                            <div className="mt-2 text-[10px] text-red-700 bg-red-50 border border-red-200 text-center py-1.5 rounded-lg font-semibold"
                              data-testid={`closed-${p.product_id}`}>
                              Toko sedang tutup
                            </div>
                          ) : notToday ? (
                            <div className="mt-2 text-[10px] text-brand-mute bg-brand-off border border-brand-line text-center py-1.5 rounded-lg"
                              data-testid={`not-today-${p.product_id}`}>
                              Tidak tersedia hari ini
                            </div>
                          ) : sellsBy === "stock" && p.stock !== undefined && p.stock !== null && p.stock <= 0 ? (
                            <div className="mt-2 text-[10px] text-brand-mute text-center py-1.5 border border-dashed border-brand-line rounded-lg"
                              data-testid={`out-of-stock-${p.product_id}`}>
                              Stok habis
                            </div>
                          ) : inCart > 0 ? (
                            <div className="mt-2 flex items-center justify-between rounded-xl border-2 px-1 py-1"
                              style={{ borderColor: brand }}
                              data-testid={`qty-stepper-${p.product_id}`}>
                              <button onClick={() => setQty(p.product_id, inCart - 1)}
                                className="w-7 h-7 grid place-items-center rounded-lg hover:bg-brand-off"
                                style={{ color: brand }}
                                data-testid={`qty-dec-${p.product_id}`}
                                aria-label="kurangi">
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="font-bold text-sm" style={{ color: brand }}>{inCart}</span>
                              <button onClick={() => addToCart(p)}
                                disabled={inCart >= maxQty(p)}
                                className="w-7 h-7 grid place-items-center rounded-lg hover:bg-brand-off disabled:opacity-30"
                                style={{ color: brand }}
                                data-testid={`qty-inc-${p.product_id}`}
                                aria-label="tambah">
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <Button size="sm"
                              onClick={() => addToCart(p)}
                              disabled={!available}
                              className="mt-2 w-full rounded-xl text-white font-semibold btn-press text-xs disabled:opacity-50"
                              style={{ background: brand }}
                              data-testid={`add-to-cart-${p.product_id}`}>
                              {justAdded === p.product_id ? (
                                <><Check className="w-3.5 h-3.5 mr-1" /> Ditambah</>
                              ) : (
                                <><Plus className="w-3.5 h-3.5 mr-1" /> Keranjang</>
                              )}
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  {/* Filler "coming soon" */}
                  {Array.from({ length: visibleFiller }).map((_, i) => (
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
              );
            })()}
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
        {!shop?.remove_branding && (
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-brand-mute hover:text-brand-ink"
            data-testid="powered-by-lapakin">
            <Sparkles className="w-4 h-4" /> Powered by <span className="font-heading font-bold text-brand-ink">Lapakin</span>
          </Link>
        )}
        {shop?.remove_branding && (
          <span className="text-xs text-brand-mute">© {shop?.name}</span>
        )}
      </footer>

      {/* FLOATING CART (right side, above WA) */}
      {cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-24 right-5 z-40 h-14 px-5 rounded-full text-white shadow-cardHover hover:scale-105 transition-transform flex items-center gap-2 font-semibold"
          style={{ background: brand }}
          data-testid="storefront-cart-fab"
          aria-label="Buka keranjang">
          <ShoppingCart className="w-5 h-5" />
          <span data-testid="cart-count">{cartCount}</span>
          <span className="hidden sm:inline text-sm font-bold">· {rupiah(cartTotal)}</span>
        </button>
      )}

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

      {/* CART DRAWER */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex" data-testid="cart-drawer">
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <aside className="w-full sm:w-[420px] bg-white h-full flex flex-col shadow-2xl animate-in slide-in-from-right">
            <header className="flex items-center justify-between p-5 border-b border-brand-line">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" style={{ color: brand }} />
                <h2 className="font-heading font-bold text-lg">Keranjang</h2>
                <span className="text-sm text-brand-mute">({cartCount} item)</span>
              </div>
              <button onClick={() => setCartOpen(false)}
                className="w-9 h-9 rounded-full hover:bg-brand-off grid place-items-center"
                data-testid="cart-close" aria-label="tutup">
                <X className="w-5 h-5" />
              </button>
            </header>

            {cartItems.length === 0 ? (
              <div className="flex-1 grid place-items-center text-center px-6">
                <div>
                  <ShoppingCart className="w-12 h-12 mx-auto text-brand-mute opacity-50" />
                  <p className="mt-3 font-semibold">Keranjang kosong</p>
                  <p className="text-sm text-brand-mute mt-1">Tambahkan produk yang kamu suka.</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {cartItems.map(({ product: p, qty }) => {
                  const imgs = productImages(p);
                  return (
                    <div key={p.product_id}
                      className="flex gap-3 p-3 rounded-2xl border border-brand-line bg-brand-off/40"
                      data-testid={`cart-item-${p.product_id}`}>
                      <div className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-white border border-brand-line">
                        {imgs[0] ? (
                          <img src={imgs[0]} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-brand-mute"><Package className="w-5 h-5" /></div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-semibold text-sm leading-snug line-clamp-2">{p.name}</h4>
                          <button onClick={() => removeFromCart(p.product_id)}
                            className="shrink-0 text-brand-mute hover:text-red-500 p-1"
                            data-testid={`cart-remove-${p.product_id}`}
                            aria-label="hapus">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="text-sm font-bold mt-0.5" style={{ color: brand }}>{rupiah(p.price)}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-1 rounded-lg border border-brand-line bg-white px-1 py-0.5">
                            <button onClick={() => setQty(p.product_id, qty - 1)}
                              className="w-6 h-6 grid place-items-center rounded hover:bg-brand-off"
                              data-testid={`cart-qty-dec-${p.product_id}`}
                              aria-label="kurangi">
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="font-bold text-sm w-6 text-center">{qty}</span>
                            <button onClick={() => setQty(p.product_id, qty + 1)}
                              disabled={qty >= maxQty(p)}
                              className="w-6 h-6 grid place-items-center rounded hover:bg-brand-off disabled:opacity-30"
                              data-testid={`cart-qty-inc-${p.product_id}`}
                              aria-label="tambah">
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <span className="text-sm font-semibold">{rupiah(qty * p.price)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button onClick={clearCart}
                  className="w-full text-xs text-brand-mute hover:text-red-500 py-2 mt-2"
                  data-testid="cart-clear">
                  Kosongkan keranjang
                </button>
              </div>
            )}

            {cartItems.length > 0 && (
              <footer className="p-5 border-t border-brand-line bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-brand-mute">Total</span>
                  <span className="font-heading font-extrabold text-2xl" style={{ color: brand }} data-testid="cart-total">
                    {rupiah(cartTotal)}
                  </span>
                </div>
                {shopClosed && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-800 flex items-start gap-2"
                    data-testid="cart-closed-warning">
                    <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Toko sedang <b>tutup</b>. Pesan tetap bisa dikirim ke WhatsApp untuk pre-order, tapi mohon tunggu konfirmasi.</span>
                  </div>
                )}
                {waLink(buildCartMessage()) ? (
                  <a href={waLink(buildCartMessage())} target="_blank" rel="noopener noreferrer"
                    onClick={() => {
                      setCartOpen(false);
                      try { api.post("/analytics/track", { event: "click_order", slug }); } catch (_) { /* ignore */ }
                    }}
                    className="block">
                    <Button className="w-full h-12 rounded-2xl text-white font-bold text-base shadow-card"
                      style={{ background: brand }}
                      data-testid="cart-checkout">
                      <MessageCircle className="w-5 h-5 mr-2" />
                      {shopClosed ? "Kirim Pre-Order via WhatsApp" : "Pesan Semua via WhatsApp"}
                    </Button>
                  </a>
                ) : (
                  <div className="text-xs text-center text-brand-mute py-2 border border-dashed border-brand-line rounded-xl">
                    Toko belum mengaktifkan WhatsApp. Hubungi penjual via kontak lain.
                  </div>
                )}
                <p className="text-[11px] text-brand-mute text-center">
                  Pesanan akan dikirim ke WhatsApp toko untuk konfirmasi & ongkir.
                </p>
              </footer>
            )}
          </aside>
        </div>
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
