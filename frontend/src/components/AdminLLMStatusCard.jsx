import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Cpu, CheckCircle2, AlertTriangle, RefreshCcw, Loader2 } from "lucide-react";

/**
 * AdminLLMStatusCard — shows active LLM provider, chain, 30-day usage, recent fallbacks.
 * Rendered on /admin dashboard.
 */
export default function AdminLLMStatusCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/admin/llm/status");
      setData(r.data);
    } catch (_e) {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="admin-llm-loading">
        <div className="flex items-center gap-2 text-brand-mute text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Mengecek status AI provider…
        </div>
      </div>
    );
  }
  if (!data) return null;

  const healthy = data.ok && data.count > 0;
  const hasFallback = (data.recent_fallbacks || []).length > 0;

  return (
    <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="admin-llm-status-card">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
            healthy ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}>
            <Cpu className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-heading font-bold text-lg">AI Provider Status</h3>
            <p className="text-xs text-brand-mute mt-0.5">
              Chain fallback otomatis. Set 2 key untuk resilience maksimal.
            </p>
          </div>
        </div>
        <button onClick={() => { setRefreshing(true); load(); }}
          disabled={refreshing}
          className="text-xs font-semibold text-brand-mute hover:text-brand-ink inline-flex items-center gap-1 disabled:opacity-50"
          data-testid="admin-llm-refresh">
          {refreshing
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCcw className="w-3.5 h-3.5" />} Refresh
        </button>
      </div>

      {!healthy ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2" data-testid="admin-llm-no-key">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs text-red-900">
            <div className="font-bold">Belum ada API key LLM</div>
            <p className="mt-0.5">
              Set <code className="bg-white px-1 rounded border border-red-200">GEMINI_API_KEY</code> di <code className="bg-white px-1 rounded border border-red-200">backend/.env</code> lalu restart backend.
              AI features (Tips Hari Ini, Cerita UMKM, AI Studio caption) sekarang off.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Active + Chain */}
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <div className="bg-brand-off border border-brand-line rounded-xl p-3" data-testid="admin-llm-active">
              <div className="text-[10px] uppercase tracking-widest font-bold text-brand-mute">Aktif</div>
              <div className="flex items-center gap-2 mt-1">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="font-heading font-extrabold text-lg capitalize">{data.active}</span>
              </div>
            </div>
            <div className="bg-brand-off border border-brand-line rounded-xl p-3" data-testid="admin-llm-chain">
              <div className="text-[10px] uppercase tracking-widest font-bold text-brand-mute">Chain (Priority)</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {data.chain.map((p, i) => (
                  <span key={p} className="inline-flex items-center gap-1">
                    <span className={`text-xs font-bold rounded-full px-2 py-0.5 border ${
                      i === 0 ? "bg-green-100 border-green-300 text-green-900" : "bg-white border-brand-line text-brand-ink"
                    }`}>
                      {i + 1}. {p}
                    </span>
                    {i < data.chain.length - 1 && <span className="text-brand-mute text-xs">→</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 30-day usage */}
          {Object.keys(data.usage_30d || {}).length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-widest font-bold text-brand-mute mb-2">
                Usage 30 Hari Terakhir
              </div>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(data.usage_30d).map(([p, count]) => (
                  <div key={p} className="bg-white border border-brand-line rounded-lg px-3 py-1.5 text-xs" data-testid={`admin-llm-usage-${p}`}>
                    <span className="font-bold capitalize">{p}</span>
                    <span className="text-brand-mute ml-1">· {count} calls</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent fallbacks */}
          {hasFallback && (
            <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-3" data-testid="admin-llm-fallbacks">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertTriangle className="w-4 h-4 text-yellow-700" />
                <span className="text-xs font-bold text-yellow-900">
                  {data.recent_fallbacks.length} fallback event(s) minggu ini
                </span>
              </div>
              <div className="space-y-0.5 mt-1">
                {data.recent_fallbacks.slice(0, 3).map((e, i) => (
                  <div key={i} className="text-[11px] text-yellow-900/80 font-mono">
                    {new Date(e.at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {" — "}{e.detail || e.provider}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-yellow-900/80 mt-2">
                💡 Pertimbangkan tambah balance provider utama atau ganti ke paid tier kalau sering kena.
              </p>
            </div>
          )}

          {!hasFallback && (
            <div className="text-xs text-brand-mute flex items-center gap-1.5" data-testid="admin-llm-no-fallbacks">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
              Tidak ada fallback event minggu ini. Provider utama sehat.
            </div>
          )}
        </>
      )}
    </div>
  );
}
