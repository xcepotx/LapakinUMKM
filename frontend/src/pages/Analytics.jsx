import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  // LAPAKIN_ANALYTICS_CHART_TYPE_SELECTOR_V2
  const [dailyChartType, setDailyChartType] = useState("bar");
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

  // LAPAKIN_ANALYTICS_CHART_TYPE_SELECTOR_V2
  const maxDaily = Math.max(1, ...data.daily.map((d) => Number(d.visits || 0)));
  const dailyTotal = data.daily.reduce((sum, d) => sum + Number(d.visits || 0), 0);
  const dailyChartPoints = data.daily.map((d, index, arr) => {
    const visits = Number(d.visits || 0);
    const x = arr.length <= 1 ? 50 : 6 + (index / (arr.length - 1)) * 88;
    const y = 92 - (visits / maxDaily) * 80;

    return {
      ...d,
      visits,
      x,
      y,
    };
  });
  const dailyChartPolyline = dailyChartPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const dailyChartAreaPath = dailyChartPoints.length
    ? `M ${dailyChartPoints[0].x},100 L ${dailyChartPoints.map((p) => `${p.x},${p.y}`).join(" L ")} L ${dailyChartPoints[dailyChartPoints.length - 1].x},100 Z`
    : "";

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
        <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-heading font-bold text-xl">Pengunjung Harian</h2>
            <p className="mt-1 text-xs text-brand-mute">
              Pilih bentuk grafik yang paling enak dibaca untuk melihat tren kunjungan toko.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDailyChartType("bar")}
                className={`rounded-full border px-4 py-2 text-xs font-black transition ${
                  dailyChartType === "bar"
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-brand-line bg-white text-brand-mute hover:border-brand/40 hover:text-brand-ink"
                }`}
                data-testid="daily-chart-type-bar"
              >
                Bar
              </button>
              <button
                type="button"
                onClick={() => setDailyChartType("line")}
                className={`rounded-full border px-4 py-2 text-xs font-black transition ${
                  dailyChartType === "line"
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-brand-line bg-white text-brand-mute hover:border-brand/40 hover:text-brand-ink"
                }`}
                data-testid="daily-chart-type-line"
              >
                Line
              </button>
              <button
                type="button"
                onClick={() => setDailyChartType("area")}
                className={`rounded-full border px-4 py-2 text-xs font-black transition ${
                  dailyChartType === "area"
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-brand-line bg-white text-brand-mute hover:border-brand/40 hover:text-brand-ink"
                }`}
                data-testid="daily-chart-type-area"
              >
                Area
              </button>
          </div>
        </div>

        {data.daily.length === 0 ? (
          <p className="text-brand-mute text-sm text-center py-8">Belum ada kunjungan. Bagikan link tokomu ke WhatsApp!</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="rounded-full bg-brand-off px-3 py-1 text-xs font-bold text-brand-mute">
                Total harian: <span className="text-brand-ink">{dailyTotal}</span>
              </div>

              <div className="rounded-full bg-brand-off px-3 py-1 text-xs font-bold text-brand-mute">
                Tertinggi: <span className="text-brand-ink">{maxDaily}</span> kunjungan
              </div>
            </div>

            {dailyTotal === 0 && Number(data.total_visits || 0) > 0 ? (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                Total kunjungan sudah ada, tapi rincian harian belum terbaca. Kunjungan baru setelah visitor tracking aktif akan mulai mengisi grafik harian.
              </div>
            ) : null}

            {dailyChartType === "bar" ? (
              <div className="h-56 rounded-2xl border border-brand-line bg-brand-off/40 px-4 pb-3 pt-8">
                <div className="flex h-full items-stretch gap-2">
                  {data.daily.map((d) => {
                    const visits = Number(d.visits || 0);
                    const percent = maxDaily > 0 ? (visits / maxDaily) * 100 : 0;
                    const barHeight = visits > 0 ? Math.max(10, percent) : 0;

                    return (
                      <div
                        key={d.date}
                        className="flex min-w-0 flex-1 flex-col items-center gap-2"
                        title={`${d.date}: ${visits} kunjungan`}
                      >
                        <div className="relative flex min-h-0 w-full flex-1 items-end justify-center border-b border-brand-line/70">
                          {visits > 0 ? (
                            <span className="absolute -top-6 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-brand-ink shadow-sm">
                              {visits}
                            </span>
                          ) : null}

                          <div
                            className={`w-full max-w-[58px] rounded-t-xl transition-all ${
                              visits > 0 ? "bg-brand hover:bg-brand-ink" : "bg-brand-line/80"
                            }`}
                            style={{
                              height: visits > 0 ? `${barHeight}%` : "4px",
                            }}
                          />
                        </div>

                        <span className="text-[10px] text-brand-mute truncate w-full text-center">
                          {d.date.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="relative h-56 rounded-2xl border border-brand-line bg-brand-off/40 px-4 pb-8 pt-8">
                <div className="absolute left-4 right-4 top-8 bottom-8">
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="h-full w-full overflow-visible"
                    role="img"
                    aria-label={`Grafik ${dailyChartType} pengunjung harian`}
                  >
                    {[20, 40, 60, 80].map((y) => (
                      <line
                        key={y}
                        x1="0"
                        x2="100"
                        y1={y}
                        y2={y}
                        stroke="currentColor"
                        strokeWidth="0.5"
                        className="text-brand-line"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}

                    {dailyChartType === "area" ? (
                      <path
                        d={dailyChartAreaPath}
                        fill="currentColor"
                        className="text-brand/15"
                      />
                    ) : null}

                    <polyline
                      points={dailyChartPolyline}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-brand"
                      vectorEffect="non-scaling-stroke"
                    />

                    {dailyChartPoints.map((point) => (
                      <circle
                        key={point.date}
                        cx={point.x}
                        cy={point.y}
                        r="2.5"
                        fill="currentColor"
                        className="text-brand"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>

                  {dailyChartPoints.map((point) =>
                    point.visits > 0 ? (
                      <span
                        key={`${point.date}-label`}
                        className="absolute rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-brand-ink shadow-sm"
                        style={{
                          left: `${point.x}%`,
                          top: `${point.y}%`,
                          transform: "translate(-50%, -135%)",
                        }}
                      >
                        {point.visits}
                      </span>
                    ) : null
                  )}
                </div>

                <div
                  className="absolute inset-x-4 bottom-2 grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${data.daily.length}, minmax(0, 1fr))` }}
                >
                  {data.daily.map((d) => (
                    <span key={d.date} className="truncate text-center text-[10px] text-brand-mute">
                      {d.date.slice(5)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 text-xs text-brand-mute">
              Mode aktif: <b className="text-brand-ink capitalize">{dailyChartType}</b>.
            </div>
          </>
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
    navigate("/dashboard?trial=pro");
  } catch (err) {
    alert(
      err?.response?.data?.detail ||
        "Gagal memulai trial Pro. Coba lagi sebentar."
    );
  }
}
