import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  Sparkles, Copy, ExternalLink, CheckCircle2, AlertTriangle,
  Loader2, Lock, Share2, RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

/**
 * ShareHealthCard — dashboard widget for Pro/Business merchants.
 *
 * Combines two previously-separate ideas:
 *  (1) Custom Subdomain onboarding (slug.lapakin.my.id link + copy + DNS check)
 *  (2) OG / Share preview health (DNS, reachability, og tags present)
 *
 * Free tier sees an upsell card pointing to /pricing.
 */
export default function ShareHealthCard({ shop }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = async () => {
    try {
      const r = await api.get("/shops/me/share-health");
      setData(r.data);
    } catch (_e) {
      // Silent: widget hides itself when no data
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchHealth(); /* on mount */ }, []);

  if (loading) {
    return (
      <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card" data-testid="share-health-loading">
        <div className="flex items-center gap-2 text-brand-mute text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Memeriksa kesehatan link share…
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { can_use_subdomain, subdomain, apex, og_image_url, tier } = data;

  const copy = (text, label = "Link disalin") => {
    navigator.clipboard.writeText(text);
    toast.success(label);
  };

  const refresh = async () => {
    setRefreshing(true);
    await fetchHealth();
    toast.success("Status diperbarui");
  };

  return (
    <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card" data-testid="share-health-card">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="font-heading font-bold text-xl flex items-center gap-2">
            <Share2 className="w-5 h-5 text-brand" /> Link Toko &amp; Status Share
          </h2>
          <p className="text-brand-mute mt-1 text-sm">
            Kelola link toko kamu dan cek apakah preview WhatsApp/IG/FB sudah aktif.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-mute hover:text-brand-ink disabled:opacity-50"
          data-testid="share-health-refresh"
          title="Refresh status DNS & OG">
          {refreshing
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCcw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {/* Apex link — always visible */}
      <LinkBlock
        label="Link Reguler"
        url={apex.url}
        badge="Aktif untuk semua paket"
        onCopy={() => copy(apex.url)}
        onOpen={() => window.open(apex.url, "_blank")}
        testidPrefix="apex"
      />

      {/* Custom subdomain — Pro/Business */}
      <div className="mt-4">
        {can_use_subdomain ? (
          <LinkBlock
            label="Subdomain Kustom"
            url={subdomain.url}
            badge={
              subdomain.dns_resolves === true && subdomain.og_valid === true
                ? { text: "Live & Sehat", tone: "green" }
                : subdomain.dns_resolves === false
                  ? { text: "DNS belum aktif", tone: "yellow" }
                  : subdomain.reachable === false
                    ? { text: "Server belum merespons", tone: "red" }
                    : subdomain.og_valid === false
                      ? { text: "OG belum lengkap", tone: "yellow" }
                      : { text: "Aktif", tone: "green" }
            }
            onCopy={() => copy(subdomain.url)}
            onOpen={() => window.open(subdomain.url, "_blank")}
            accent
            testidPrefix="subdomain"
          />
        ) : (
          <div className="rounded-xl border border-dashed border-brand-line bg-brand-off/60 p-4 flex items-start gap-3"
            data-testid="subdomain-upsell">
            <div className="w-9 h-9 rounded-lg bg-white border border-brand-line grid place-items-center text-brand-mute shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-heading font-bold text-sm">
                Subdomain Kustom <span className="text-[10px] bg-brand/10 text-brand font-bold rounded-full px-2 py-0.5 ml-1 align-middle">PRO</span>
              </div>
              <p className="text-xs text-brand-mute mt-1">
                Dapatkan link pendek <b className="text-brand-ink">{shop?.slug}.lapakin.my.id</b> yang lebih mudah diingat pelanggan.
              </p>
              <Link to="/pricing"
                className="inline-block mt-2 text-xs font-bold text-brand hover:underline"
                data-testid="subdomain-upsell-cta">
                Upgrade ke Pro →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* DNS help if Pro+ but DNS failed */}
      {can_use_subdomain && subdomain.dns_resolves === false && (
        <div className="mt-3 rounded-xl bg-yellow-50 border border-yellow-200 p-3 text-xs text-yellow-900"
          data-testid="subdomain-dns-help">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">DNS subdomain belum aktif</div>
              <p className="mt-1 leading-relaxed">
                Pastikan wildcard DNS <code className="bg-white px-1 py-0.5 rounded border border-yellow-200">*.lapakin.my.id</code>
                {" "}sudah di-set ke IP server. Propagasi biasanya 5–30 menit.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Social crawler quick-test links */}
      <div className="mt-5 pt-4 border-t border-brand-line">
        <div className="text-[11px] uppercase font-bold tracking-wider text-brand-mute mb-2">
          Cek Preview di Luar
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(can_use_subdomain && subdomain.dns_resolves ? subdomain.url : apex.url)}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-xs font-semibold"
            data-testid="share-health-fb-debugger">
            <ExternalLink className="w-3.5 h-3.5" /> Facebook Debugger
          </a>
          <a
            href={`https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(can_use_subdomain && subdomain.dns_resolves ? subdomain.url : apex.url)}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-xs font-semibold"
            data-testid="share-health-linkedin">
            <ExternalLink className="w-3.5 h-3.5" /> LinkedIn Post Inspector
          </a>
          <a href={og_image_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-brand-off hover:bg-white border border-brand-line rounded-xl px-3 py-2 text-xs font-semibold"
            data-testid="share-health-og-image">
            <ExternalLink className="w-3.5 h-3.5" /> Lihat Gambar OG
          </a>
        </div>
        <p className="text-[11px] text-brand-mute mt-3 leading-relaxed">
          💡 Setelah update cover/tagline, paste link di Facebook Debugger lalu klik &quot;Scrape Again&quot; supaya WhatsApp ambil preview baru (cache 1–7 hari).
        </p>
      </div>

      {/* Hidden bit: tier badge for debugging / confidence */}
      {tier && (
        <div className="mt-3 text-[10px] text-brand-mute uppercase tracking-widest">
          Tier kamu: <b className="text-brand-ink">{tier}</b>
        </div>
      )}
    </div>
  );
}

function LinkBlock({ label, url, badge, onCopy, onOpen, accent = false, testidPrefix = "link" }) {
  const badgeObj = typeof badge === "string" ? { text: badge, tone: "neutral" } : badge;
  return (
    <div
      className={`rounded-xl p-3 ${accent ? "bg-brand/5 border-2 border-brand/20" : "bg-brand-off border border-brand-line"}`}
      data-testid={`${testidPrefix}-block`}>
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <div className="text-[11px] uppercase font-bold tracking-wider text-brand-mute">
          {label}
        </div>
        {badgeObj && <HealthBadge {...badgeObj} testid={`${testidPrefix}-badge`} />}
      </div>
      <div className="flex items-center gap-2">
        <code
          className="flex-1 text-xs sm:text-sm font-mono bg-white border border-brand-line rounded-lg px-2 py-2 truncate"
          data-testid={`${testidPrefix}-url`}>
          {url}
        </code>
        <Button
          size="sm"
          onClick={onCopy}
          className="bg-brand text-white hover:bg-brand-dark rounded-lg h-9 text-xs font-bold px-3"
          data-testid={`${testidPrefix}-copy`}>
          <Copy className="w-3.5 h-3.5 mr-1" /> Salin
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onOpen}
          className="rounded-lg h-9 text-xs font-bold px-3 border-brand-line"
          data-testid={`${testidPrefix}-open`}>
          <ExternalLink className="w-3.5 h-3.5 mr-1" /> Buka
        </Button>
      </div>
    </div>
  );
}

function HealthBadge({ text, tone = "neutral", testid }) {
  const cfg = {
    green:   { bg: "bg-green-100", border: "border-green-300", text: "text-green-800", Icon: CheckCircle2 },
    yellow:  { bg: "bg-yellow-100", border: "border-yellow-300", text: "text-yellow-900", Icon: AlertTriangle },
    red:     { bg: "bg-red-100", border: "border-red-300", text: "text-red-800", Icon: AlertTriangle },
    neutral: { bg: "bg-brand-off", border: "border-brand-line", text: "text-brand-mute", Icon: Sparkles },
  }[tone] || { bg: "bg-brand-off", border: "border-brand-line", text: "text-brand-mute", Icon: Sparkles };
  const { Icon } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border ${cfg.bg} ${cfg.border} ${cfg.text}`}
      data-testid={testid}>
      <Icon className="w-3 h-3" /> {text}
    </span>
  );
}
