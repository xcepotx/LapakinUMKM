import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError, rupiah } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Wand2, ImageIcon, Copy, Check, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const STYLES = [
  { id: "clean", label: "Studio Bersih" },
  { id: "lifestyle", label: "Lifestyle Hangat" },
  { id: "minimal", label: "Minimal Putih" },
];

export default function AIStudio() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const [origImage, setOrigImage] = useState(null);    // data url
  const [enhanced, setEnhanced] = useState(null);      // raw base64 (no prefix)
  const [enhancing, setEnhancing] = useState(false);
  const [style, setStyle] = useState("clean");

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [description, setDescription] = useState("");
  const [igCaption, setIgCaption] = useState("");
  const [tiktokCaption, setTiktokCaption] = useState("");
  const [hashtags, setHashtags] = useState([]);
  const [extraHints, setExtraHints] = useState("");

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/shops/me");
      if (!data) { navigate("/onboarding"); return; }
      setShop(data);
    })();
  }, [navigate]);

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast.error("Ukuran foto maksimal 8MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setOrigImage(reader.result);
      setEnhanced(null);
    };
    reader.readAsDataURL(f);
  };

  const enhance = async () => {
    if (!origImage) { toast.error("Upload foto dulu"); return; }
    setEnhancing(true);
    try {
      const raw = origImage.startsWith("data:") ? origImage.split(",", 2)[1] : origImage;
      const { data } = await api.post("/ai/enhance-image", { image_base64: raw, style });
      setEnhanced(data.image_base64);
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

  const saveProduct = async () => {
    if (!name || !price) { toast.error("Nama & harga wajib diisi"); return; }
    setSaving(true);
    try {
      const finalImage = enhanced
        ? `data:image/png;base64,${enhanced}`
        : origImage || "";
      await api.post("/products", {
        name, price: parseInt(price, 10) || 0, stock: parseInt(stock, 10) || 0,
        description, image_data: finalImage, ig_caption: igCaption, tiktok_caption: tiktokCaption, hashtags,
      });
      toast.success("Produk berhasil disimpan!");
      navigate("/dashboard/products");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout
      shop={shop}
      title="AI Studio"
      subtitle="Upload foto, enhance, dan biarkan AI bikin deskripsi & caption."
    >
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Image side */}
        <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-bold text-lg">1. Foto Produk</h2>
            <span className="text-xs text-brand-mute">JPG/PNG, max 8MB</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <ImageBox
              label="Asli (dari HP)"
              src={origImage}
              empty={
                <label className="cursor-pointer flex flex-col items-center justify-center text-brand-mute h-full">
                  <Upload className="w-7 h-7 mb-2" />
                  <span className="text-sm font-semibold">Upload foto</span>
                  <span className="text-xs">tap di sini</span>
                  <input type="file" accept="image/*" className="hidden" onChange={onPickFile} data-testid="file-input" />
                </label>
              }
              tid="image-original"
            />
            <ImageBox
              label="AI Enhanced"
              src={enhanced ? `data:image/png;base64,${enhanced}` : null}
              empty={
                <div className="text-center text-brand-mute text-sm">
                  <ImageIcon className="w-7 h-7 mx-auto mb-2 opacity-60" />
                  Hasil AI tampil di sini
                </div>
              }
              tid="image-enhanced"
            />
          </div>

          <div className="mt-5">
            <Label className="mb-2 block">Gaya Foto</Label>
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

          <div className="mt-5 flex gap-3">
            <Button
              onClick={enhance} disabled={!origImage || enhancing}
              className="flex-1 bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
              data-testid="enhance-btn"
            >
              {enhancing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Sedang enhance…</> : <><Wand2 className="w-4 h-4 mr-2" /> Enhance dengan AI</>}
            </Button>
            <label className="rounded-xl border border-brand-line bg-white px-4 py-3 cursor-pointer text-sm font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4" /> Ganti
              <input type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            </label>
          </div>
        </div>

        {/* Form side */}
        <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
          <h2 className="font-heading font-bold text-lg">2. Detail Produk</h2>
          <div className="mt-5 space-y-4">
            <div>
              <Label htmlFor="pname">Nama Produk</Label>
              <Input id="pname" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Misal: Kopi Susu Gula Aren"
                className="mt-1 rounded-xl border-brand-line h-12" data-testid="product-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="price">Harga (Rp)</Label>
                <Input id="price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)}
                  placeholder="25000" className="mt-1 rounded-xl border-brand-line h-12" data-testid="product-price-input" />
              </div>
              <div>
                <Label htmlFor="stock">Stok</Label>
                <Input id="stock" type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)}
                  placeholder="20" className="mt-1 rounded-xl border-brand-line h-12" data-testid="product-stock-input" />
              </div>
            </div>
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

        <div className="mt-6 flex justify-end">
          <Button
            onClick={saveProduct} disabled={saving}
            className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
            data-testid="save-product-btn"
          >
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
