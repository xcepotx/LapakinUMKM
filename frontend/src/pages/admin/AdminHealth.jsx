import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { RefreshCw, Database, Bot, Tag, CircleCheck, CircleAlert } from "lucide-react";

export default function AdminHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get("/health");
      setData(r.data);
      setLastRefresh(new Date());
    } catch (e) {
      setError("Gagal menghubungi server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const isOk = data?.status === "ok";

  return (
    <AdminLayout
      title="Health Check"
      subtitle="Status real-time backend, database, dan LLM provider."
      actions={
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}
          data-testid="health-refresh-btn">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      {/* Overall status banner */}
      <div
        data-testid="health-status-banner"
        className={`flex items-center gap-3 rounded-2xl px-6 py-4 mb-6 border ${
          error
            ? "bg-red-50 border-red-200 text-red-700"
            : isOk
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-yellow-50 border-yellow-200 text-yellow-800"
        }`}
      >
        {error ? (
          <CircleAlert className="w-5 h-5 shrink-0" />
        ) : isOk ? (
          <CircleCheck className="w-5 h-5 shrink-0" />
        ) : (
          <CircleAlert className="w-5 h-5 shrink-0" />
        )}
        <div>
          <span className="font-heading font-bold text-base">
            {error ? "Tidak terhubung" : isOk ? "Semua sistem normal" : "Degraded"}
          </span>
          {lastRefresh && (
            <span className="ml-3 text-xs opacity-60">
              Terakhir dicek: {lastRefresh.toLocaleTimeString("id-ID")}
            </span>
          )}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={Database}
          label="MongoDB"
          value={data?.mongodb ?? "—"}
          ok={data?.mongodb === "connected"}
          tid="health-mongodb"
          loading={loading}
        />
        <MetricCard
          icon={Bot}
          label="LLM Provider"
          value={data?.llm_provider_active ?? "—"}
          ok={data?.llm_provider_active && data.llm_provider_active !== "none"}
          tid="health-llm"
          loading={loading}
        />
        <MetricCard
          icon={Tag}
          label="Versi"
          value={data?.version ?? "—"}
          ok={!!data?.version}
          neutral
          tid="health-version"
          loading={loading}
        />
        <MetricCard
          icon={CircleCheck}
          label="Status"
          value={data?.status ?? "—"}
          ok={isOk}
          tid="health-status"
          loading={loading}
        />
      </div>

      {/* Raw timestamp */}
      {data?.timestamp && (
        <p className="mt-6 text-xs text-brand-mute" data-testid="health-timestamp">
          Server time: {new Date(data.timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB
        </p>
      )}

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700"
          data-testid="health-error">
          {error}
        </div>
      )}
    </AdminLayout>
  );
}

function MetricCard({ icon: Icon, label, value, ok, neutral = false, tid, loading }) {
  const dot = neutral
    ? "bg-brand-mute/40"
    : ok
    ? "bg-green-500"
    : "bg-red-500";

  return (
    <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid={tid}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-[0.15em] text-brand-mute font-bold">{label}</div>
        <Icon className="w-4 h-4 text-brand-mute" />
      </div>
      {loading && !value ? (
        <div className="h-7 w-20 bg-brand-line animate-pulse rounded-lg" />
      ) : (
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
          <span className="font-heading font-extrabold text-xl capitalize">{value}</span>
        </div>
      )}
    </div>
  );
}
