import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

export default function AdminTopStoresVisitsCard() {
  const [rows, setRows] = useState([]);
  const [source, setSource] = useState("");
  const [totalVisits, setTotalVisits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/admin/analytics/top-stores", { params: { limit: 8 } });
        if (!alive) return;
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setSource(data?.source_collection || "");
        setTotalVisits(Number(data?.total_visits || 0));
      } catch (err) {
        if (!alive) return;
        setRows([]);
        setSource("");
        setTotalVisits(0);
        setError(err?.response?.data?.detail || err?.message || "Gagal memuat statistik kunjungan toko.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const maxVisits = useMemo(
    () => rows.reduce((max, item) => Math.max(max, Number(item?.visits || 0)), 0),
    [rows]
  );

  return (
    <div
      className="rounded-3xl border border-brand-line bg-white p-5 shadow-sm"
      data-testid="admin-top-stores-visits-card"
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-brand-ink">Toko Paling Banyak Dikunjungi</h3>
          <p className="text-sm text-brand-mute">Grafik toko dengan kunjungan storefront tertinggi.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-brand-off px-3 py-1 text-brand-ink">
            Total {totalVisits.toLocaleString("id-ID")} kunjungan
          </span>
          {source ? (
            <span className="rounded-full bg-brand-off px-3 py-1 text-brand-mute">Source: {source}</span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">
          Memuat statistik kunjungan toko...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-brand-off/60 px-4 py-8 text-sm text-brand-mute">
          Belum ada data kunjungan toko yang bisa diringkas.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((item, index) => {
            const visits = Number(item?.visits || 0);
            const width = maxVisits > 0 ? `${Math.max(8, Math.round((visits / maxVisits) * 100))}%` : "8%";
            return (
              <div key={item?.shop_id || item?.slug || index} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-extrabold text-brand-ink">
                      {index + 1}. {item?.shop_name || item?.slug || item?.shop_id || "Toko tanpa nama"}
                    </div>
                    <div className="truncate text-xs text-brand-mute">
                      {item?.slug ? `/${item.slug}` : item?.shop_id || "-"}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full bg-brand-off px-3 py-1 text-xs font-extrabold text-brand-ink">
                    {visits.toLocaleString("id-ID")} kunjungan
                  </div>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-brand-off/80">
                  <div className="h-full rounded-full bg-brand transition-all" style={{ width }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
