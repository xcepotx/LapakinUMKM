import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { rupiah } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { TrendingUp, Eye, MessageCircle, Share2, Lock, BarChart3 } from "lucide-react";

const RANGE_OPTIONS = [
  { days: 7, label: "7 hari" },
  { days: 30, label: "30 hari" },
  { days: 90, label: "90 hari" },
];

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [locked, setLocked] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    setLoading(true);
    setLocked(false);
    api.get("/analytics/shop", { params: { days } })
      .then((r) => setData(r.data))
      .catch((e) => {
        if (e?.response?.status === 402) setLocked(true);
      })
      .finally(() => setLoading(false));
  }, [days]);

  if (locked) {
    const canStartTrial = !user?.trial_used;

    return (
      <DashboardLayout
        title="Analitik"
        subtitle="Pantau performa toko dan interaksi pelanggan."
      >
        <div
          className="max-w-xl mx-auto mt-10 bg-white border border-brand-line rounded-2xl p-10 text-center shadow-card"
          data-testid="analytics-locked"
        >
          <Lock className="w-12 h-12 mx-auto text-brand-mute" />

          <div className="mt-4 inline-flex rounded-full bg-brand-off px-3 py-1 text-xs font-bold text-brand">
            Fitur Pro
          </div>

          <h1 className="font-heading font-extrabold text-2xl mt-4">
            Analitik tersedia di Pro
          </h1>

          <p className="text-brand-mute mt-2">
            Pantau pengunjung storefront, klik pesanan, konversi, dan produk paling dilihat.
            Tersedia di tier <b>Pro</b> dan <b>Bisnis</b>.
          </p>

          {canStartTrial ? (
            <>
              <div className="mt-6 rounded-2xl bg-brand-sand p-4 text-sm text-brand-ink">
                Coba Pro gratis selama <b>10 hari</b>. Tidak perlu pembayaran dulu.
              </div>

              <Button
                onClick={startProTrial}
                className="mt-6 bg-brand text-white font-bold rounded-xl h-12 px-8"
                data-testid="analytics-start-trial"
              >
                Mulai Trial Pro 10 Hari
              </Button>
            </>
          ) : (
            <>
              <div className="mt-6 rounded-2xl bg-brand-sand p-4 text-sm text-brand-ink">
                Trial Pro kamu sudah pernah digunakan. Untuk membuka Analitik lagi,
                lanjutkan ke paket Pro.
              </div>

              <Link to="/dashboard/billing">
                <Button
                  className="mt-6 bg-brand text-white font-bold rounded-xl h-12 px-8"
                  data-testid="analytics-upgrade"
                >
                  Lihat Paket Pro
                </Button>
              </Link>
            </>
          )}
        </div>
      </DashboardLayout>
    );
  }

  if (loading || !data) return (
    <DashboardLayout>
      <div className="text-brand-mute" data-testid="analytics-loading">Memuat analitik…</div>
    </DashboardLayout>
  );

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.visits));

  return (
    <DashboardLayout>
      {user?.trial && user?.trial_expires_at && (
        <div className="mb-5 rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          Trial Pro aktif sampai{" "}
          <b>{formatTrialDate(user.trial_expires_at)}</b>.
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-heading font-extrabold text-3xl flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-brand" /> Analitik Toko
          </h1>
          <p className="text-brand-mute mt-1">Pantau pengunjung & interaksi di storefront kamu.</p>
        </div>
        <div className="inline-flex bg-white border border-brand-line rounded-xl p-1">
          {RANGE_OPTIONS.map((o) => (
            <button key={o.days} onClick={() => setDays(o.days)}
              className={`px-4 py-2 text-sm font-bold rounded-lg ${days === o.days ? "bg-brand text-white" : "text-brand-mute hover:text-brand-ink"}`}
              data-testid={`range-${o.days}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid sm:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Eye className="w-5 h-5" />} label="Kunjungan" value={data.total_visits} tid="stat-visits" />
        <StatCard icon={<MessageCircle className="w-5 h-5" />} label="Klik Pesan" value={data.events.click_order || 0} tid="stat-clicks" />
        <StatCard icon={<Share2 className="w-5 h-5" />} label="Share WA" value={data.events.share_wa || 0} tid="stat-shares" />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Konversi" value={`${data.conversion_rate_percent}%`} tid="stat-conv" />
      </div>

      {/* Daily chart */}
      <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card mb-6" data-testid="daily-chart">
        <h2 className="font-heading font-bold text-xl mb-4">Pengunjung Harian</h2>
        {data.daily.length === 0 ? (
          <p className="text-brand-mute text-sm text-center py-8">Belum ada kunjungan. Bagikan link tokomu ke WhatsApp!</p>
        ) : (
          <div className="flex items-end gap-1 h-40 border-b border-brand-line pb-2">
            {data.daily.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.date}: ${d.visits} visits`}>
                <div className="w-full bg-brand rounded-t-md transition-all hover:bg-brand-ink"
                  style={{ height: `${(d.visits / maxDaily) * 100}%`, minHeight: "4px" }} />
                <span className="text-[10px] text-brand-mute truncate w-full text-center">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top products */}
      <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card" data-testid="top-products">
        <h2 className="font-heading font-bold text-xl mb-4">Produk Paling Sering Dilihat</h2>
        {data.top_products.length === 0 ? (
          <p className="text-brand-mute text-sm">Belum ada interaksi produk.</p>
        ) : (
          <ol className="space-y-2">
            {data.top_products.map((p, i) => (
              <li key={p.product_id} className="flex items-center gap-3 py-2 border-b border-brand-line last:border-0">
                <span className="w-8 h-8 rounded-full bg-brand-off grid place-items-center font-bold text-brand">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{p.name}</div>
                  <div className="text-xs text-brand-mute">{rupiah(p.price || 0)}</div>
                </div>
                <span className="text-sm font-bold text-brand">{p.interactions} interaksi</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatCard({ icon, label, value, tid }) {
  return (
    <div className="bg-white border border-brand-line rounded-2xl p-4 shadow-card" data-testid={tid}>
      <div className="flex items-center gap-2 text-brand-mute text-sm">
        <span className="text-brand">{icon}</span>
        {label}
      </div>
      <div className="font-heading font-extrabold text-3xl mt-2">{value}</div>
    </div>
  );
}

function formatTrialDate(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
  }).format(new Date(value));
}

async function startProTrial() {
  try {
    await api.post("/payment/start-pro-trial");
    window.location.reload();
  } catch (err) {
    alert(
      err?.response?.data?.detail ||
        "Gagal memulai trial Pro. Coba lagi sebentar."
    );
  }
}
