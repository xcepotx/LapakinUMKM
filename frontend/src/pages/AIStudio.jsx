import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Wand2, ImageIcon, Copy, Check, Save, RefreshCw, X, Download, Instagram, Music2 } from "lucide-react";
import { toast } from "sonner";

const STYLES = [
  { id: "clean", label: "Studio Bersih" },
  { id: "lifestyle", label: "Lifestyle Hangat" },
  { id: "minimal", label: "Minimal Putih" },
];
const MAX_IMAGES = 5;

export default function AIStudio() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);

  // Multi-image state
  // origImages: array of data URLs (originals)
  // enhancedImages: parallel array — null where not enhanced yet, otherwise enhanced data URL
  const [origImages, setOrigImages] = useState([]);
  const [enhancedImages, setEnhancedImages] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [enhancing, setEnhancing] = useState(false);
  const [style, setStyle] = useState("clean");

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [availableDays, setAvailableDays] = useState([]);
  const [description, setDescription] = useState("");
  const [igCaption, setIgCaption] = useState("");
  const [tiktokCaption, setTiktokCaption] = useState("");
  const [hashtags, setHashtags] = useState([]);
  const [extraHints, setExtraHints] = useState("");

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  // LAPAKIN_AI_STUDIO_CATEGORY_E
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  useEffect(() => {
    (async () => {
      const [shopRes, categoriesRes] = await Promise.all([
        api.get("/shops/me"),
        api.get("/product-categories").catch(() => ({ data: [] })),
      ]);

      const { data } = shopRes;
      if (!data) { navigate("/onboarding"); return; }

      setShop(data);
      setCategories(Array.isArray(categoriesRes.data) ? categoriesRes.data : []);
    })();
  }, [navigate]);

  const onPickFile = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remain = MAX_IMAGES - origImages.length;
    if (remain <= 0) { toast.error(`Maksimal ${MAX_IMAGES} foto per produk`); return; }
    const take = files.slice(0, remain);
    Promise.all(take.map((f) => new Promise((res) => {
      if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name} > 8MB, dilewati`); res(null); return; }
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    }))).then((arr) => {
      const valid = arr.filter(Boolean);
      setOrigImages((prev) => {
        const next = [...prev, ...valid];
        setActiveIdx(prev.length);
        return next;
      });
      setEnhancedImages((prev) => [...prev, ...valid.map(() => null)]);
    });
    e.target.value = "";
  };

  const removeAt = (idx) => {
    setOrigImages((arr) => arr.filter((_, i) => i !== idx));
    setEnhancedImages((arr) => arr.filter((_, i) => i !== idx));
    setActiveIdx((i) => Math.max(0, Math.min(i, origImages.length - 2)));
  };

  const enhance = async () => {
    if (origImages.length === 0) { toast.error("Upload foto dulu"); return; }
    const idx = activeIdx;
    const src = origImages[idx];
    if (!src) return;
    setEnhancing(true);
    try {
      const raw = src.startsWith("data:") ? src.split(",", 2)[1] : src;
      const { data } = await api.post("/ai/enhance-image", { image_base64: raw, style });
      const url = `data:${data.mime_type || "image/png"};base64,${data.image_base64}`;
      setEnhancedImages((arr) => arr.map((v, i) => i === idx ? url : v));
      toast.success("Foto berhasil di-enhance!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal enhance gambar");
    } finally {
      setEnhancing(false);
    }
  };

  const generate = async () => {
    if (!name) { toast.error("Isi nama produk dulu"); return; }
    setGenerating(true);
    try {
      const { data } = await api.post("/ai/generate-content", {
        product_name: name,
        business_type: shop?.business_type || "",
        shop_name: shop?.name || "",
        extra_hints: extraHints,
      });
      setDescription(data.description || "");
      setIgCaption(data.ig_caption || "");
      setTiktokCaption(data.tiktok_caption || "");
      setHashtags(Array.isArray(data.hashtags) ? data.hashtags : []);
      toast.success("Konten berhasil dibuat AI!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal generate konten");
    } finally {
      setGenerating(false);
    }
  };

  const activeCategories = Array.isArray(categories)
    ? categories.filter((category) => category?.is_active !== false && category?.category_id)
    : [];

  // Final images: enhanced if exists, else original (in order)
  const finalImages = origImages.map((o, i) => enhancedImages[i] || o);

  const saveProduct = async () => {
    if (!name || !price) { toast.error("Nama & harga wajib diisi"); return; }
    if (finalImages.length === 0) { toast.error("Upload minimal 1 foto"); return; }
    setSaving(true);
    try {
      const selectedCategory = activeCategories.find(
        (category) => category.category_id === selectedCategoryId
      );

      await api.post("/products", {
        name, price: parseInt(price, 10) || 0, stock: parseInt(stock, 10) || 0,
        description, image_data: finalImages[0], images: finalImages,
        ig_caption: igCaption, tiktok_caption: tiktokCaption, hashtags,
        available_days: availableDays,
        category_id: selectedCategoryId || "",
        category: selectedCategory?.name || "",
        category_name: selectedCategory?.name || "",
      });
      toast.success("Produk berhasil disimpan!");
      navigate("/dashboard/products");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan");
    } finally {
      setSaving(false);
    }
  };

  // ===== Share Pack (Instagram / TikTok simple-mode) =====
  const downloadAll = async () => {
    if (finalImages.length === 0) { toast.error("Belum ada foto"); return; }
    finalImages.forEach((dataUrl, i) => {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${(name || "produk").replace(/\s+/g, "_").toLowerCase()}_${i + 1}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    });
    toast.success(`${finalImages.length} foto diunduh`);
  };

  const copyForIG = () => {
    if (!igCaption && hashtags.length === 0) { toast.error("Belum ada caption Instagram"); return; }
    const text = [igCaption, "", hashtags.join(" ")].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Caption + hashtag IG tersalin! Tinggal paste di Instagram.");
  };

  const copyForTikTok = () => {
    if (!tiktokCaption && hashtags.length === 0) { toast.error("Belum ada caption TikTok"); return; }
    const text = [tiktokCaption, hashtags.slice(0, 5).join(" ")].filter(Boolean).join(" ");
    navigator.clipboard.writeText(text);
    toast.success("Caption TikTok tersalin!");
  };

  const sharePack = async () => {
    await downloadAll();
    setTimeout(() => copyForIG(), 600);
    toast.message("Share Pack siap!", { description: "Foto diunduh, caption IG di clipboard. Buka aplikasi IG, paste caption, tempel foto." });
  };

  const showImage = enhancedImages[activeIdx] || origImages[activeIdx] || null;

  return (
    <DashboardLayout shop={shop} title="AI Studio" subtitle="Upload foto, enhance, biarkan AI bikin deskripsi & caption.">
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Image side */}
        <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-bold text-lg">1. Foto Produk</h2>
            <span className="text-xs text-brand-mute">JPG/PNG, max 8MB · sampai {MAX_IMAGES} foto</span>
          </div>

          {/* Big preview of active image */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <ImageBox label="Asli" src={origImages[activeIdx] || null}
              empty={
                <label className="cursor-pointer flex flex-col items-center justify-center text-brand-mute h-full">
                  <Upload className="w-7 h-7 mb-2" />
                  <span className="text-sm font-semibold">Upload foto</span>
                  <span className="text-xs">tap di sini</span>
                  <input type="file" multiple accept="image/*" className="hidden" onChange={onPickFile} data-testid="file-input" />
                </label>
              }
              tid="image-original"
            />
            <ImageBox label="AI Enhanced" src={enhancedImages[activeIdx] || null}
              empty={
                <div className="text-center text-brand-mute text-sm">
                  <ImageIcon className="w-7 h-7 mx-auto mb-2 opacity-60" />
                  Hasil AI tampil di sini
                </div>
              }
              tid="image-enhanced"
            />
          </div>

          {/* Thumbnails */}
          {origImages.length > 0 && (
            <div className="mt-4">
              <Label className="mb-2 block">Galeri ({origImages.length}/{MAX_IMAGES})</Label>
              <div className="flex gap-2 flex-wrap">
                {origImages.map((src, i) => (
                  <button key={i} type="button" onClick={() => setActiveIdx(i)}
                    className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 ${activeIdx === i ? "border-brand" : "border-brand-line"} group`}
                    data-testid={`thumb-${i}`}>
                    <img src={enhancedImages[i] || src} alt={`thumb-${i}`} className="w-full h-full object-cover" />
                    {i === 0 && <span className="absolute bottom-0 inset-x-0 bg-brand/85 text-white text-[9px] font-bold tracking-wider uppercase text-center">utama</span>}
                    {enhancedImages[i] && <span className="absolute top-0.5 right-0.5 bg-green-600 text-white text-[8px] font-bold rounded-full w-3 h-3 grid place-items-center">✓</span>}
                    <span onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                      className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-2.5 h-2.5" />
                    </span>
                  </button>
                ))}
                {origImages.length < MAX_IMAGES && (
                  <label className="w-16 h-16 rounded-lg border-2 border-dashed border-brand-line bg-brand-off/40 grid place-items-center cursor-pointer hover:border-brand text-brand-mute hover:text-brand">
                    <Upload className="w-4 h-4" />
                    <input type="file" multiple accept="image/*" className="hidden" onChange={onPickFile} />
                  </label>
                )}
              </div>
            </div>
          )}

          <div className="mt-5">
            <Label className="mb-2 block">Gaya Foto AI</Label>
            <div className="flex flex-wrap gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.id} onClick={() => setStyle(s.id)} type="button"
                  className={`text-sm font-semibold rounded-full px-4 py-2 border transition-colors ${
                    style === s.id ? "bg-brand text-white border-brand" : "bg-white text-brand-ink border-brand-line"
                  }`}
                  data-testid={`style-${s.id}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <Button
              onClick={enhance} disabled={origImages.length === 0 || enhancing}
              className="w-full bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
              data-testid="enhance-btn"
            >
              {enhancing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Sedang enhance…</> : <><Wand2 className="w-4 h-4 mr-2" /> Enhance foto aktif dengan AI</>}
            </Button>
            <p className="text-xs text-brand-mute mt-2 text-center">Tips: pilih thumbnail, lalu klik Enhance untuk foto itu saja.</p>
          </div>
        </div>

        {/* Form side */}
        <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
          <h2 className="font-heading font-bold text-lg">2. Detail Produk</h2>
          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="pname">Nama Produk</Label>
              <Input id="pname" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Misal: Alamat toko Gula Aren"
                className="mt-1 rounded-xl border-brand-line h-12" data-testid="product-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="price">Harga (Rp)</Label>
                <Input id="price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)}
                  placeholder="25000" className="mt-1 rounded-xl border-brand-line h-12" data-testid="product-price-input" />
              </div>
              {(shop?.sells_by || "stock") === "stock" ? (
                <div>
                  <Label htmlFor="stock">Stok</Label>
                  <Input id="stock" type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)}
                    placeholder="20" className="mt-1 rounded-xl border-brand-line h-12" data-testid="product-stock-input" />
                </div>
              ) : (shop?.sells_by === "hours") ? (
                <div>
                  <Label>Mode</Label>
                  <div className="mt-1 h-12 rounded-xl border border-brand-line bg-brand-off px-3 flex items-center text-sm text-brand-mute">🍜 Jam buka</div>
                </div>
              ) : (
                <div>
                  <Label>Mode</Label>
                  <div className="mt-1 h-12 rounded-xl border border-brand-line bg-brand-off px-3 flex items-center text-sm text-brand-mute">♾️ Selalu ada</div>
                </div>
              )}
            </div>

            {(shop?.sells_by === "hours") && (
              <div data-testid="ai-available-days-picker">
                <Label>Hari Tersedia (opsional)</Label>
                <p className="text-xs text-brand-mute mt-0.5 mb-2">
                  Kosongkan = tersedia setiap hari. Pilih hari kalau menu rotasi (mis. catering Senin–Jumat).
                </p>
                <div className="flex flex-wrap gap-2">
                  {["Sen","Sel","Rab","Kam","Jum","Sab","Min"].map((lbl, idx) => (
                    <button key={idx} type="button"
                      onClick={() => setAvailableDays((arr) => arr.includes(idx) ? arr.filter((x) => x !== idx) : [...arr, idx].sort((a,b)=>a-b))}
                      className={`text-sm font-semibold rounded-full px-4 py-2 border-2 transition ${
                        availableDays.includes(idx)
                          ? "bg-brand text-white border-brand"
                          : "bg-white text-brand-ink border-brand-line hover:border-brand"
                      }`}
                      data-testid={`ai-day-${idx}`}>
                      {lbl}
                    </button>
                  ))}
                  {availableDays.length > 0 && (
                    <button type="button" onClick={() => setAvailableDays([])}
                      className="text-xs text-brand-mute hover:text-red-500 underline self-center"
                      data-testid="ai-day-clear">
                      Setiap hari
                    </button>
                  )}
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="hints">Catatan untuk AI (opsional)</Label>
              <Input id="hints" value={extraHints} onChange={(e) => setExtraHints(e.target.value)}
                placeholder="Misal: pakai gula aren asli, tanpa sirup"
                className="mt-1 rounded-xl border-brand-line h-12" data-testid="ai-hints-input" />
            </div>

            <Button
              onClick={generate} disabled={generating || !name}
              variant="outline"
              className="w-full rounded-xl h-12 border-brand bg-brand-off text-brand hover:bg-brand hover:text-white btn-press font-semibold"
              data-testid="generate-content-btn"
            >
              {generating ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> AI sedang nulis…</> : <><Wand2 className="w-4 h-4 mr-2" /> Generate Deskripsi & Caption</>}
            </Button>
          </div>
        </div>
      </div>

      {/* Generated content */}
      <div className="mt-6 bg-white border border-brand-line rounded-2xl p-6 shadow-card">
        <h2 className="font-heading font-bold text-lg mb-4">3. Konten dari AI</h2>
        <div className="space-y-5">
          <CopyField label="Deskripsi (untuk halaman web)" value={description} setValue={setDescription} testid="desc-field" />
          <CopyField label="Caption Instagram" value={igCaption} setValue={setIgCaption} testid="ig-field" />
          <CopyField label="Caption TikTok" value={tiktokCaption} setValue={setTiktokCaption} testid="tiktok-field" />
          {hashtags?.length > 0 && (
            <div>
              <Label>Hashtag</Label>
              <div className="mt-2 flex flex-wrap gap-2 items-center">
                {hashtags.map((h) => (
                  <span key={h} className="text-xs font-semibold rounded-full px-3 py-1 bg-brand-off border border-brand-line">{h}</span>
                ))}
                <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(hashtags.join(" ")); toast.success("Hashtag disalin"); }}
                  data-testid="copy-hashtags-btn">
                  <Copy className="w-3 h-3 mr-1" /> Salin semua
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Share Pack — Instagram simple mode */}
        {(igCaption || tiktokCaption || finalImages.length > 0) && (
          <div className="mt-7 pt-6 border-t border-brand-line">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-heading font-bold text-base">Share Pack 📦</h3>
                <p className="text-sm text-brand-mute mt-0.5">Download foto + copy caption sekali klik, tinggal paste di IG/TikTok.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadAll}
                  className="rounded-xl border-brand-line" data-testid="share-download-btn">
                  <Download className="w-4 h-4 mr-2" /> Download {finalImages.length || 0} Foto
                </Button>
                <Button variant="outline" onClick={copyForIG}
                  className="rounded-xl border-brand-line" data-testid="share-ig-btn">
                  <Instagram className="w-4 h-4 mr-2" /> Salin Caption IG
                </Button>
                <Button variant="outline" onClick={copyForTikTok}
                  className="rounded-xl border-brand-line" data-testid="share-tiktok-btn">
                  <Music2 className="w-4 h-4 mr-2" /> Salin Caption TikTok
                </Button>
                <Button onClick={sharePack}
                  className="bg-brand hover:bg-brand-hover text-white rounded-xl font-semibold btn-press"
                  data-testid="share-pack-btn">
                  <Download className="w-4 h-4 mr-2" /> Share Pack (IG)
                </Button>
              </div>
            </div>
          </div>
        )}

        <div
          className="mt-6 rounded-2xl border border-brand-line bg-white p-4 shadow-card"
          data-testid="ai-studio-category-field"
        >
          <Label className="mb-2 block">Kategori Produk</Label>
          <select
            value={selectedCategoryId}
            onChange={(event) => setSelectedCategoryId(event.target.value)}
            className="w-full h-11 rounded-xl border border-brand-line px-3 text-sm font-semibold bg-white"
            data-testid="ai-studio-category-select"
          >
            <option value="">Tanpa kategori</option>
            {activeCategories.map((category) => (
              <option key={category.category_id} value={category.category_id}>
                {category.name}
              </option>
            ))}
          </select>
          {activeCategories.length === 0 ? (
            <p className="mt-2 text-xs text-brand-mute">
              Belum ada kategori. Buat kategori dulu dari halaman Produk.
            </p>
          ) : (
            <p className="mt-2 text-xs text-brand-mute">
              Kategori ini akan tersimpan bersama produk yang dibuat dari AI Studio.
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={saveProduct} disabled={saving}
            className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
            data-testid="save-product-btn">
            <Save className="w-4 h-4 mr-2" /> {saving ? "Menyimpan…" : "Simpan ke Toko"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function ImageBox({ label, src, empty, tid }) {
  return (
    <div data-testid={tid}>
      <div className="text-xs uppercase tracking-[0.15em] text-brand-mute font-bold mb-2">{label}</div>
      <div className="aspect-square rounded-xl border border-brand-line bg-brand-off overflow-hidden grid place-items-center">
        {src ? <img src={src} alt={label} className="w-full h-full object-cover" /> : empty}
      </div>
    </div>
  );
}

function CopyField({ label, value, setValue, testid }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value || "");
    setCopied(true);
    toast.success(`${label} disalin`);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between mb-1">
        <Label>{label}</Label>
        <Button variant="ghost" size="sm" onClick={copy} disabled={!value}>
          {copied ? <><Check className="w-3 h-3 mr-1" /> Tersalin</> : <><Copy className="w-3 h-3 mr-1" /> Salin</>}
        </Button>
      </div>
      <Textarea
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Klik 'Generate' untuk membuat dengan AI…"
        className="rounded-xl border-brand-line"
      />
    </div>
  );
}
