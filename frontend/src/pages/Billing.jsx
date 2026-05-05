import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Sparkles, Store, Zap, Rocket, Check, Loader2, ArrowRight, Upload, X, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const TIER_ICON = { free: Sparkles, starter: Store, pro: Zap, business: Rocket };
const TIER_COLOR = {
  free: "bg-brand-off text-brand-ink border-brand-line",
  starter: "bg-emerald-50 text-emerald-900 border-emerald-300",
  pro: "bg-yellow-50 text-yellow-900 border-yellow-300",
  business: "bg-purple-50 text-purple-900 border-purple-300",
};


const MANUAL_PAYMENT_STATUS = {
  pending_payment: {
    label: "Menunggu bukti bayar",
    cls: "bg-yellow-100 text-yellow-900 border-yellow-200",
  },
  pending_review: {
    label: "Menunggu verifikasi admin",
    cls: "bg-blue-100 text-blue-900 border-blue-200",
  },
  rejected: {
    label: "Bukti ditolak",
    cls: "bg-red-100 text-red-900 border-red-200",
  },
  success: {
    label: "Disetujui",
    cls: "bg-green-100 text-green-900 border-green-200",
  },
};

function formatRupiah(value) {
  return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function ManualPaymentPanel({ manualPayment, onClose, onUploadProof, uploading }) {
  if (!manualPayment?.payment) return null;

  const payment = manualPayment.payment;
  const config = manualPayment.config || {};
  const status = MANUAL_PAYMENT_STATUS[payment.status] || MANUAL_PAYMENT_STATUS.pending_payment;
  const qrisImage = config.qris_image || "";
  const copyText = [
    `Order ID: ${payment.order_id}`,
    `Paket: ${payment.plan_label || payment.plan_id}`,
    `Nominal: ${formatRupiah(payment.amount)}`,
    config.instruction || "Scan QRIS Lapakin lalu upload bukti pembayaran.",
  ].join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      toast.success("Instruksi pembayaran disalin");
    } catch {
      toast.error("Gagal menyalin instruksi");
    }
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onUploadProof(file);
    event.target.value = "";
  };

  return (
    <div
      className="mt-6 rounded-2xl border border-blue-200 bg-blue-50/70 p-5 text-blue-950 shadow-card"
      data-testid="manual-tier-payment-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-extrabold uppercase tracking-wide bg-white border-blue-200">
            QRIS Manual Lapakin
          </div>
          <h2 className="font-heading font-extrabold text-xl mt-3">
            Pembayaran Upgrade Tier
          </h2>
          <p className="text-sm mt-1 text-blue-900/80">
            Bayar paket via QRIS Lapakin, lalu upload bukti pembayaran untuk diverifikasi admin.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 hover:bg-white/70"
          aria-label="Tutup instruksi pembayaran"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid md:grid-cols-[220px,1fr] gap-4 mt-4">
        <div className="rounded-2xl border border-blue-200 bg-white p-3 text-center">
          {qrisImage ? (
            <img
              src={qrisImage}
              alt="QRIS Lapakin"
              className="w-full rounded-xl border border-brand-line object-contain"
              data-testid="manual-tier-qris-image"
            />
          ) : (
            <div className="aspect-square rounded-xl border border-dashed border-blue-300 grid place-items-center px-4 text-sm text-blue-900/70">
              QRIS Lapakin belum diset di server. Admin bisa kirim QRIS via WhatsApp sementara.
            </div>
          )}
          {config.admin_whatsapp ? (
            <a
              href={`https://wa.me/${config.admin_whatsapp}?text=${encodeURIComponent(`Halo Admin Lapakin, saya mau konfirmasi pembayaran ${payment.order_id}`)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex w-full justify-center rounded-xl bg-blue-900 px-3 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              Chat Admin
            </a>
          ) : null}
        </div>

        <div className="rounded-2xl border border-blue-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs text-brand-mute font-bold uppercase tracking-wide">Order ID</div>
              <div className="font-mono text-sm font-bold break-all" data-testid="manual-tier-payment-order-id">
                {payment.order_id}
              </div>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-extrabold ${status.cls}`} data-testid="manual-tier-payment-status">
              {status.label}
            </span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
            <div className="rounded-xl bg-brand-off/70 p-3">
              <div className="text-brand-mute">Paket</div>
              <div className="font-bold">{payment.plan_label || payment.plan_id}</div>
            </div>
            <div className="rounded-xl bg-brand-off/70 p-3">
              <div className="text-brand-mute">Nominal</div>
              <div className="font-bold">{formatRupiah(payment.amount)}</div>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm leading-relaxed">
            {config.instruction || "Scan QRIS Lapakin, bayar sesuai nominal paket, lalu upload bukti pembayaran di halaman ini."}
          </div>

          {payment.status === "rejected" && payment.admin_note ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="manual-tier-payment-rejected-note">
              <div className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Catatan admin</div>
              <div className="mt-1">{payment.admin_note}</div>
            </div>
          ) : null}

          {payment.status === "pending_review" ? (
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" data-testid="manual-tier-payment-review-note">
              <div className="font-bold flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Bukti sudah dikirim</div>
              <div className="mt-1">Admin Lapakin akan mengecek bukti pembayaran kamu.</div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              className="rounded-xl border-brand-line"
              data-testid="manual-tier-copy-instruction-btn"
            >
              <Copy className="w-4 h-4 mr-2" /> Salin Instruksi
            </Button>
            <label className="inline-flex cursor-pointer items-center rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:opacity-90">
              {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {uploading ? "Mengupload…" : payment.proof_filename ? "Upload Ulang Bukti" : "Upload Bukti Bayar"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
                disabled={uploading}
                data-testid="manual-tier-proof-input"
              />
            </label>
          </div>
          <div className="mt-2 text-xs text-brand-mute">
            Format gambar JPG/PNG/WebP, maksimal {config.max_proof_size_mb || 2}MB.
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualPaymentDisabledPanel({ config, notice, onDismiss }) {
  const message = notice?.message || config?.disabled_message || "Pembayaran upgrade tier sementara belum tersedia. QRIS Lapakin sedang dalam proses approval.";
  const adminWa = config?.admin_whatsapp || "";
  return (
    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-card" data-testid="manual-tier-payment-disabled-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-amber-900">
            Upgrade sedang disiapkan
          </div>
          <h2 className="mt-3 font-heading text-xl font-extrabold">Pembayaran upgrade belum aktif</h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/90">{message}</p>
          {notice?.plan_id ? <p className="mt-2 text-xs font-bold">Paket dipilih: {notice.plan_id}</p> : null}
        </div>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="rounded-full px-2 py-1 text-sm font-bold hover:bg-white/70">×</button>
        ) : null}
      </div>
      {adminWa ? (
        <a href={`https://wa.me/${adminWa}?text=${encodeURIComponent("Halo Admin Lapakin, saya mau tanya aktivasi paket upgrade.")}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white hover:opacity-90">
          Hubungi Admin Lapakin
        </a>
      ) : null}
    </div>
  );
}

function UsageBar({ label, used, limit }) {
  const isUnlimited = limit === "unlimited";
  const pct = isUnlimited ? 0 : (limit > 0 ? Math.min(100, (used / limit) * 100) : 0);
  const danger = !isUnlimited && pct >= 80;
  return (
    <div className="rounded-xl bg-white border border-brand-line p-4" data-testid={`usage-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className={`font-mono text-xs ${danger ? "text-red-700" : "text-brand-mute"}`}>
          {used}{isUnlimited ? "" : ` / ${limit}`}{isUnlimited && " (unlimited)"}
        </span>
      </div>
      {!isUnlimited && (
        <div className="mt-2 h-2 rounded-full bg-brand-off overflow-hidden">
          <div
            className={`h-full ${danger ? "bg-red-500" : "bg-brand"} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {isUnlimited && (
        <div className="mt-2 text-xs text-green-700 font-semibold">∞ Unlimited di tier ini</div>
      )}
    </div>
  );
}

export default function Billing() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [paying, setPaying] = useState(null);
  const [me, setMe] = useState(null);
  const [manualPayment, setManualPayment] = useState(null);
  const [manualConfig, setManualConfig] = useState(null);
  const [manualPaymentNotice, setManualPaymentNotice] = useState(null);
  const [proofUploading, setProofUploading] = useState(false);
  const navigate = useNavigate();

  const refresh = async () => {
    try {
      const r = await api.get("/billing/me");
      setData(r.data);
    } catch (err) {
      toast.error(
        err?.response?.data?.detail ||
          "Gagal memuat data billing. Coba login ulang."
      );
      setData(null);
      return;
    }

    try {
      const meRes = await api.get("/auth/me");
      setMe(meRes.data);
    } catch {
      setMe(null);
    }

    try {
      const h = await api.get("/payment/history");
      setHistory(h.data || []);
    } catch {
      /* ignore */
    }

    try {
      const manual = await api.get("/payment/manual/current");
      setManualConfig(manual.data?.config || null);
      setManualPayment(manual.data?.payment ? manual.data : null);
    } catch {
      setManualConfig(null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const handleUpgrade = async (plan_id) => {
    const currentTier = me?.tier || data?.tier || "free";
    const isProPlan = plan_id.startsWith("pro_");
    const canStartProTrial =
      isProPlan &&
      currentTier === "free" &&
      !me?.trial_used;

    if (canStartProTrial) {
      setPaying("pro_trial");

      try {
        await api.post("/payment/start-pro-trial");
        toast.success("Trial Pro aktif 10 hari. Selamat mencoba fitur Pro!");
        await refresh();
        setTimeout(() => navigate("/dashboard?trial=pro"), 500);
      } catch (err) {
        toast.error(
          err?.response?.data?.detail ||
            "Gagal memulai trial Pro. Coba lagi sebentar."
        );
      } finally {
        setPaying(null);
      }

      return;
    }

    if (manualConfig?.enabled === false) {
      const message = manualConfig?.disabled_message || "Pembayaran upgrade tier sementara belum tersedia. QRIS Lapakin sedang dalam proses approval.";
      setManualPaymentNotice({ plan_id, message });
      toast(message);
      return;
    }

    setPaying(plan_id);
    try {
      const res = await api.post("/payment/manual/request", { plan_id });
      setManualPayment(res.data);
      toast.success("Instruksi QRIS Lapakin sudah dibuat. Silakan upload bukti pembayaran.");
    } catch (err) {
      const detail = err?.response?.data?.detail || "Gagal membuat request pembayaran manual. Coba lagi sebentar.";
      if (err?.response?.status === 503) {
        setManualPaymentNotice({ plan_id, message: detail });
        toast(detail);
      } else {
        toast.error(detail);
      }
    } finally {
      setPaying(null);
    }
  };

  const handleUploadManualProof = async (file) => {
    if (!manualPayment?.payment?.order_id || !file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Ukuran bukti pembayaran maksimal 2MB.");
      return;
    }

    setProofUploading(true);
    try {
      const proofImage = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await api.post(`/payment/manual/${manualPayment.payment.order_id}/proof`, {
        proof_image: proofImage,
        proof_filename: file.name,
      });
      setManualPayment((prev) => ({
        ...(prev || {}),
        payment: res.data?.payment || prev?.payment,
      }));
      toast.success("Bukti pembayaran terkirim. Admin Lapakin akan memverifikasi.");
      await refresh();
    } catch (err) {
      toast.error(
        err?.response?.data?.detail ||
          "Gagal upload bukti pembayaran. Coba lagi."
      );
    } finally {
      setProofUploading(false);
    }
  };

  const getUpgradeButtonLabel = (plan_id) => {
    const currentTier = me?.tier || data?.tier || "free";
    const isProPlan = plan_id.startsWith("pro_");

    if (paying === "pro_trial" && isProPlan) {
      return (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Mengaktifkan Trial…
        </span>
      );
    }

    if (canUseTrialForPlan(plan_id)) {
      return "Mulai Trial Pro";
    }

    if (manualConfig?.enabled === false) {
      return "Belum tersedia";
    }

    if (isProPlan && currentTier === "pro" && me?.trial) {
      return "Aktivasi Pro Manual";
    }

    return "Bayar via QRIS";
  };

const canUseTrialForPlan = (plan_id) => {
  const currentTier = me?.tier || data?.tier || "free";
  return plan_id.startsWith("pro_") && currentTier === "free" && !me?.trial_used;
};

  if (loading) return (
    <DashboardLayout>
      <div className="text-brand-mute" data-testid="billing-loading">
        Memuat data tier…
      </div>
    </DashboardLayout>
  );

  if (!data) return (
    <DashboardLayout>
      <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
        <h1 className="font-heading font-extrabold text-2xl">
          Gagal memuat Akun & Tier
        </h1>
        <p className="text-brand-mute mt-2">
          Data billing belum berhasil dimuat. Coba refresh halaman atau login ulang.
        </p>
        <Button
          onClick={() => window.location.reload()}
          className="mt-4 bg-brand text-white font-bold rounded-xl"
        >
          Refresh
        </Button>
      </div>
    </DashboardLayout>
  );

  const Icon = TIER_ICON[data.tier] || Sparkles;

  return (
    <DashboardLayout>
      <div className="max-w-3xl">
        <h1 className="font-heading font-extrabold text-3xl">Akun & Tier</h1>
        <p className="text-brand-mute mt-1">
          Lihat tier kamu sekarang & penggunaan kuota bulan ini.
        </p>

        {me?.subscription_status === "suspended" && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900" data-testid="subscription-suspended-card">
            <div className="font-heading font-extrabold text-xl">Paket kamu sudah berakhir</div>
            <p className="text-sm mt-2 leading-relaxed">
              Akun toko sementara ditangguhkan. Data toko, produk, penjualan, cabang, dan anggota tim tetap aman.
              Hubungi admin Lapakin untuk aktivasi ulang.
            </p>
            {me?.subscription_suspended_at && (
              <p className="text-xs mt-2">
                Ditangguhkan sejak {new Date(me.subscription_suspended_at).toLocaleString("id-ID")}
              </p>
            )}
          </div>
        )}

        {(manualPaymentNotice || manualConfig?.enabled === false) && !manualPayment?.payment ? (
          <ManualPaymentDisabledPanel
            config={manualConfig}
            notice={manualPaymentNotice}
            onDismiss={() => setManualPaymentNotice(null)}
          />
        ) : null}

        <ManualPaymentPanel
          manualPayment={manualPayment}
          uploading={proofUploading}
          onUploadProof={handleUploadManualProof}
          onClose={() => setManualPayment(null)}
        />

        {/* Current tier card */}
        <div className={`mt-6 rounded-2xl border-2 p-6 ${TIER_COLOR[data.tier] || TIER_COLOR.free}`}
          data-testid="current-tier-card">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-white grid place-items-center shadow-md">
              <Icon className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider font-bold opacity-70">Tier Kamu Sekarang</div>
              <div className="font-heading font-extrabold text-3xl flex items-center gap-2">
                {data.tier_label}
                {data.trial && (
                  <span className="text-xs bg-yellow-400 text-yellow-900 rounded-full px-2 py-0.5 font-bold" data-testid="trial-badge">
                    TRIAL
                  </span>
                )}
              </div>
              {data.trial && data.trial_expires_at ? (
                <div className="text-sm mt-0.5" data-testid="trial-expires">
                  Trial gratis berakhir {new Date(data.trial_expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                </div>
              ) : data.trial_expired ? (
                <div className="text-sm mt-0.5 text-orange-800 font-semibold" data-testid="trial-expired">
	          Trial Pro sudah berakhir. Akun kembali ke paket Gratis.
                </div>
              ) : data.limits.price_idr_month > 0 ? (
                <div className="text-sm mt-0.5">Rp {data.limits.price_idr_month.toLocaleString("id-ID")}/bulan</div>
              ) : (
                <div className="text-sm mt-0.5">Gratis selamanya</div>
              )}

            </div>
            {data.tier !== "business" && (
              <Button
                onClick={() =>
                  data.tier === "free" && !me?.trial_used
                  ? handleUpgrade("pro_monthly")
                  : navigate("/pricing")
                }
                className="bg-brand text-white font-bold rounded-xl h-12 px-6"
                data-testid="upgrade-cta"
              >
                {data.tier === "free" && !me?.trial_used
                ? "Mulai Trial Pro"
                : "Upgrade →"}
              </Button>
            )}
          </div>
        </div>

        {data.trial_expired && (
          <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
            <div className="font-bold">Trial Pro sudah selesai</div>
            <p className="mt-1">
              Kamu masih bisa memakai fitur Gratis. Untuk membuka kembali fitur Pro, aktivasi paket bisa dilakukan via QRIS Lapakin dan upload bukti pembayaran.
            </p>
            <a
              href="#upgrade-tier"
              onClick={(e) => { e.preventDefault(); handleUpgrade("pro_monthly"); }}
              className="mt-3 inline-flex rounded-xl bg-orange-900 px-4 py-2 font-bold text-white hover:opacity-90"
            >
              Bayar Pro via QRIS
            </a>
          </div>
        )}

        {/* Usage bars */}
        <div className="mt-8">
          <h2 className="font-heading font-bold text-xl">Penggunaan bulan ini ({data.year_month})</h2>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <UsageBar label="Produk" used={data.products.used} limit={data.products.limit} />
            <UsageBar label="AI Photo Enhancer" used={data.usage.ai_photo.used} limit={data.usage.ai_photo.limit} />
            <UsageBar label="AI Copywriting" used={data.usage.ai_copy.used} limit={data.usage.ai_copy.limit} />
            <UsageBar label="AI Cover Toko" used={data.usage.ai_cover.used} limit={data.usage.ai_cover.limit} />
          </div>
        </div>

        {/* Feature highlights */}
        <div className="mt-8 bg-white rounded-2xl border border-brand-line p-6 shadow-card">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="font-heading font-bold text-xl">Fitur Aktif di Tier {data.tier_label}</h2>
            <Link
              to="/pricing#comparison"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline shrink-0"
              data-testid="compare-plans-link">
              Bandingkan Semua Paket <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              { key: "remove_branding", label: 'Tanpa "Powered by Lapakin"' },
              { key: "custom_subdomain", label: "Custom subdomain" },
              { key: "custom_domain", label: "Custom domain sendiri" },
              { key: "multi_shift_schedule", label: "Multi-shift schedule" },
              { key: "instagram_autopost", label: "Auto-post Instagram" },
              { key: "csv_export", label: "Export CSV/Excel" },
              { key: "api_access", label: "API access" },
              { key: "analytics", label: "Analytics storefront" },
              { key: "priority_support", label: "Priority support" },
            ].map((f) => {
              const enabled = data.limits[f.key];
              return (
                <div key={f.key} className={`flex items-center gap-2 text-sm ${enabled ? "" : "opacity-40"}`}>
                  <Check className={`w-4 h-4 ${enabled ? "text-green-600" : "text-brand-mute"}`} />
                  <span>{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div id="upgrade-tier" className="mt-8 bg-white rounded-2xl border border-brand-line p-6 shadow-card">
          <h2 className="font-heading font-bold text-xl">Upgrade Tier</h2>
          <p className="text-brand-mute text-sm mt-1">
            Pilih paket yang pas buat tokomu. Untuk sementara, pembayaran upgrade tier diproses manual via QRIS Lapakin dan verifikasi admin.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            {[
              {
                plan_id: "starter_monthly",
                label: "Starter — Bulanan",
                price: 19000,
                suffix: "/bulan",
                show: data.tier === "free",
              },
              {
                plan_id: "starter_yearly",
                label: "Starter — Tahunan 🎁",
                price: 190000,
                suffix: "/tahun (hemat 2 bln)",
                show: data.tier === "free",
              },
              {
                plan_id: "pro_monthly",
                label: "Pro — Bulanan",
                price: 49000,
                suffix: "/bulan",
                show: data.tier === "free" || data.tier === "starter" || (data.tier === "pro" && data.trial),
              },
              {
                plan_id: "pro_yearly",
                label: "Pro — Tahunan 🎁",
                price: 490000,
                suffix: "/tahun (hemat 2 bln)",
                show: data.tier === "free" || data.tier === "starter" || (data.tier === "pro" && data.trial),
              },
              {
                plan_id: "business_monthly",
                label: "Bisnis — Bulanan",
                price: 149000,
                suffix: "/bulan",
                show: data.tier !== "business",
              },
              {
                plan_id: "business_yearly",
                label: "Bisnis — Tahunan 🎁",
                price: 1490000,
                suffix: "/tahun (hemat 2 bln)",
                show: data.tier !== "business",
              },
             ].filter((p) => p.show).map((p) => (
              <div key={p.plan_id} className="rounded-xl border border-brand-line bg-brand-off/40 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">{p.label}</div>
                  <div className="text-sm text-brand-mute">Rp {p.price.toLocaleString("id-ID")}<span className="text-xs">{p.suffix}</span></div>
                </div>
                <Button
                  onClick={() => handleUpgrade(p.plan_id)}
                  disabled={paying === "pro_trial"}
                  className="bg-brand text-white font-bold rounded-xl h-11 px-5 shrink-0"
                  data-testid={`upgrade-btn-${p.plan_id}`}
                >
                  {getUpgradeButtonLabel(p.plan_id)}
                </Button>
              </div>
            ))}
          </div>
          <div className="text-xs text-brand-mute mt-3">
            Pembayaran online via gateway sedang disiapkan. Sementara ini aktivasi paket dilakukan via <b>QRIS Lapakin</b> + upload bukti pembayaran untuk diverifikasi admin.
          </div>
        </div>

        {history.length > 0 && (
          <div className="mt-8 bg-white rounded-2xl border border-brand-line p-6 shadow-card" data-testid="payment-history">
            <h2 className="font-heading font-bold text-xl mb-3">Riwayat Pembayaran</h2>
            <div className="divide-y divide-brand-line text-sm">
              {history.map((h) => {
                const statusColor = h.status === "success" ? "text-green-700 bg-green-100"
                  : h.status === "failed" || h.status === "rejected" ? "text-red-700 bg-red-100"
                  : h.status === "refunded" ? "text-orange-700 bg-orange-100"
                  : h.status === "pending_review" ? "text-blue-800 bg-blue-100"
                  : "text-yellow-800 bg-yellow-100";
                return (
                  <div key={h.order_id} className="py-3 flex items-center justify-between gap-3" data-testid={`payment-${h.order_id}`}>
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-brand-mute truncate">{h.order_id}</div>
                      <div className="font-semibold">
                        {h.plan_id} · Rp {(h.amount || 0).toLocaleString("id-ID")}
                      </div>
                      <div className="text-xs text-brand-mute">
                        {new Date(h.created_at).toLocaleString("id-ID")}
                        {h.payment_type ? ` · ${h.payment_type}` : ""}
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${statusColor}`}>
                      {h.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
