import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import JSZip from "jszip";
import {
  Sparkles, Image as ImageIcon, Copy, Download, Loader2, Lock, Check,
  Wand2, ChevronLeft, ChevronRight, Package, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/DashboardLayout";
import { rupiah } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";


// LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_V1
const sleepContentStudio = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ContentStudio — Pro/Bisnis page to generate IG carousel + multi-platform captions
 * showcasing the merchant's products. Step-driven UI:
 *   1) Pick products (multi-select 1-8)
 *   2) Pick visual style
 *   3) Generate → preview slides + 3 captions
 *   4) Copy / download zip
 */
export default function ContentStudio() {
  const { user } = useAuth();
  const [tab, setTab] = useState("setup"); // setup | result
  const [quota, setQuota] = useState(null);
  const [styles, setStyles] = useState([]);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [selected, setSelected] = useState([]);
  // LAPAKIN_CONTENT_STUDIO_PRODUCT_FILTER_V3
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("all");
  const [style, setStyle] = useState("hangat");
  // LAPAKIN_CONTENT_STUDIO_PROMO_TOGGLE_V1
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoUseCode, setPromoUseCode] = useState(false);
  const [promoTitle, setPromoTitle] = useState("Promo Spesial");
  const [promoDescription, setPromoDescription] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoNote, setPromoNote] = useState("");
  // LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1
  const [enhancingPromo, setEnhancingPromo] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [activeSlide, setActiveSlide] = useState(0);
  // LAPAKIN_CONTENT_STUDIO_EXPORT_VIDEO_V1
  const [exportingVideo, setExportingVideo] = useState(false);
  const [videoDuration, setVideoDuration] = useState(3);
  const [videoTransition, setVideoTransition] = useState("fade");

  // LAPAKIN_CONTENT_STUDIO_PRODUCT_FILTER_V3
  const getProductCategory = (product) => {
    const raw =
      product?.category_name ||
      product?.category?.name ||
      product?.category ||
      product?.type ||
      "";

    if (raw && typeof raw === "object") {
      return raw?.name || raw?.label || raw?.title || "";
    }

    return String(raw || "").trim();
  };

  // LAPAKIN_CONTENT_STUDIO_PRODUCT_FILTER_V3
  const productCategories = useMemo(() => {
    const seen = new Set();

    products.forEach((product) => {
      const category = getProductCategory(product);
      if (category) seen.add(category);
    });

    return Array.from(seen).sort((a, b) => a.localeCompare(b, "id"));
  }, [products]);

  // LAPAKIN_CONTENT_STUDIO_PRODUCT_FILTER_V3
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();

    return products.filter((product) => {
      const category = getProductCategory(product);
      const matchCategory = productCategory === "all" || category === productCategory;

      const haystack = [
        product?.name,
        product?.description,
        product?.caption,
        product?.price,
        category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchSearch = !query || haystack.includes(query);

      return matchCategory && matchSearch;
    });
  }, [products, productSearch, productCategory]);

  // LAPAKIN_CONTENT_STUDIO_PRODUCT_FILTER_V3
  const resetProductFilter = () => {
    setProductSearch("");
    setProductCategory("all");
  };


  const canUse = quota && quota.limit !== 0;
  const tier = user?.tier || "free";

  useEffect(() => {
    api.get("/content-studio/styles")
      .then((r) => setStyles(r.data.styles || []))
      .catch(() => {});
    api.get("/content-studio/quota")
      .then((r) => setQuota(r.data))
      .catch((e) => {
        // 402 = upgrade needed; surface tier=free state
        if (e.response?.status === 402) {
          setQuota({ used: 0, limit: 0, remaining: 0, tier: "free" });
        }
      });
    api.get("/products?limit=200")
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : (r.data.items || []);
        setProducts(rows);
      })
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, []);

  const toggleProduct = (pid) => {
    setSelected((prev) => {
      if (prev.includes(pid)) return prev.filter((x) => x !== pid);
      if (prev.length >= 8) {
        toast.error("Maks 8 produk per carousel");
        return prev;
      }
      return [...prev, pid];
    });
  };

  // LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_V1

  // LAPAKIN_CONTENT_STUDIO_PROMO_TOGGLE_V1
  const buildPromoPayload = () => ({
    enabled: promoEnabled,
    title: promoTitle.trim() || "Promo Spesial",
    description: promoDescription.trim(),
    use_code: promoUseCode,
    code: promoUseCode ? promoCode.trim().toUpperCase() : "",
    note: promoNote.trim(),
  });


  // LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1
  const getSelectedProductsForPromo = () =>
    products
      .filter((product) => selected.includes(product.product_id))
      .map((product) => ({
        product_id: product.product_id,
        name: product.name,
        price: product.price,
        category: product.category_name || product.category,
        description: product.description || product.caption,
      }));

  // LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1
  const enhancePromoWithAi = async () => {
    if (selected.length === 0) {
      toast.error("Pilih produk dulu sebelum AI Enhance promo");
      return;
    }

    setPromoEnabled(true);
    setEnhancingPromo(true);

    try {
      const response = await api.post("/content-studio/promo-suggest", {
        product_ids: selected,
        selected_products: getSelectedProductsForPromo(),
        style,
      });

      const promo = response.data || {};

      setPromoTitle(promo.title || "Promo Spesial");
      setPromoDescription(promo.description || "");
      setPromoUseCode(Boolean(promo.use_code));
      setPromoCode(promo.code || "");
      setPromoNote(promo.note || "");

      toast.success("Promo berhasil diisi AI");
    } catch (e) {
      toast.error(e.response?.data?.detail || "AI Enhance promo gagal. Coba lagi.");
    } finally {
      setEnhancingPromo(false);
    }
  };

  const generate = async () => {
    if (selected.length === 0) {
      toast.error("Pilih minimal 1 produk");
      return;
    }

    setGenerating(true);

    try {
      const start = await api.post("/content-studio/generate-job", {
        product_ids: selected,
        style,
        promo: buildPromoPayload(),
      });

      const jobId = start.data?.job_id;

      if (!jobId) {
        throw new Error("Job generate tidak terbentuk.");
      }

      toast.message("Konten sedang dibuat", {
        description: "Kamu bisa tunggu di halaman ini. Proses bisa lebih lama untuk banyak produk.",
      });

      let lastStatus = null;

      for (let attempt = 0; attempt < 240; attempt += 1) {
        await sleepContentStudio(attempt < 3 ? 1200 : 2500);

        const statusResponse = await api.get(`/content-studio/generate-job/${jobId}`);
        const status = statusResponse.data || {};
        lastStatus = status;

        if (status.status === "done") {
          const data = status.result || {};
          setResult(data);
          setQuota(data.quota);
          setActiveSlide(0);
          setTab("result");
          toast.success("Konten berhasil dibuat!");
          return;
        }

        if (status.status === "failed") {
          throw new Error(status.message || "Gagal generate konten.");
        }
      }

      throw new Error(lastStatus?.message || "Generate masih berjalan terlalu lama. Coba pilih produk lebih sedikit.");
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || "Gagal generate. Coba lagi.");
    } finally {
      setGenerating(false);
    }
  };

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`Caption ${label} disalin`);
  };

  const downloadSlide = (slide) => {
    const blob = b64ToBlob(slide.png_b64, slide.content_type);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = slide.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    result.slides.forEach((s) => {
      zip.file(s.filename, s.png_b64, { base64: true });
    });
    zip.file("captions.txt",
      `=== INSTAGRAM ===\n${result.captions.ig}\n\n` +
      `=== TIKTOK / REELS ===\n${result.captions.tiktok}\n\n` +
      `=== WHATSAPP BROADCAST ===\n${result.captions.whatsapp}\n`);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.shop_name?.replace(/\s+/g, "-").toLowerCase() || "konten"}-carousel.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("ZIP didownload — siap upload ke IG! 📦");
  };

  // LAPAKIN_CONTENT_STUDIO_EXPORT_VIDEO_V1
  const downloadVideoMp4 = async () => {
    if (!result?.slides?.length) {
      toast.error("Belum ada slide untuk dibuat video");
      return;
    }

    setExportingVideo(true);

    try {
      const response = await api.post("/content-studio/video", {
        slides: result.slides,
        duration_per_slide: Number(videoDuration) || 3,
        transition: videoTransition,
        filename: `${result.shop_name?.replace(/\s+/g, "-").toLowerCase() || "content-studio"}-video`,
      });

      const data = response.data || {};
      const binary = atob(data.video_b64 || "");
      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: data.content_type || "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = data.filename || "content-studio-video.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success("Video MP4 berhasil dibuat");
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(detail || "Gagal membuat video MP4. Coba lagi.");
    } finally {
      setExportingVideo(false);
    }
  };


  // ---------- Upsell for Free tier ----------
  if (quota && !canUse) {
    return (
      <DashboardLayout title="Konten" subtitle="Buat konten promosi dari produk toko.">
<div className="max-w-3xl mx-auto px-4 py-12">
          <div className="bg-white border border-brand-line rounded-3xl p-8 text-center shadow-card" data-testid="content-studio-upsell">
            <div className="w-16 h-16 rounded-2xl bg-brand/10 grid place-items-center mx-auto mb-4">
              <Lock className="w-7 h-7 text-brand" />
            </div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-brand mb-2">PRO &amp; BISNIS</div>
            <h1 className="font-heading font-extrabold text-3xl">Content Studio</h1>
            <p className="text-brand-mute mt-3 max-w-xl mx-auto">
              Bikin carousel Instagram menarik + caption IG / TikTok / WhatsApp dalam sekali klik —
              auto pakai foto produk &amp; data tokomu.
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mt-6 mb-6">
              {["Carousel siap upload IG", "Caption 3 platform", "Auto pakai produk tokomu"].map((f) => (
                <div key={f} className="bg-brand-off rounded-xl border border-brand-line p-3 text-xs font-semibold">
                  ✓ {f}
                </div>
              ))}
            </div>
            <Link to="/pricing">
              <Button className="bg-brand text-white hover:bg-brand-dark rounded-xl font-bold h-11 px-6"
                data-testid="content-studio-upgrade-cta">
                Upgrade paket untuk lanjut
              </Button>
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ---------- Result tab ----------
  if (tab === "result" && result) {
    const slide = result.slides[activeSlide];
    return (
      <DashboardLayout title="Konten" subtitle="Buat konten promosi dari produk toko.">
<div className="max-w-6xl mx-auto px-4 py-6">
          <button onClick={() => setTab("setup")}
            className="text-sm text-brand-mute hover:text-brand-ink font-semibold inline-flex items-center gap-1 mb-4"
            data-testid="content-studio-back-setup">
            <ArrowLeft className="w-4 h-4" /> Bikin lagi
          </button>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Slide preview */}
            <div className="bg-white border border-brand-line rounded-2xl p-4 shadow-card" data-testid="content-studio-preview">
              <div className="aspect-square rounded-xl overflow-hidden bg-brand-off mb-3">
                <img src={`data:image/png;base64,${slide.png_b64}`}
                  alt={slide.filename}
                  className="w-full h-full object-contain"
                  data-testid="content-studio-slide-img" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => setActiveSlide((i) => Math.max(0, i - 1))}
                  disabled={activeSlide === 0}
                  className="w-9 h-9 grid place-items-center rounded-lg bg-brand-off hover:bg-white border border-brand-line disabled:opacity-40"
                  data-testid="content-studio-prev">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-brand-mute font-semibold">
                  Slide {activeSlide + 1} / {result.slides.length}
                </span>
                <button onClick={() => setActiveSlide((i) => Math.min(result.slides.length - 1, i + 1))}
                  disabled={activeSlide === result.slides.length - 1}
                  className="w-9 h-9 grid place-items-center rounded-lg bg-brand-off hover:bg-white border border-brand-line disabled:opacity-40"
                  data-testid="content-studio-next">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-1.5 mt-3 overflow-x-auto pb-2">
                {result.slides.map((s, i) => (
                  <button key={i} onClick={() => setActiveSlide(i)}
                    className={`w-14 h-14 shrink-0 rounded-lg overflow-hidden border-2 ${
                      i === activeSlide ? "border-brand" : "border-transparent opacity-60 hover:opacity-100"
                    }`}
                    data-testid={`content-studio-thumb-${i}`}>
                    <img src={`data:image/png;base64,${s.png_b64}`} className="w-full h-full object-cover" alt="" />
                  </button>
                ))}
              </div>
              <Button onClick={downloadZip}
                className="w-full mt-3 bg-brand text-white hover:bg-brand-dark rounded-xl font-bold h-11"
                data-testid="content-studio-download-zip">
                <Download className="w-4 h-4 mr-2" /> Download Semua (ZIP)
              </Button>
              <Button onClick={() => downloadSlide(slide)}
                variant="outline"
                className="w-full mt-2 rounded-xl border-brand-line h-10 text-sm"
                data-testid="content-studio-download-slide">
                <Download className="w-4 h-4 mr-2" /> Download Slide Ini Saja
              </Button>

              {/* LAPAKIN_CONTENT_STUDIO_EXPORT_VIDEO_V1 */}
              <div className="mt-4 rounded-2xl border border-brand-line bg-brand-off/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-heading font-bold text-brand-ink">Export Video MP4</div>
                    <p className="mt-1 text-xs text-brand-mute">
                      Khusus Pro &amp; Bisnis. Cocok untuk Reels, TikTok, dan Shorts.
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-bold text-brand-mute">Durasi / slide</span>
                    <select
                      value={videoDuration}
                      onChange={(e) => setVideoDuration(Number(e.target.value))}
                      className="mt-1 h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                      data-testid="content-studio-video-duration"
                    >
                      <option value={2}>2 detik</option>
                      <option value={3}>3 detik</option>
                      <option value={4}>4 detik</option>
                      <option value={5}>5 detik</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[11px] font-bold text-brand-mute">Transisi</span>
                    <select
                      value={videoTransition}
                      onChange={(e) => setVideoTransition(e.target.value)}
                      className="mt-1 h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                      data-testid="content-studio-video-transition"
                    >
                      <option value="fade">Fade halus</option>
                      <option value="none">Cut biasa</option>
                    </select>
                  </label>
                </div>

                <Button
                  onClick={downloadVideoMp4}
                  disabled={exportingVideo || !result?.slides?.length}
                  className="mt-3 w-full bg-brand text-white hover:bg-brand-dark rounded-xl font-bold h-11"
                  data-testid="content-studio-export-video"
                >
                  {exportingVideo ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Membuat Video...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Buat Video MP4
                    </>
                  )}
                </Button>
              </div>

            </div>

            {/* Captions */}
            <div className="space-y-3">
              <CaptionCard label="Instagram" testid="caption-ig" emoji="📸"
                text={result.captions.ig} onCopy={() => copyText(result.captions.ig, "Instagram")} />
              <CaptionCard label="TikTok / Reels" testid="caption-tiktok" emoji="🎵"
                text={result.captions.tiktok} onCopy={() => copyText(result.captions.tiktok, "TikTok")} />
              <CaptionCard label="WhatsApp Broadcast" testid="caption-whatsapp" emoji="💬"
                text={result.captions.whatsapp} onCopy={() => copyText(result.captions.whatsapp, "WhatsApp")} />
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ---------- Setup tab ----------
  return (
    <DashboardLayout title="Konten" subtitle="Buat konten promosi dari produk toko.">
<div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-brand mb-1">CONTENT STUDIO</div>
            <h1 className="font-heading font-extrabold text-3xl">Bikin Konten Promosi</h1>
            <p className="text-brand-mute text-sm mt-1">
              Pilih produk, promo optional, dan gaya visual — kami bikin carousel siap upload + 3 caption.
            </p>
          </div>
          {quota && (
            <div className="bg-white border border-brand-line rounded-xl px-4 py-2.5 text-xs" data-testid="content-studio-quota">
              <div className="text-[10px] uppercase tracking-widest font-bold text-brand-mute">Kuota bulan ini</div>
              <div className="font-heading font-extrabold text-base mt-0.5">
                {quota.limit === -1 ? `${quota.used} dipakai · Unlimited` : `${quota.remaining} dari ${quota.limit} tersisa`}
              </div>
            </div>
          )}
        </div>

        {/* Step 1: Pilih produk */}
        <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card mb-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-heading font-bold text-lg flex items-center gap-2">
              <Package className="w-5 h-5 text-brand" /> 1. Pilih Produk
              <span className="text-xs text-brand-mute font-normal">(maks 8)</span>
            </h2>
            <span className="text-xs text-brand-mute" data-testid="content-studio-selected-count">
              {selected.length} dipilih
            </span>
          </div>

          {/* LAPAKIN_CONTENT_STUDIO_PRODUCT_FILTER_V3 */}
          <div className="mb-4 rounded-2xl border border-brand-line bg-brand-off/70 p-3">
            <div className="flex flex-col md:flex-row gap-3">
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Cari produk, harga, deskripsi, atau kategori..."
                className="h-11 flex-1 rounded-xl border border-brand-line bg-white px-4 text-sm font-semibold text-brand-ink placeholder:text-brand-mute/70 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                data-testid="content-studio-product-search"
              />

              <select
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value)}
                className="h-11 rounded-xl border border-brand-line bg-white px-4 text-sm font-bold text-brand-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 md:w-56"
                data-testid="content-studio-product-category-filter"
              >
                <option value="all">Semua kategori</option>
                {productCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={resetProductFilter}
                className="h-11 rounded-xl border border-brand-line bg-white px-4 text-sm font-bold text-brand-ink hover:border-brand/40"
                data-testid="content-studio-product-filter-reset"
              >
                Reset
              </button>
            </div>

            <div className="mt-2 text-xs text-brand-mute">
              Menampilkan <b className="text-brand-ink">{filteredProducts.length}</b> dari <b className="text-brand-ink">{products.length}</b> produk
              {productCategory !== "all" ? <> · kategori <b className="text-brand-ink">{productCategory}</b></> : null}
              {productSearch.trim() ? <> · pencarian <b className="text-brand-ink">“{productSearch.trim()}”</b></> : null}
            </div>
          </div>

          {loadingProducts ? (
            <div className="text-center py-6 text-brand-mute text-sm">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-6 text-sm text-brand-mute">
              Belum ada produk. <Link to="/dashboard/products" className="text-brand font-bold">Tambah produk dulu →</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredProducts.map((p) => {
                const isOn = selected.includes(p.product_id);
                const img = (p.images || [])[0];
                return (
                  <button key={p.product_id} type="button"
                    onClick={() => toggleProduct(p.product_id)}
                    className={`relative text-left rounded-xl border-2 overflow-hidden transition ${
                      isOn ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-brand-line bg-white hover:border-brand/40"
                    }`}
                    data-testid={`content-studio-product-${p.product_id}`}>
                    <div className="aspect-square bg-brand-off">
                      {img ? <img src={img} alt={p.name} className="w-full h-full object-cover" />
                        : <div className="w-full h-full grid place-items-center text-brand-mute">
                            <ImageIcon className="w-7 h-7" />
                          </div>}
                    </div>
                    {isOn && (
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-brand text-white grid place-items-center text-xs font-bold shadow-md">
                        {selected.indexOf(p.product_id) + 1}
                      </div>
                    )}
                    <div className="p-2.5">
                      <div className="text-xs font-bold line-clamp-1">{p.name}</div>
                      <div className="text-[11px] text-brand-mute">{rupiah(p.price)}</div>
                    </div>
                  </button>
                );
              })}

              {/* LAPAKIN_CONTENT_STUDIO_PRODUCT_FILTER_V3 */}
              {filteredProducts.length === 0 && products.length > 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-brand-line bg-white p-8 text-center">
                  <div className="font-heading font-bold text-brand-ink">Produk tidak ditemukan</div>
                  <p className="mt-1 text-sm text-brand-mute">
                    Coba ubah kata pencarian atau pilih kategori lain.
                  </p>
                  <button
                    type="button"
                    onClick={resetProductFilter}
                    className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-dark"
                  >
                    Reset filter
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* LAPAKIN_CONTENT_STUDIO_PROMO_TOGGLE_V1 */}
        <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-heading font-bold text-lg flex items-center gap-2">
                🎁 2. Promo / Penawaran
              </h2>
              <p className="text-sm text-brand-mute mt-1">
                Tambahkan slide promo optional sebelum closing. Bisa pakai kode promo atau tanpa kode.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setPromoEnabled((v) => !v)}
              className={`relative h-7 w-12 rounded-full transition ${promoEnabled ? "bg-brand" : "bg-brand-line"}`}
              data-testid="content-studio-promo-toggle"
              aria-pressed={promoEnabled}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${promoEnabled ? "left-6" : "left-1"}`}
              />
            </button>
          </div>

          {promoEnabled ? (
            <div className="mt-4 space-y-3">

              {/* LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1 */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-off/70 p-3">
                <div>
                  <div className="text-sm font-bold text-brand-ink">AI Enhance Promo</div>
                  <div className="text-xs text-brand-mute">
                    Isi otomatis judul, penawaran, kode promo, dan catatan dari produk yang dipilih.
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={enhancePromoWithAi}
                  disabled={enhancingPromo || selected.length === 0}
                  variant="outline"
                  className="rounded-xl border-brand-line font-bold"
                  data-testid="content-studio-promo-ai-enhance"
                >
                  {enhancingPromo ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Mengisi...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      AI Enhance
                    </>
                  )}
                </Button>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold text-brand-mute">Judul promo</span>
                  <input
                    value={promoTitle}
                    onChange={(e) => setPromoTitle(e.target.value)}
                    placeholder="Promo Spesial"
                    className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-4 text-sm font-semibold text-brand-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                    data-testid="content-studio-promo-title"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-bold text-brand-mute">Catatan kecil</span>
                  <input
                    value={promoNote}
                    onChange={(e) => setPromoNote(e.target.value)}
                    placeholder="Contoh: Berlaku sampai stok habis"
                    className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-4 text-sm font-semibold text-brand-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                    data-testid="content-studio-promo-note"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-bold text-brand-mute">Isi promo</span>
                <textarea
                  value={promoDescription}
                  onChange={(e) => setPromoDescription(e.target.value)}
                  placeholder="Contoh: Diskon 10% untuk semua menu pilihan hari ini"
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-brand-line bg-white px-4 py-3 text-sm font-semibold text-brand-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                  data-testid="content-studio-promo-description"
                />
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-brand-line bg-brand-off/70 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={promoUseCode}
                  onChange={(e) => setPromoUseCode(e.target.checked)}
                  className="h-4 w-4 accent-brand"
                  data-testid="content-studio-promo-use-code"
                />
                <div>
                  <div className="text-sm font-bold text-brand-ink">Pakai kode promo</div>
                  <div className="text-xs text-brand-mute">Matikan kalau promo cukup disebut tanpa kode.</div>
                </div>
              </label>

              {promoUseCode ? (
                <label className="block">
                  <span className="text-xs font-bold text-brand-mute">Kode promo</span>
                  <input
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="HEMAT10"
                    className="mt-1 h-11 w-full rounded-xl border border-brand-line bg-white px-4 text-sm font-extrabold tracking-wider text-brand-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                    data-testid="content-studio-promo-code"
                  />
                </label>
              ) : (
                <div className="rounded-xl bg-brand-off p-3 text-xs text-brand-mute">
                  Promo akan tampil sebagai <b className="text-brand-ink">tanpa kode promo</b>.
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-brand-off p-3 text-sm text-brand-mute">
              Promo dimatikan. Carousel tetap memakai format opening → produk → closing.
            </div>
          )}
        </div>


        {/* Step 2: Pilih style */}
        <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card mb-5">
          <h2 className="font-heading font-bold text-lg flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-brand" /> 3. Pilih Gaya Visual
          </h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {styles.map((s) => (
              <button key={s.key} type="button"
                onClick={() => setStyle(s.key)}
                className={`text-left rounded-xl border-2 p-3 transition ${
                  style === s.key ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-brand-line bg-white hover:border-brand/40"
                }`}
                data-testid={`content-studio-style-${s.key}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-heading font-bold">{s.label}</div>
                  {style === s.key && <Check className="w-4 h-4 text-brand" />}
                </div>
                <StylePreview styleKey={s.key} />
                <p className="text-[11px] text-brand-mute mt-2 leading-relaxed">{s.description}</p>
              </button>
            ))}
          </div>
        </div>


        {/* Generate button */}
        <div className="bg-white border-2 border-brand rounded-2xl p-5 shadow-cardHover flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-heading font-bold text-lg">Siap bikin?</h2>
            <p className="text-sm text-brand-mute">
              {selected.length} produk · {promoEnabled ? "pakai promo" : "tanpa promo"} · gaya <b className="text-brand-ink capitalize">{style}</b> · est. 10-15 detik
            </p>
          </div>
          <Button onClick={generate} disabled={generating || selected.length === 0}
            className="bg-brand text-white hover:bg-brand-dark rounded-xl h-12 px-6 font-bold text-base"
            data-testid="content-studio-generate">
            {generating
              ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Generating…</>
              : <><Wand2 className="w-5 h-5 mr-2" /> Generate Konten</>}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Header() {
  return (
    <div className="border-b border-brand-line bg-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
<div className="text-xs uppercase tracking-widest font-bold text-brand-mute">Content Studio</div>
      </div>
    </div>
  );
}

function CaptionCard({ label, emoji, text, onCopy, testid }) {
  return (
    <div className="bg-white border border-brand-line rounded-2xl p-4 shadow-card" data-testid={testid}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="font-heading font-bold flex items-center gap-2">
          <span className="text-xl">{emoji}</span> {label}
        </div>
        <Button onClick={onCopy} size="sm"
          className="bg-brand text-white hover:bg-brand-dark rounded-lg h-8 text-xs font-bold"
          data-testid={`${testid}-copy`}>
          <Copy className="w-3.5 h-3.5 mr-1" /> Salin
        </Button>
      </div>
      <textarea
        readOnly
        value={text}
        rows={6}
        className="w-full text-sm bg-brand-off border border-brand-line rounded-lg px-3 py-2 font-mono leading-relaxed resize-none focus:outline-none"
        data-testid={`${testid}-text`}
      />
    </div>
  );
}

function StylePreview({ styleKey }) {
  const styles = {
    minimal: { bg: "#FFFFFF", ink: "#18181B", accent: "#18181B" },
    hangat: { bg: "#FCF5EB", ink: "#3C1E14", accent: "#C04A3B" },
    bold: { bg: "#101012", ink: "#FFFFFF", accent: "#FFDC00" },
  };
  const s = styles[styleKey] || styles.minimal;
  return (
    <div className="aspect-square rounded-lg overflow-hidden border border-brand-line"
      style={{ backgroundColor: s.bg }}>
      <div className="h-full w-full flex flex-col p-3">
        <div className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase self-start"
          style={{ backgroundColor: s.accent, color: s.bg }}>
          KATALOG
        </div>
        <div className="mt-auto" style={{ color: s.ink }}>
          <div className="font-heading font-extrabold text-base leading-none">Toko</div>
          <div className="text-[9px] opacity-80 mt-0.5">contoh tagline</div>
        </div>
      </div>
    </div>
  );
}

function b64ToBlob(b64, contentType) {
  const byteCharacters = atob(b64);
  const byteArrays = [];
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: contentType });
}
