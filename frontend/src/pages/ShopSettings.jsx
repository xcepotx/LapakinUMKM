import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save } from "lucide-react";
import { toast } from "sonner";

const BUSINESS_TYPES = [
  { id: "kuliner", label: "Kuliner / Makanan" },
  { id: "kopi", label: "Kopi / Minuman" },
  { id: "fashion", label: "Fashion" },
  { id: "kerajinan", label: "Kerajinan / Handmade" },
  { id: "kecantikan", label: "Kecantikan" },
  { id: "lainnya", label: "Lainnya" },
];

export default function ShopSettings() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/shops/me");
      if (!data) { navigate("/onboarding"); return; }
      setShop(data);
    })();
  }, [navigate]);

  if (!shop) {
    return (
      <DashboardLayout title="Pengaturan Toko">
        <div className="text-brand-mute">Memuat…</div>
      </DashboardLayout>
    );
  }

  const update = (k, v) => setShop((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/shops/me", {
        name: shop.name, tagline: shop.tagline || "", description: shop.description || "",
        business_type: shop.business_type, whatsapp: shop.whatsapp || "",
        brand_color: shop.brand_color || "#C04A3B", logo_url: shop.logo_url || "",
      });
      setShop(data);
      toast.success("Tersimpan");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan");
    } finally { setSaving(false); }
  };

  return (
    <DashboardLayout shop={shop} title="Pengaturan Toko" subtitle="Atur identitas brand & kontak pelanggan.">
      <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card max-w-2xl">
        <div className="space-y-5">
          <div>
            <Label>Nama Toko</Label>
            <Input value={shop.name} onChange={(e) => update("name", e.target.value)}
              className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-name" />
          </div>
          <div>
            <Label>Tagline</Label>
            <Input value={shop.tagline || ""} onChange={(e) => update("tagline", e.target.value)}
              className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-tagline" />
          </div>
          <div>
            <Label>Deskripsi</Label>
            <Textarea rows={3} value={shop.description || ""} onChange={(e) => update("description", e.target.value)}
              className="mt-1 rounded-xl border-brand-line" data-testid="settings-description" />
          </div>
          <div>
            <Label>Jenis Bisnis</Label>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {BUSINESS_TYPES.map((b) => (
                <button key={b.id} type="button" onClick={() => update("business_type", b.id)}
                  className={`text-sm font-semibold rounded-xl px-4 py-3 border ${
                    shop.business_type === b.id
                      ? "bg-brand text-white border-brand"
                      : "bg-white text-brand-ink border-brand-line hover:border-brand"
                  }`}
                >{b.label}</button>
              ))}
            </div>
          </div>
          <div>
            <Label>WhatsApp</Label>
            <Input value={shop.whatsapp || ""} onChange={(e) => update("whatsapp", e.target.value)}
              placeholder="08xxxxxxxxxx" className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-whatsapp" />
          </div>
          <div>
            <Label>Warna Brand</Label>
            <div className="mt-1 flex items-center gap-3">
              <input type="color" value={shop.brand_color || "#C04A3B"}
                onChange={(e) => update("brand_color", e.target.value)}
                className="w-14 h-12 rounded-xl border border-brand-line cursor-pointer" data-testid="settings-color" />
              <Input value={shop.brand_color || "#C04A3B"} onChange={(e) => update("brand_color", e.target.value)}
                className="rounded-xl border-brand-line h-12 max-w-[140px]" />
              <div className="rounded-xl px-4 py-2 text-white font-semibold text-sm" style={{ background: shop.brand_color || "#C04A3B" }}>
                Pratinjau
              </div>
            </div>
          </div>
          <div className="text-sm text-brand-mute pt-2 border-t border-brand-line">
            URL toko: <span className="font-mono">{window.location.origin}/toko/{shop.slug}</span>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}
              className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
              data-testid="settings-save-btn"
            >
              <Save className="w-4 h-4 mr-2" /> {saving ? "Menyimpan…" : "Simpan Perubahan"}
            </Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
