import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, ArrowRight, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const BUSINESS_TYPES = [
  { id: "kuliner", label: "Kuliner / Makanan" },
  { id: "kopi", label: "Kopi / Minuman" },
  { id: "fashion", label: "Fashion" },
  { id: "kerajinan", label: "Kerajinan / Handmade" },
  { id: "kecantikan", label: "Kecantikan" },
  { id: "lainnya", label: "Lainnya" },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("kuliner");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [brandColor, setBrandColor] = useState("#C04A3B");
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const suggestTheme = async () => {
    if (!name) { toast.error("Isi nama toko dulu"); return; }
    setSuggesting(true);
    try {
      const { data } = await api.post("/ai/suggest-theme", { business_type: businessType, shop_name: name });
      if (data?.brand_color) setBrandColor(data.brand_color);
      if (data?.tagline) setTagline(data.tagline);
      toast.success("AI sudah sarankan tema!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal generate tema");
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post("/shops/me", {
        name, business_type: businessType, tagline, description,
        whatsapp, brand_color: brandColor, logo_url: "",
      });
      await refreshUser();
      toast.success("Tokomu siap! 🎉");
      navigate("/dashboard");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal membuat toko");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-sand py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-8">
          <span className="w-8 h-8 rounded-xl bg-brand grid place-items-center text-white"><Sparkles className="w-4 h-4" /></span>
          <span className="font-heading font-extrabold text-lg">Lapakin</span>
        </div>

        <div className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Langkah {step} dari 2</div>
        <h1 className="font-heading font-extrabold text-3xl mt-2">
          {step === 1 ? "Ceritakan tentang tokomu" : "Tampilan & kontak"}
        </h1>
        <p className="text-brand-mute mt-2">
          {step === 1
            ? "Lapakin akan menyiapkan halaman tokomu dengan info ini."
            : "Pilih warna brand & nomor WhatsApp untuk pelanggan."}
        </p>

        <div className="mt-8 bg-white border border-brand-line rounded-2xl p-6 sm:p-8 shadow-card">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <Label htmlFor="name">Nama Toko</Label>
                <Input
                  id="name" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Misal: Kopi Senja"
                  className="mt-1 rounded-xl border-brand-line h-12"
                  data-testid="onboard-shop-name"
                />
              </div>
              <div>
                <Label>Jenis Bisnis</Label>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {BUSINESS_TYPES.map((b) => (
                    <button
                      key={b.id} type="button"
                      onClick={() => setBusinessType(b.id)}
                      className={`text-sm font-semibold rounded-xl px-4 py-3 border transition-colors ${
                        businessType === b.id
                          ? "bg-brand text-white border-brand"
                          : "bg-white text-brand-ink border-brand-line hover:border-brand"
                      }`}
                      data-testid={`btype-${b.id}`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="desc">Deskripsi Singkat (opsional)</Label>
                <Textarea
                  id="desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Misal: Kopi specialty asli Bandung, biji pilihan, roasting harian."
                  className="mt-1 rounded-xl border-brand-line"
                  data-testid="onboard-shop-desc"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => name ? setStep(2) : toast.error("Isi nama toko")}
                  className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
                  data-testid="onboard-next-btn"
                >
                  Lanjut <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <Label htmlFor="tagline">Tagline (opsional)</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="tagline" value={tagline} onChange={(e) => setTagline(e.target.value)}
                    placeholder="Misal: Sruput rasa Bandung."
                    className="rounded-xl border-brand-line h-12 flex-1"
                    data-testid="onboard-tagline"
                  />
                  <Button
                    type="button" onClick={suggestTheme} disabled={suggesting}
                    variant="outline"
                    className="rounded-xl h-12 border-brand-line bg-brand-off hover:bg-white shrink-0"
                    data-testid="onboard-ai-suggest-btn"
                  >
                    <Wand2 className="w-4 h-4 mr-1" /> {suggesting ? "AI mikir…" : "AI Sarankan"}
                  </Button>
                </div>
              </div>
              <div>
                <Label htmlFor="wa">Nomor WhatsApp</Label>
                <Input
                  id="wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="08xxxxxxxxxx"
                  className="mt-1 rounded-xl border-brand-line h-12"
                  data-testid="onboard-whatsapp"
                />
                <p className="text-xs text-brand-mute mt-1">Pelanggan akan dihubungkan ke WhatsApp ini saat checkout.</p>
              </div>
              <div>
                <Label htmlFor="color">Warna Brand</Label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    id="color" type="color" value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="w-14 h-12 rounded-xl border border-brand-line cursor-pointer bg-white"
                    data-testid="onboard-brand-color"
                  />
                  <Input
                    value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
                    className="rounded-xl border-brand-line h-12 max-w-[140px]"
                  />
                  <div className="rounded-xl px-4 py-2 text-white font-semibold text-sm" style={{ background: brandColor }}>
                    Pratinjau
                  </div>
                </div>
              </div>

              <div className="flex justify-between gap-3 pt-2">
                <Button variant="ghost" onClick={() => setStep(1)} data-testid="onboard-back-btn">Kembali</Button>
                <Button
                  onClick={submit} disabled={submitting}
                  className="bg-brand hover:bg-brand-hover text-white rounded-xl px-6 h-12 font-semibold btn-press"
                  data-testid="onboard-finish-btn"
                >
                  {submitting ? "Membuat toko…" : "Buat Tokoku"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
