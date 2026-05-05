import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Plus, X, ImagePlus, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

const MAX_IMAGES = 5;
const DAY_LABELS = [
  { idx: 0, short: "Sen", long: "Senin" },
  { idx: 1, short: "Sel", long: "Selasa" },
  { idx: 2, short: "Rab", long: "Rabu" },
  { idx: 3, short: "Kam", long: "Kamis" },
  { idx: 4, short: "Jum", long: "Jumat" },
  { idx: 5, short: "Sab", long: "Sabtu" },
  { idx: 6, short: "Min", long: "Minggu" },
];

export default function EditProductDialog({ product, shop, categories = [], open, onOpenChange, onSaved }) {
  // LAPAKIN_EDIT_PRODUCT_CATEGORY_D
  const categoryOptions = Array.isArray(categories)
    ? categories.filter((category) => category?.is_active !== false && category?.category_id)
    : [];
  const [selectedCategoryId, setSelectedCategoryId] = useState(product?.category_id || "");

  useEffect(() => {
    if (open && product) {
      setSelectedCategoryId(product?.category_id || "");
    }
  }, [open, product?.product_id, product?.category_id]);


  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [description, setDescription] = useState("");
  const [igCaption, setIgCaption] = useState("");
  const [tiktokCaption, setTiktokCaption] = useState("");
  const [hashtags, setHashtags] = useState([]);
  const [hashtagsInput, setHashtagsInput] = useState("");
  const [images, setImages] = useState([]); // data URLs
  const [availableDays, setAvailableDays] = useState([]); // 0..6, empty = setiap hari
  const [saving, setSaving] = useState(false);
  const [enhancingIdx, setEnhancingIdx] = useState(null);

  const sellsBy = shop?.sells_by || "stock";

  const enhanceImage = async (idx) => {
    const dataUrl = images[idx];
    if (!dataUrl) return;
    setEnhancingIdx(idx);
    try {
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      const { data } = await api.post("/ai/enhance-image", { image_base64: base64, style: "clean" });
      const enhancedUrl = `data:${data.mime_type || "image/png"};base64,${data.image_base64}`;
      setImages((arr) => arr.map((v, i) => (i === idx ? enhancedUrl : v)));
      toast.success("Foto berhasil di-enhance ✨");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal enhance foto");
    } finally {
      setEnhancingIdx(null);
    }
  };

  useEffect(() => {
    if (!product) return;
    setName(product.name || "");
    setPrice(String(product.price ?? ""));
    setStock(String(product.stock ?? "0"));
    setDescription(product.description || "");
    setIgCaption(product.ig_caption || "");
    setTiktokCaption(product.tiktok_caption || "");
    setHashtags(Array.isArray(product.hashtags) ? product.hashtags : []);
    setHashtagsInput((Array.isArray(product.hashtags) ? product.hashtags : []).join(" "));
    setAvailableDays(Array.isArray(product.available_days) ? product.available_days : []);
    const imgs = Array.isArray(product.images) && product.images.length > 0
      ? product.images
      : (product.image_data ? [product.image_data] : []);
    setImages(imgs.map((i) => (i?.startsWith("data:") ? i : `data:image/png;base64,${i}`)));
  }, [product]);

  const toggleDay = (d) => {
    setAvailableDays((arr) => arr.includes(d) ? arr.filter((x) => x !== d) : [...arr, d].sort((a, b) => a - b));
  };

  const onPickFile = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remain = MAX_IMAGES - images.length;
    if (remain <= 0) { toast.error(`Maksimal ${MAX_IMAGES} foto per produk`); return; }
    const take = files.slice(0, remain);
    Promise.all(take.map((f) => new Promise((res) => {
      if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name} > 8MB, dilewati`); res(null); return; }
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    }))).then((arr) => {
      setImages((prev) => [...prev, ...arr.filter(Boolean)]);
    });
    e.target.value = "";
  };

  const removeImage = (idx) => setImages((arr) => arr.filter((_, i) => i !== idx));
  const moveFirst = (idx) => setImages((arr) => {
    const next = [...arr]; const [it] = next.splice(idx, 1); next.unshift(it); return next;
  });

  const save = async () => {
    if (!name) { toast.error("Nama produk wajib diisi"); return; }
    setSaving(true);
    try {
      const tags = hashtagsInput
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`));
      const payload = {
        name, price: parseInt(price, 10) || 0, stock: parseInt(stock, 10) || 0,
        description, image_data: images[0] || "", images,
        ig_caption: igCaption, tiktok_caption: tiktokCaption, hashtags: tags,
        available_days: availableDays,
      };
      const selectedCategory = categoryOptions.find(
        (category) => category.category_id === selectedCategoryId
      );

      payload.category_id = selectedCategoryId || "";
      payload.category = selectedCategory?.name || "";
      payload.category_name = selectedCategory?.name || "";

      const { data } = await api.put(`/products/${product.product_id}`, payload);
      toast.success("Produk diperbarui");
      onSaved?.(data);
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl" data-testid="edit-product-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">Edit Produk</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          {/* Images */}
          <div>
            <Label>Foto Produk (max {MAX_IMAGES})</Label>
            <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-3">
              {images.map((img, i) => (
                <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border border-brand-line"
                  data-testid={`edit-img-${i}`}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                  {i === 0 && (
                    <span className="absolute top-1 left-1 text-[10px] font-bold tracking-wider uppercase bg-brand text-white rounded-full px-2 py-0.5">Utama</span>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    {i !== 0 && (
                      <button onClick={() => moveFirst(i)} type="button"
                        className="text-xs bg-white/90 rounded px-2 py-1 font-semibold" data-testid={`set-primary-${i}`}>
                        Jadikan Utama
                      </button>
                    )}
                    <button onClick={() => enhanceImage(i)} type="button"
                      disabled={enhancingIdx === i}
                      title="AI enhance: bersihkan background, terangkan, profesional"
                      className="text-white bg-brand rounded p-1.5 disabled:opacity-50"
                      data-testid={`enhance-img-${i}`}>
                      {enhancingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => removeImage(i)} type="button"
                      className="text-white bg-red-600 rounded p-1.5" data-testid={`remove-img-${i}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Mobile-friendly: show enhance button always on small screens */}
                  <button onClick={() => enhanceImage(i)} type="button"
                    disabled={enhancingIdx === i}
                    className="absolute bottom-1 right-1 sm:hidden text-white bg-brand rounded-full p-1.5 shadow-md disabled:opacity-50"
                    data-testid={`enhance-img-mobile-${i}`}>
                    {enhancingIdx === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <label className="aspect-square rounded-xl border-2 border-dashed border-brand-line bg-brand-off/40 cursor-pointer flex flex-col items-center justify-center text-brand-mute hover:border-brand hover:text-brand">
                  <ImagePlus className="w-6 h-6" />
                  <span className="text-xs mt-1">Tambah</span>
                  <input type="file" multiple accept="image/*" className="hidden" onChange={onPickFile} data-testid="edit-add-image-input" />
                </label>
              )}
            </div>
          </div>

          <div>
            <Label>Nama Produk</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 rounded-xl border-brand-line h-12" data-testid="edit-name-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Harga (Rp)</Label>
              <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)}
                className="mt-1 rounded-xl border-brand-line h-12" data-testid="edit-price-input" />
            </div>
            {sellsBy === "stock" && (
              <div>
                <Label>Stok</Label>
                <Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)}
                  className="mt-1 rounded-xl border-brand-line h-12" data-testid="edit-stock-input" />
              </div>
            )}
            {sellsBy === "hours" && (
              <div>
                <Label>Mode</Label>
                <div className="mt-1 h-12 rounded-xl border border-brand-line bg-brand-off px-3 flex items-center text-sm text-brand-mute">
                  🍜 Tergantung jam buka
                </div>
              </div>
            )}
            {sellsBy === "always" && (
              <div>
                <Label>Mode</Label>
                <div className="mt-1 h-12 rounded-xl border border-brand-line bg-brand-off px-3 flex items-center text-sm text-brand-mute">
                  ♾️ Selalu tersedia
                </div>
              </div>
            )}
          </div>

          {sellsBy === "hours" && (
            <div data-testid="available-days-picker">
              <Label>Hari Tersedia</Label>
              <p className="text-xs text-brand-mute mt-0.5 mb-2">
                Kosongkan = tersedia setiap hari. Pilih hari kalau menu rotasi (mis. catering harian).
              </p>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((d) => (
                  <button key={d.idx} type="button"
                    onClick={() => toggleDay(d.idx)}
                    className={`text-sm font-semibold rounded-full px-4 py-2 border-2 transition ${
                      availableDays.includes(d.idx)
                        ? "bg-brand text-white border-brand"
                        : "bg-white text-brand-ink border-brand-line hover:border-brand"
                    }`}
                    data-testid={`day-toggle-${d.idx}`}>
                    {d.short}
                  </button>
                ))}
                {availableDays.length > 0 && (
                  <button type="button" onClick={() => setAvailableDays([])}
                    className="text-xs text-brand-mute hover:text-red-500 underline self-center"
                    data-testid="day-clear">
                    Setiap hari
                  </button>
                )}
              </div>
            </div>
          )}
          <div>
            <Label>Deskripsi</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              className="mt-1 rounded-xl border-brand-line" data-testid="edit-description-input" />
          </div>
          <div>
            <Label>Caption Instagram</Label>
            <Textarea rows={2} value={igCaption} onChange={(e) => setIgCaption(e.target.value)}
              className="mt-1 rounded-xl border-brand-line" data-testid="edit-ig-input" />
          </div>
          <div>
            <Label>Caption TikTok</Label>
            <Textarea rows={2} value={tiktokCaption} onChange={(e) => setTiktokCaption(e.target.value)}
              className="mt-1 rounded-xl border-brand-line" data-testid="edit-tiktok-input" />
          </div>
          <div>
            <Label>Hashtag (pisah dengan spasi)</Label>
            <Input value={hashtagsInput} onChange={(e) => setHashtagsInput(e.target.value)}
              placeholder="#kopi #umkm #lokal" className="mt-1 rounded-xl border-brand-line h-12 font-mono text-sm"
              data-testid="edit-hashtags-input" />
          </div>
        </div>

          <label className="text-sm font-semibold text-brand-dark block" data-testid="edit-product-category-field">
            Kategori
            <select
              value={selectedCategoryId}
              onChange={(event) => setSelectedCategoryId(event.target.value)}
              className="mt-1 w-full rounded-xl border border-brand-line px-3 py-2 bg-white"
              data-testid="edit-product-category-select"
            >
              <option value="">Tanpa kategori</option>
              {categoryOptions.map((category) => (
                <option key={category.category_id} value={category.category_id}>
                  {category.name}
                </option>
              ))}
            </select>
            {categoryOptions.length === 0 ? (
              <span className="mt-1 block text-xs text-brand-mute">
                Belum ada kategori. Buat kategori dulu dari halaman Produk.
              </span>
            ) : null}
          </label>

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="edit-cancel-btn">Batal</Button>
          <Button onClick={save} disabled={saving}
            className="bg-brand hover:bg-brand-hover text-white rounded-xl font-semibold btn-press"
            data-testid="edit-save-btn">
            <Save className="w-4 h-4 mr-2" /> {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
