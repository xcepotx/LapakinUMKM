import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Wand2, Upload, X, ImagePlus, Trash2, QrCode, RefreshCw } from "lucide-react";
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

const COVER_STYLES = [
  { id: "warm", label: "Hangat / Earthy" },
  { id: "minimal", label: "Minimal / Bersih" },
  { id: "vibrant", label: "Cerah / Vibrant" },
];

export default function ShopSettings() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const [saving, setSaving] = useState(false);
  const [generatingAbout, setGeneratingAbout] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverStyle, setCoverStyle] = useState("warm");

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/shops/me");
      if (!data) { navigate("/onboarding"); return; }
      setShop(data);
    })();
  }, [navigate]);

  if (!shop) {
    return <DashboardLayout title="Pengaturan Toko"><div className="text-brand-mute">Memuat…</div></DashboardLayout>;
  }

  const update = (k, v) => setShop((s) => ({ ...s, [k]: v }));

  const onCoverFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast.error("Max 8MB"); return; }
    const r = new FileReader();
    r.onload = () => update("cover_image", r.result);
    r.readAsDataURL(f);
    e.target.value = "";
  };

  const generateAbout = async () => {
    setGeneratingAbout(true);
    try {
      const { data } = await api.post("/ai/generate-about", {
        shop_name: shop.name, business_type: shop.business_type,
        tagline: shop.tagline || "", description: shop.description || "",
      });
      update("about", data.about);
      toast.success("Cerita 'Tentang Kami' dibuat AI!");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal"); }
    finally { setGeneratingAbout(false); }
  };

  const generateCover = async () => {
    setGeneratingCover(true);
    try {
      const { data } = await api.post("/ai/generate-cover", {
        shop_name: shop.name, business_type: shop.business_type, style: coverStyle,
      });
      update("cover_image", `data:${data.mime_type || "image/png"};base64,${data.image_base64}`);
      toast.success("Cover banner AI siap!");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal"); }
    finally { setGeneratingCover(false); }
  };

  // ----- Story Reel -----
  const onStoryFile = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remain = 5 - (shop.story?.length || 0);
    if (remain <= 0) { toast.error("Maksimal 5 foto story"); return; }
    Promise.all(files.slice(0, remain).map((f) => new Promise((res) => {
      if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} > 5MB`); res(null); return; }
      const r = new FileReader(); r.onload = () => res({ image: r.result, caption: "" }); r.readAsDataURL(f);
    }))).then((arr) => {
      update("story", [...(shop.story || []), ...arr.filter(Boolean)]);
    });
    e.target.value = "";
  };
  const removeStory = (i) => update("story", (shop.story || []).filter((_, idx) => idx !== i));
  const setStoryCaption = (i, txt) => update("story", (shop.story || []).map((s, idx) => idx === i ? { ...s, caption: txt } : s));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...shop };
      delete payload.shop_id; delete payload.slug; delete payload.owner_user_id;
      delete payload.created_at; delete payload.updated_at; delete payload.status; delete payload.featured;
      const { data } = await api.post("/shops/me", payload);
      setShop(data);
      toast.success("Tersimpan");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal simpan"); }
    finally { setSaving(false); }
  };

  return (
    <DashboardLayout shop={shop} title="Pengaturan Toko" subtitle="Lengkapi profil toko biar pelanggan makin percaya."
      actions={
        <Button onClick={() => navigate("/dashboard/qr")}
          variant="outline"
          className="rounded-xl border-brand-line"
          data-testid="settings-qr-btn">
          <QrCode className="w-4 h-4 mr-2" /> QR Lapak Saya
        </Button>
      }>
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-6">
          {/* MODE TOKO — Iteration 7 */}
          <Section title="Mode Jualan" desc="Pilih cara tokomu jualan. Sistem akan menyesuaikan tampilan stok & status buka.">
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { id: "stock",  emoji: "📦", title: "Stok",        desc: "Pakai jumlah stok per produk. Cocok fashion, kerajinan, aksesoris." },
                { id: "hours",  emoji: "🍜", title: "Jam Buka",    desc: "Tidak pakai stok. Toko bisa BUKA/TUTUP. Cocok kuliner, kopi, warteg." },
                { id: "always", emoji: "♾️", title: "Selalu Ada",  desc: "Tidak pakai stok & jam buka. Cocok jasa, digital, pre-order." },
              ].map((m) => (
                <button key={m.id} type="button"
                  onClick={() => update("sells_by", m.id)}
                  className={`text-left p-4 rounded-xl border-2 transition ${
                    (shop.sells_by || "stock") === m.id
                      ? "bg-brand text-white border-brand"
                      : "bg-white border-brand-line hover:border-brand"
                  }`}
                  data-testid={`mode-${m.id}`}>
                  <div className="text-2xl">{m.emoji}</div>
                  <div className="font-bold mt-1">{m.title}</div>
                  <div className={`text-xs mt-1 leading-snug ${(shop.sells_by || "stock") === m.id ? "text-white/85" : "text-brand-mute"}`}>{m.desc}</div>
                </button>
              ))}
            </div>
            {(shop.sells_by || "stock") === "hours" && (
              <>
                <div className="mt-4 p-4 rounded-xl bg-brand-off border border-brand-line">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        Status Toko Sekarang:{" "}
                        <span className={shop.is_open !== false ? "text-green-700" : "text-red-700"}>
                          {shop.is_open !== false ? "BUKA" : "TUTUP"}
                        </span>
                      </div>
                      <div className="text-xs text-brand-mute mt-0.5">
                        {shop.auto_schedule_enabled
                          ? "Status otomatis dari jadwal di bawah. Manual toggle dinonaktifkan."
                          : "Toggle ini juga ada di Beranda untuk akses cepat."}
                      </div>
                    </div>
                    <button type="button"
                      disabled={!!shop.auto_schedule_enabled}
                      onClick={() => update("is_open", !(shop.is_open !== false))}
                      className={`px-4 py-2 rounded-xl font-bold text-sm ${shop.is_open !== false ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"} disabled:opacity-40 disabled:cursor-not-allowed`}
                      data-testid="settings-toggle-open">
                      {shop.is_open !== false ? "Tutup Toko" : "Buka Toko"}
                    </button>
                  </div>
                </div>

                {/* AUTO-SCHEDULE EDITOR */}
                <div className="mt-4 p-4 rounded-xl bg-white border border-brand-line" data-testid="schedule-editor">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1 w-4 h-4 accent-brand"
                      checked={!!shop.auto_schedule_enabled}
                      onChange={(e) => update("auto_schedule_enabled", e.target.checked)}
                      data-testid="auto-schedule-toggle" />
                    <div>
                      <div className="font-semibold">Auto Buka/Tutup Sesuai Jadwal ⏰</div>
                      <div className="text-xs text-brand-mute mt-0.5">
                        Toko otomatis BUKA dan TUTUP berdasarkan jadwal di bawah (zona waktu WIB / Jakarta).
                      </div>
                    </div>
                  </label>

                  <div className={`mt-4 space-y-2 ${shop.auto_schedule_enabled ? "" : "opacity-50 pointer-events-none"}`}>
                    {[
                      { idx: 0, label: "Senin" },
                      { idx: 1, label: "Selasa" },
                      { idx: 2, label: "Rabu" },
                      { idx: 3, label: "Kamis" },
                      { idx: 4, label: "Jumat" },
                      { idx: 5, label: "Sabtu" },
                      { idx: 6, label: "Minggu" },
                    ].map((day) => {
                      const entry = (shop.schedule || [])[day.idx];
                      const isOpenDay = !!(entry && entry.open && entry.close);
                      const setEntry = (next) => {
                        const arr = [...(shop.schedule || [])];
                        while (arr.length < 7) arr.push(null);
                        arr[day.idx] = next;
                        update("schedule", arr);
                      };
                      return (
                        <div key={day.idx} className="flex items-center gap-2 sm:gap-3 py-1" data-testid={`schedule-row-${day.idx}`}>
                          <div className="w-20 sm:w-24 font-semibold text-sm">{day.label}</div>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input type="checkbox" className="w-3.5 h-3.5 accent-brand"
                              checked={isOpenDay}
                              onChange={(e) => setEntry(e.target.checked ? { open: "08:00", close: "21:00" } : null)}
                              data-testid={`schedule-open-${day.idx}`} />
                            Buka
                          </label>
                          <input type="time" disabled={!isOpenDay}
                            value={entry?.open || ""}
                            onChange={(e) => setEntry({ ...(entry || {}), open: e.target.value })}
                            className="rounded-lg border border-brand-line h-9 px-2 text-sm bg-white disabled:bg-brand-off disabled:text-brand-mute"
                            data-testid={`schedule-open-time-${day.idx}`} />
                          <span className="text-brand-mute text-sm">–</span>
                          <input type="time" disabled={!isOpenDay}
                            value={entry?.close || ""}
                            onChange={(e) => setEntry({ ...(entry || {}), close: e.target.value })}
                            className="rounded-lg border border-brand-line h-9 px-2 text-sm bg-white disabled:bg-brand-off disabled:text-brand-mute"
                            data-testid={`schedule-close-time-${day.idx}`} />
                          {!isOpenDay && <span className="text-xs text-brand-mute italic">Libur</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </Section>

          {/* COVER BANNER */}
          <Section title="Cover Banner" desc="Foto besar di puncak toko (16:6). Upload sendiri atau biarkan AI bikin.">
            <div className="aspect-[16/6] rounded-xl bg-brand-off border border-brand-line overflow-hidden relative">
              {shop.cover_image ? (
                <>
                  <img src={shop.cover_image} alt="cover" className="w-full h-full object-cover" data-testid="cover-preview" />
                  <button onClick={() => update("cover_image", "")}
                    className="absolute top-2 right-2 bg-white/90 rounded-full p-1.5 hover:bg-white"
                    data-testid="cover-remove-btn">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <div className="w-full h-full grid place-items-center text-brand-mute">
                  Belum ada cover
                </div>
              )}
            </div>
            <div className="mt-3">
              <Label className="text-xs">Gaya Cover AI</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {COVER_STYLES.map((s) => (
                  <button key={s.id} type="button" onClick={() => setCoverStyle(s.id)}
                    className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${coverStyle === s.id ? "bg-brand text-white border-brand" : "bg-white border-brand-line"}`}
                    data-testid={`cover-style-${s.id}`}>{s.label}</button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Button onClick={generateCover} disabled={generatingCover}
                className="bg-brand hover:bg-brand-hover text-white rounded-xl btn-press"
                data-testid="cover-generate-btn">
                {generatingCover ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> AI bikin cover…</> : <><Wand2 className="w-4 h-4 mr-2" /> Generate Cover dengan AI</>}
              </Button>
              <label className="rounded-xl border border-brand-line bg-white px-4 py-2 cursor-pointer text-sm font-semibold flex items-center gap-2 hover:bg-brand-off">
                <Upload className="w-4 h-4" /> Upload Sendiri
                <input type="file" accept="image/*" className="hidden" onChange={onCoverFile} data-testid="cover-upload-input" />
              </label>
            </div>
          </Section>

          {/* IDENTITY */}
          <Section title="Identitas Toko" desc="Info dasar yang tampil di header & meta.">
            <div className="space-y-4">
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
                <Label>Deskripsi Singkat</Label>
                <Textarea rows={2} value={shop.description || ""} onChange={(e) => update("description", e.target.value)}
                  className="mt-1 rounded-xl border-brand-line" data-testid="settings-description" />
              </div>
              <div>
                <Label>Jenis Bisnis</Label>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {BUSINESS_TYPES.map((b) => (
                    <button key={b.id} type="button" onClick={() => update("business_type", b.id)}
                      className={`text-sm font-semibold rounded-xl px-4 py-3 border ${shop.business_type === b.id ? "bg-brand text-white border-brand" : "bg-white text-brand-ink border-brand-line hover:border-brand"}`}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* ABOUT US */}
          <Section title="Tentang Kami" desc="Cerita singkat tentang toko. Klik AI biar dibuatkan otomatis.">
            <Textarea rows={5} value={shop.about || ""} onChange={(e) => update("about", e.target.value)}
              placeholder="Cerita toko kamu… atau klik 'AI Tulis Cerita' di bawah."
              className="rounded-xl border-brand-line" data-testid="settings-about" />
            <Button onClick={generateAbout} disabled={generatingAbout || !shop.name}
              variant="outline"
              className="mt-3 rounded-xl border-brand bg-brand-off text-brand hover:bg-brand hover:text-white btn-press"
              data-testid="about-generate-btn">
              {generatingAbout ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> AI menulis…</> : <><Wand2 className="w-4 h-4 mr-2" /> AI Tulis Cerita</>}
            </Button>
          </Section>

          {/* SHOP STORY REEL */}
          <Section title="Shop Story Reel" desc="3-5 foto behind-the-scenes (proses, suasana, kru). Tampil seperti IG Stories di toko.">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {(shop.story || []).map((s, i) => (
                <div key={i} className="space-y-2" data-testid={`story-item-${i}`}>
                  <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-brand-line">
                    <img src={s.image} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => removeStory(i)}
                      className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1"
                      data-testid={`story-remove-${i}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <Input value={s.caption} onChange={(e) => setStoryCaption(i, e.target.value)}
                    placeholder="Caption…" maxLength={60}
                    className="rounded-lg border-brand-line h-8 text-xs" />
                </div>
              ))}
              {(shop.story?.length || 0) < 5 && (
                <label className="aspect-[3/4] rounded-xl border-2 border-dashed border-brand-line bg-brand-off/40 cursor-pointer flex flex-col items-center justify-center text-brand-mute hover:border-brand hover:text-brand">
                  <ImagePlus className="w-6 h-6" />
                  <span className="text-xs mt-1">Tambah</span>
                  <input type="file" multiple accept="image/*" className="hidden" onChange={onStoryFile} data-testid="story-add-input" />
                </label>
              )}
            </div>
          </Section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Section title="Kontak & Sosial" desc="">
            <div className="space-y-4">
              <div>
                <Label>WhatsApp</Label>
                <Input value={shop.whatsapp || ""} onChange={(e) => update("whatsapp", e.target.value)}
                  placeholder="08xxxxxxxxxx" className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-whatsapp" />
              </div>
              <div>
                <Label>Instagram</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute">@</span>
                  <Input value={shop.instagram || ""} onChange={(e) => update("instagram", e.target.value.replace(/^@/, ""))}
                    placeholder="namatoko" className="pl-7 rounded-xl border-brand-line h-12" data-testid="settings-instagram" />
                </div>
              </div>
              <div>
                <Label>TikTok</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute">@</span>
                  <Input value={shop.tiktok || ""} onChange={(e) => update("tiktok", e.target.value.replace(/^@/, ""))}
                    placeholder="namatoko" className="pl-7 rounded-xl border-brand-line h-12" data-testid="settings-tiktok" />
                </div>
              </div>
              <div>
                <Label>Shopee URL</Label>
                <Input value={shop.shopee || ""} onChange={(e) => update("shopee", e.target.value)}
                  placeholder="https://shopee.co.id/..." className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-shopee" />
              </div>
            </div>
          </Section>

          <Section title="Lokasi & Jam">
            <div className="space-y-4">
              <div>
                <Label>Alamat / Area</Label>
                <Input value={shop.address || ""} onChange={(e) => update("address", e.target.value)}
                  placeholder="Jl. Asia Afrika No.123, Bandung"
                  className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-address" />
              </div>
              <div>
                <Label>Jam Buka</Label>
                <Input value={shop.hours || ""} onChange={(e) => update("hours", e.target.value)}
                  placeholder="Senin-Sabtu 08:00-21:00"
                  className="mt-1 rounded-xl border-brand-line h-12" data-testid="settings-hours" />
              </div>
            </div>
          </Section>

          <Section title="Banner Promo" desc="Tampil di atas grid produk kalau aktif.">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!shop.promo_active}
                onChange={(e) => update("promo_active", e.target.checked)}
                className="w-4 h-4 accent-brand" data-testid="promo-active-toggle" />
              <span className="text-sm font-semibold">Aktifkan Promo</span>
            </label>
            <div className={`mt-3 space-y-3 ${shop.promo_active ? "" : "opacity-50 pointer-events-none"}`}>
              <Input value={shop.promo_title || ""} onChange={(e) => update("promo_title", e.target.value)}
                placeholder="Judul: Diskon Pembeli Pertama"
                className="rounded-xl border-brand-line h-11" data-testid="promo-title" maxLength={60} />
              <Textarea rows={2} value={shop.promo_description || ""} onChange={(e) => update("promo_description", e.target.value)}
                placeholder="Detail singkat promo"
                className="rounded-xl border-brand-line" data-testid="promo-description" maxLength={150} />
              <Input value={shop.promo_code || ""} onChange={(e) => update("promo_code", e.target.value.toUpperCase())}
                placeholder="Kode: HALOKOPI"
                className="rounded-xl border-brand-line h-11 font-mono" data-testid="promo-code" maxLength={20} />
            </div>
          </Section>

          <Section title="Tampilan">
            <Label>Warna Brand</Label>
            <div className="mt-1 flex items-center gap-3">
              <input type="color" value={shop.brand_color || "#C04A3B"}
                onChange={(e) => update("brand_color", e.target.value)}
                className="w-14 h-12 rounded-xl border border-brand-line cursor-pointer" data-testid="settings-color" />
              <Input value={shop.brand_color || "#C04A3B"} onChange={(e) => update("brand_color", e.target.value)}
                className="rounded-xl border-brand-line h-12" />
            </div>
            <div className="mt-3 text-xs text-brand-mute font-mono break-all">URL: {window.location.origin}/toko/{shop.slug}</div>
          </Section>
        </div>
      </div>

      {/* CUSTOM DOMAIN — BISNIS tier */}
      <CustomDomainSection shop={shop} />

      {/* Save bar */}
      <div className="sticky bottom-4 mt-8 bg-white border border-brand-line rounded-2xl shadow-cardHover p-4 flex justify-end">
        <Button onClick={save} disabled={saving}
          className="bg-brand hover:bg-brand-hover text-white rounded-xl px-7 h-12 font-semibold btn-press"
          data-testid="settings-save-btn">
          <Save className="w-4 h-4 mr-2" /> {saving ? "Menyimpan…" : "Simpan Semua Perubahan"}
        </Button>
      </div>
    </DashboardLayout>
  );
}

function Section({ title, desc, children }) {
  return (
    <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card">
      <div className="mb-4">
        <h3 className="font-heading font-bold">{title}</h3>
        {desc && <p className="text-xs text-brand-mute mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function CustomDomainSection({ shop }) {
  const { user } = useAuth();
  const [domain, setDomain] = useState(shop?.custom_domain || "");
  const [verified, setVerified] = useState(!!shop?.custom_domain_verified);
  const [dns, setDns] = useState(null);
  const [saving, setSaving] = useState(false);
  const isBusiness = (user?.tier || "free") === "business";

  if (!shop) return null;

  const request = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/shops/me/custom-domain", { domain });
      setDns(data.dns_instructions);
      setVerified(false);
      toast.success("Domain disimpan. Ikuti instruksi DNS di bawah.");
    } catch (e) {
      if (e.response?.status === 402) toast.error("Custom domain hanya di tier Bisnis. Upgrade dulu ya!");
      else toast.error(e.response?.data?.detail || "Gagal simpan domain");
    } finally { setSaving(false); }
  };

  const verify = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/shops/me/custom-domain/verify");
      setVerified(data.verified);
      if (data.verified) toast.success("DNS terverifikasi ✅");
      else toast.warning(data.message);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal verifikasi");
    } finally { setSaving(false); }
  };

  return (
    <div className="mt-6 bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="custom-domain-section">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-heading font-bold flex items-center gap-2">
            🌐 Custom Domain
            {!isBusiness && <span className="text-[10px] bg-purple-100 text-purple-900 rounded-full px-2 py-0.5 font-bold">BISNIS</span>}
          </h3>
          <p className="text-xs text-brand-mute mt-0.5">
            Pakai domain sendiri (mis. <b>tokokamu.com</b>) alih-alih <code className="bg-brand-off px-1 rounded">lapakin.my.id/toko/...</code>
          </p>
        </div>
      </div>
      {!isBusiness ? (
        <div className="rounded-xl border border-dashed border-brand-line p-4 text-center" data-testid="custom-domain-locked">
          <p className="text-sm text-brand-mute">
            Fitur custom domain tersedia di tier <b>Bisnis</b>.
          </p>
          <a href="/pricing" className="inline-block mt-2 text-brand font-bold hover:underline">Upgrade ke Bisnis →</a>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              placeholder="tokokamu.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="flex-1 rounded-xl border border-brand-line h-12 px-3 font-mono text-sm"
              data-testid="custom-domain-input"
            />
            <button onClick={request} disabled={saving || !domain}
              className="bg-brand text-white rounded-xl px-5 h-12 font-bold disabled:opacity-50"
              data-testid="custom-domain-save">
              Simpan
            </button>
          </div>
          {shop.custom_domain && (
            <div className="mt-3 flex items-center justify-between text-sm bg-brand-off border border-brand-line rounded-xl p-3">
              <span className="font-mono">{shop.custom_domain}</span>
              <span className={verified ? "text-green-700 font-bold" : "text-yellow-700 font-bold"}>
                {verified ? "✅ Verified" : "⏳ Pending DNS"}
              </span>
              <button onClick={verify} disabled={saving}
                className="text-brand font-bold text-xs hover:underline"
                data-testid="custom-domain-verify">
                Verifikasi DNS
              </button>
            </div>
          )}
          {dns && (
            <div className="mt-3 bg-brand-ink text-brand-off rounded-xl p-4 font-mono text-xs">
              <div className="text-[10px] uppercase tracking-wider text-brand-off/70 mb-2">Tambahkan DNS record ini di registrar domain kamu:</div>
              <div>Type: <b>{dns.type}</b></div>
              <div>Name: <b>{dns.name}</b> (atau <b>@</b> / <b>www</b>)</div>
              <div>Value: <b>{dns.value}</b></div>
              <div>TTL: {dns.ttl}</div>
              <p className="mt-2 text-brand-off/70 leading-relaxed">
                Propagasi DNS biasanya 5 menit – 24 jam. Setelah itu klik "Verifikasi DNS".
                Hubungi admin Lapakin via WhatsApp untuk setup SSL.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
