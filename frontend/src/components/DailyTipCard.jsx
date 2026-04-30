import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import { RefreshCcw, X, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * DailyTipCard — daily personalized motivation/action nudge.
 * Calls GET /tips/today (rule-based or AI-generated). User can dismiss or refresh (max 3x/day).
 */
export default function DailyTipCard() {
  const [tip, setTip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/tips/today");
      setTip(r.data);
    } catch (_e) {
      setTip(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const dismiss = async () => {
    try {
      await api.post("/tips/today/dismiss");
      setTip(null);
    } catch (_e) {
      // silent
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.post("/tips/today/refresh");
      setTip(r.data);
      toast.success("Tip baru dari AI 🧠");
    } catch (e) {
      const msg = e.response?.data?.detail || "Gagal refresh tip";
      toast.error(msg);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="daily-tip-loading">
        <div className="flex items-center gap-2 text-brand-mute text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Memuat tip hari ini…
        </div>
      </div>
    );
  }
  if (!tip || tip.dismissed_at) return null;

  const isAi = tip.source && tip.source.startsWith("ai");

  return (
    <div
      className="relative bg-gradient-to-br from-brand to-brand-dark text-white rounded-2xl p-5 shadow-cardHover overflow-hidden"
      data-testid="daily-tip-card">
      {/* Decorative blob */}
      <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-white/10 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-16 -left-12 w-48 h-48 rounded-full bg-yellow-200/15 blur-3xl pointer-events-none" />

      <div className="relative">
        {/* Header bar */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold bg-white/20 rounded-full px-2 py-0.5 backdrop-blur-sm">
              <Sparkles className="w-3 h-3 inline mr-1" /> Tip Hari Ini
            </span>
            {isAi && (
              <span className="text-[10px] uppercase tracking-widest font-bold bg-yellow-300/90 text-brand-dark rounded-full px-2 py-0.5"
                data-testid="daily-tip-ai-badge">
                AI
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              disabled={refreshing}
              className="w-8 h-8 rounded-full hover:bg-white/15 grid place-items-center disabled:opacity-50"
              title="Generate tip baru (AI)"
              data-testid="daily-tip-refresh">
              {refreshing
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCcw className="w-4 h-4" />}
            </button>
            <button
              onClick={dismiss}
              className="w-8 h-8 rounded-full hover:bg-white/15 grid place-items-center"
              title="Tutup hari ini"
              data-testid="daily-tip-dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex items-start gap-3">
          <div className="text-3xl shrink-0 leading-none mt-0.5" data-testid="daily-tip-emoji">
            {tip.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-heading font-extrabold text-lg leading-tight" data-testid="daily-tip-title">
              {tip.title}
            </h3>
            <p className="text-sm text-white/90 mt-1.5 leading-relaxed" data-testid="daily-tip-body">
              {tip.body}
            </p>
          </div>
        </div>

        {/* CTA */}
        {tip.cta_url && (
          <div className="mt-4">
            <Link to={tip.cta_url}>
              <Button
                size="sm"
                className="bg-white text-brand hover:bg-brand-sand rounded-xl font-bold h-10 px-4 btn-press"
                data-testid="daily-tip-cta">
                {tip.cta_label || "Lakukan Sekarang"}
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
