import { useMemo, useState } from "react";
import { ImagePlus, RefreshCw, Save, Share2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

function cleanShopPayload(shop = {}) {
  const payload = { ...(shop || {}) };
  ["_id", "created_at", "updated_at", "owner_user_id", "shop_id"].forEach((key) => {
    delete payload[key];
  });
  return payload;
}

function previewValue(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function buildPreview(shop = {}) {
  const title = previewValue(shop.storefront_seo_title, shop.name || "Nama toko");
  const description = previewValue(
    shop.storefront_seo_description,
    shop.tagline || shop.description || "Deskripsi singkat toko akan tampil di preview link."
  );
  const slug = shop.slug || "slug-toko";
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://lapakin.my.id";

  return {
    title,
    description,
    image: String(shop.storefront_seo_image || "").trim(),
    url: `${origin}/toko/${slug}`,
  };
}

export default function StorefrontSeoEditor({ shop, setShop }) {
  const [saving, setSaving] = useState(false);
  const preview = useMemo(() => buildPreview(shop || {}), [shop]);

  const updateField = (field, value) => {
    setShop((prev) => ({ ...(prev || {}), [field]: value }));
  };

  const resetToFallback = () => {
    setShop((prev) => ({
      ...(prev || {}),
      storefront_seo_title: "",
      storefront_seo_description: "",
      storefront_seo_image: "",
    }));
  };

  const save = async () => {
    if (!shop) {
      toast.error("Data toko belum siap.");
      return;
    }

    setSaving(true);
    try {
      const payload = cleanShopPayload(shop);
      const { data } = await api.post("/shops/me", payload);
      setShop(data || shop);
      toast.success("SEO/social preview disimpan.");
    } catch (error) {
      console.error("Failed to save storefront SEO settings", error);
      toast.error(error?.response?.data?.detail || "Gagal menyimpan SEO/social preview.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="storefront-seo-editor-card" className="space-y-4 rounded-3xl border border-brand-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-primary">SEO & social preview</p>
          <h2 className="mt-1 font-heading text-xl font-extrabold text-brand-ink">Preview link toko saat dibagikan</h2>
          <p className="mt-1 text-sm text-brand-mute">
            Atur judul, deskripsi, dan gambar preview agar link toko terlihat rapi di WhatsApp dan media sosial.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetToFallback}
            className="inline-flex items-center rounded-2xl border border-brand-line bg-white px-3 py-2 text-xs font-bold text-brand-ink hover:bg-brand-off"
            data-testid="storefront-seo-reset-btn"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Reset fallback
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center rounded-2xl bg-brand px-4 py-2 text-xs font-extrabold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="storefront-seo-save-btn"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? "Menyimpan..." : "Simpan SEO"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-brand-ink">
          Judul SEO
          <input
            value={shop?.storefront_seo_title || ""}
            onChange={(event) => updateField("storefront_seo_title", event.target.value)}
            maxLength={70}
            className="rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm"
            placeholder={shop?.name || "Nama toko"}
            data-testid="storefront-seo-title-input"
          />
          <span className="text-xs font-normal text-brand-mute">
            {(shop?.storefront_seo_title || "").length}/70 karakter
          </span>
        </label>

        <label className="grid gap-1 text-sm font-semibold text-brand-ink">
          Gambar social preview
          <input
            value={shop?.storefront_seo_image || ""}
            onChange={(event) => updateField("storefront_seo_image", event.target.value)}
            className="rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm"
            placeholder="URL gambar atau data image"
            data-testid="storefront-seo-image-input"
          />
          <span className="text-xs font-normal text-brand-mute">
            Kosongkan untuk memakai OG image otomatis Lapakin.
          </span>
        </label>

        <label className="grid gap-1 text-sm font-semibold text-brand-ink lg:col-span-2">
          Deskripsi SEO
          <textarea
            value={shop?.storefront_seo_description || ""}
            onChange={(event) => updateField("storefront_seo_description", event.target.value)}
            maxLength={160}
            rows={3}
            className="rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm"
            placeholder={shop?.tagline || shop?.description || "Deskripsi singkat toko untuk preview sosial"}
            data-testid="storefront-seo-description-input"
          />
          <span className="text-xs font-normal text-brand-mute">
            {(shop?.storefront_seo_description || "").length}/160 karakter
          </span>
        </label>
      </div>

      <div className="rounded-2xl border border-brand-line bg-slate-50 p-4" data-testid="storefront-seo-social-preview">
        <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-brand-ink">
          <Share2 className="h-4 w-4 text-brand-primary" />
          Preview kartu share
        </div>
        <div className="overflow-hidden rounded-2xl border border-brand-line bg-white">
          {preview.image ? (
            <img src={preview.image} alt="Preview SEO" className="h-36 w-full object-cover" />
          ) : (
            <div className="flex h-36 items-center justify-center bg-gradient-to-br from-brand-soft to-white px-4 text-center text-sm font-bold text-brand-primary">
              <ImagePlus className="mr-2 h-5 w-5" />
              OG image otomatis dari Lapakin
            </div>
          )}
          <div className="space-y-1 p-4">
            <p className="line-clamp-2 text-base font-extrabold text-brand-ink">{preview.title}</p>
            <p className="line-clamp-3 text-sm text-brand-mute">{preview.description}</p>
            <p className="truncate text-xs font-semibold text-brand-primary">{preview.url}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
