import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { QRCodeCanvas } from "qrcode.react";
import { Download, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function ShopQR() {
  const navigate = useNavigate();
  const [shop, setShop] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/shops/me");
      if (!data) { navigate("/onboarding"); return; }
      setShop(data);
    })();
  }, [navigate]);

  if (!shop) return <DashboardLayout title="QR Lapak Saya"><div className="text-brand-mute">Memuat…</div></DashboardLayout>;

  const url = `${window.location.origin}/toko/${shop.slug}`;
  const brand = shop.brand_color || "#C04A3B";

  const downloadPNG = () => {
    const canvas = wrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${shop.slug}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    toast.success("QR diunduh");
  };

  const print = () => window.print();

  return (
    <DashboardLayout shop={shop} title="QR Lapak Saya"
      subtitle="Cetak & tempel di kios atau bagikan di sosmed. Pelanggan tinggal scan, langsung ke tokomu.">
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Printable Card */}
        <div className="lg:col-span-1">
          <div ref={wrapRef} className="qr-print-card bg-white rounded-3xl shadow-cardHover overflow-hidden border border-brand-line"
            style={{ borderTop: `12px solid ${brand}` }}
            data-testid="qr-card">
            <div className="p-8 text-center">
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="w-9 h-9 rounded-xl grid place-items-center text-white" style={{ background: brand }}>
                  <Sparkles className="w-4 h-4" />
                </span>
                <span className="font-heading font-extrabold text-lg">Lapakin</span>
              </div>
              <div className="text-xs uppercase tracking-[0.2em] font-bold text-brand-mute">Scan untuk pesan</div>
              <h2 className="font-heading font-extrabold text-3xl mt-2" style={{ color: brand }}>{shop.name}</h2>
              {shop.tagline && <p className="text-sm text-brand-mute mt-1 max-w-xs mx-auto">{shop.tagline}</p>}
              <div className="mt-6 inline-block p-4 bg-white rounded-2xl border-4" style={{ borderColor: brand }}>
                <QRCodeCanvas
                  value={url}
                  size={260}
                  level="H"
                  includeMargin={false}
                  fgColor={brand}
                  bgColor="#FFFFFF"
                />
              </div>
              <div className="mt-4 font-mono text-xs text-brand-mute break-all">{url}</div>
              <div className="mt-6 pt-5 border-t border-brand-line text-xs text-brand-mute">
                Powered by <span className="font-bold text-brand-ink">Lapakin</span> · AI bikin tokomu cling
              </div>
            </div>
          </div>
        </div>

        {/* Actions / Info */}
        <div className="space-y-5 no-print">
          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <h3 className="font-heading font-bold text-lg">Aksi</h3>
            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <Button onClick={downloadPNG}
                className="bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
                data-testid="qr-download-btn">
                <Download className="w-4 h-4 mr-2" /> Download QR PNG
              </Button>
              <Button onClick={print} variant="outline"
                className="rounded-xl h-12 border-brand-line"
                data-testid="qr-print-btn">
                <Printer className="w-4 h-4 mr-2" /> Print Kartu
              </Button>
            </div>
          </div>

          <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
            <h3 className="font-heading font-bold">Cara Pakai</h3>
            <ul className="mt-3 space-y-2 text-sm text-brand-ink">
              <li>📌 <b>Tempel di kios fisik</b> — pelanggan scan, lihat katalog, langsung pesan via WA</li>
              <li>📱 <b>Share di sosmed</b> — download PNG, posting di IG Story / TikTok bio</li>
              <li>🖨️ <b>Cetak stiker</b> — print, tempel di kemasan paket/struk biar repeat order</li>
              <li>🎫 <b>Print kartu nama</b> — pakai sebagai kartu nama digital</li>
            </ul>
          </div>

          <div className="bg-brand text-white rounded-2xl p-6 shadow-card relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-brand-accent/40 blur-2xl" />
            <h3 className="font-heading font-bold text-lg relative">💡 Tips Pro</h3>
            <p className="mt-2 text-white/90 text-sm relative">
              Tambah jam buka & alamat di Pengaturan Toko biar QR scanner langsung dapet info lengkap.
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          .no-print, header, nav, [data-testid="dashboard-logout-btn"], [data-testid="goto-admin-link"] { display: none !important; }
          .qr-print-card { break-inside: avoid; box-shadow: none !important; }
          main { padding: 0 !important; max-width: none !important; }
        }
      `}</style>
    </DashboardLayout>
  );
}
