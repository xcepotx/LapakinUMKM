import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useNavigate } from "react-router-dom";
import { Smartphone, CheckCircle2, RefreshCw, Unlink, Copy } from "lucide-react";
import { toast } from "sonner";

export default function WhatsAppConnect() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const [status, setStatus] = useState(null); // {linked, phone, twilio_configured}
  const [code, setCode] = useState(null);
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const refresh = async () => {
    const [s, st] = await Promise.all([api.get("/shops/me"), api.get("/whatsapp/status")]);
    if (!s.data) { navigate("/onboarding"); return; }
    setShop(s.data);
    setStatus(st.data);
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const generateCode = async () => {
    setGenerating(true);
    try {
      const { data } = await api.post("/whatsapp/connect/start");
      setCode(data.code);
      setInstructions(data.instructions || "");
      toast.success("Kode pairing dibuat");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal generate kode");
    } finally { setGenerating(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Lepas WhatsApp dari Lapakin?")) return;
    try {
      await api.post("/whatsapp/disconnect");
      toast.success("WhatsApp dilepas");
      refresh();
    } catch (e) {
      toast.error("Gagal lepas WhatsApp");
    }
  };

  const copy = (txt) => { navigator.clipboard.writeText(txt); toast.success("Tersalin"); };

  return (
    <DashboardLayout shop={shop} title="WhatsApp Bot" subtitle="Kelola tokomu langsung dari WhatsApp.">
      {loading ? <div className="text-brand-mute" data-testid="wa-loading">Memuat…</div> : (
        <div className="grid lg:grid-cols-2 gap-6 max-w-5xl">
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <Smartphone className="w-7 h-7 text-brand" />
            <h2 className="font-heading font-bold text-xl mt-3">Cara Kerja</h2>
            <ol className="mt-4 space-y-3 text-sm text-brand-ink">
              <li><span className="font-bold text-brand">1.</span> Klik "Buat Kode Pairing" di samping</li>
              <li><span className="font-bold text-brand">2.</span> Buka WhatsApp di HP-mu</li>
              <li><span className="font-bold text-brand">3.</span> Kirim ke nomor bot Lapakin: <span className="font-mono bg-brand-off rounded px-1.5 py-0.5">lapakin {`<kode>`}</span></li>
              <li><span className="font-bold text-brand">4.</span> Setelah terhubung, kirim foto + nama + harga, contoh: <span className="font-mono bg-brand-off rounded px-1.5 py-0.5">Kopi Susu Aren 25000 stok 20</span></li>
              <li><span className="font-bold text-brand">5.</span> Produk otomatis tayang di tokomu! 🎉</li>
            </ol>
            <div className="mt-5 bg-brand-off rounded-xl p-3 border border-brand-line text-xs text-brand-mute">
              <strong>Perintah lain:</strong><br />
              • <code>list</code> — lihat 5 produk terakhir<br />
              • <code>help</code> — lihat panduan<br />
              • <code>unlink</code> — lepas WhatsApp
            </div>
          </div>

          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            {!status?.twilio_configured && (
              <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900" data-testid="twilio-not-configured">
                <strong>⚠️ Twilio belum dikonfigurasi.</strong><br />
                Set <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, dan <code>TWILIO_WHATSAPP_FROM</code> di backend <code>.env</code>, lalu daftarkan webhook URL di Twilio Console:<br />
                <code className="block mt-1 break-all">{`${window.location.origin.replace('https://', 'https://').replace(/\/$/, '')}/api/whatsapp/webhook`}</code>
                <br />Setelah itu, fitur ini siap dipakai.
              </div>
            )}

            {status?.linked ? (
              <div data-testid="wa-linked-state">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-bold">WhatsApp Terhubung</span>
                </div>
                <p className="text-sm text-brand-mute mt-2">Nomor: <span className="font-mono">{status.phone}</span></p>
                <p className="text-sm text-brand-mute">Sejak: {status.linked_at ? new Date(status.linked_at).toLocaleString("id-ID") : "-"}</p>
                <Button onClick={disconnect} variant="outline" className="mt-5 rounded-xl border-red-200 text-red-700 hover:bg-red-50"
                  data-testid="wa-disconnect-btn">
                  <Unlink className="w-4 h-4 mr-2" /> Lepas WhatsApp
                </Button>
              </div>
            ) : (
              <div>
                <h3 className="font-heading font-bold text-lg">Hubungkan WhatsApp</h3>
                <p className="text-sm text-brand-mute mt-1">Buat kode pairing 6 digit, lalu kirim via WhatsApp.</p>
                {code ? (
                  <div className="mt-5">
                    <div className="text-xs uppercase tracking-[0.15em] font-bold text-brand mb-2">Kode pairing (15 menit)</div>
                    <div className="flex items-center gap-3">
                      <div className="font-heading font-extrabold text-4xl tracking-widest bg-brand-off rounded-xl px-6 py-4 border border-brand-line"
                        data-testid="wa-pair-code">
                        {code}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => copy(code)}>
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    {instructions && (
                      <p className="mt-4 text-sm text-brand-ink leading-relaxed bg-brand-off/50 border border-brand-line rounded-xl p-3">
                        {instructions}
                      </p>
                    )}
                    <Button onClick={refresh} variant="outline"
                      className="mt-4 rounded-xl w-full border-brand-line"
                      data-testid="wa-check-status-btn">
                      <RefreshCw className="w-4 h-4 mr-2" /> Cek Status
                    </Button>
                  </div>
                ) : (
                  <Button onClick={generateCode} disabled={generating}
                    className="mt-5 w-full bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
                    data-testid="wa-generate-code-btn">
                    {generating ? "Membuat kode…" : "Buat Kode Pairing"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
