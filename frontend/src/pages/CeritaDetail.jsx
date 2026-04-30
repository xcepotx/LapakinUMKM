import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "@/lib/api";
import { ArrowLeft, ExternalLink, Loader2, Sparkles, Eye, Calendar } from "lucide-react";

/**
 * CeritaDetail — public single story page with markdown render + shop CTA.
 */
export default function CeritaDetail() {
  const { slug } = useParams();
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/stories/${slug}`)
      .then((r) => setStory(r.data))
      .catch((e) => setError(e.response?.status === 404 ? "Cerita tidak ditemukan" : "Gagal memuat cerita"))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-brand-paper" data-testid="cerita-detail-loading">
        <Loader2 className="w-8 h-8 animate-spin text-brand" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen grid place-items-center bg-brand-paper px-4" data-testid="cerita-detail-error">
        <div className="text-center">
          <h1 className="font-heading font-extrabold text-3xl text-brand-ink mb-3">{error}</h1>
          <Link to="/cerita" className="text-brand font-bold hover:underline">← Kembali ke daftar cerita</Link>
        </div>
      </div>
    );
  }

  const publishedAt = story.published_at ? new Date(story.published_at).toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  }) : "";

  return (
    <div className="min-h-screen bg-brand-paper">
      {/* Header */}
      <div className="border-b border-brand-line bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-heading font-extrabold text-lg">
            <span className="w-8 h-8 rounded-lg bg-brand text-white grid place-items-center">
              <Sparkles className="w-4 h-4" />
            </span>
            Lapakin
          </Link>
          <Link to="/cerita" className="text-sm text-brand-mute hover:text-brand-ink font-semibold inline-flex items-center gap-1" data-testid="cerita-detail-back">
            <ArrowLeft className="w-4 h-4" /> Cerita lain
          </Link>
        </div>
      </div>

      {/* Hero */}
      <article className="max-w-3xl mx-auto px-4 pt-10 pb-20">
        <div className="text-[11px] uppercase font-bold tracking-[0.2em] text-brand mb-3">
          {story.shop_name}
        </div>
        <h1 className="font-heading font-extrabold text-3xl sm:text-5xl leading-tight text-brand-ink"
          data-testid="cerita-detail-title">
          {story.title}
        </h1>
        <div className="mt-4 flex items-center gap-4 text-xs text-brand-mute">
          {publishedAt && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> {publishedAt}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" /> {story.view_count} dibaca
          </span>
        </div>

        {/* Hero image */}
        {story.hero_image && (
          <div className="mt-8 aspect-[16/9] rounded-2xl overflow-hidden bg-brand-sand">
            <img src={story.hero_image} alt={story.shop_name} className="w-full h-full object-cover" />
          </div>
        )}

        {/* Content (simple markdown render) */}
        <div className="mt-8 prose prose-stone max-w-none" data-testid="cerita-detail-body">
          {story.content_md.split(/\n\n+/).map((para, i) => {
            if (para.startsWith("## ")) {
              return <h2 key={i} className="font-heading font-bold text-2xl mt-8 mb-3">{para.slice(3)}</h2>;
            }
            if (para.startsWith("# ")) {
              return <h2 key={i} className="font-heading font-bold text-3xl mt-8 mb-3">{para.slice(2)}</h2>;
            }
            return <p key={i} className="text-base sm:text-lg text-brand-ink/85 leading-relaxed mb-5">{para}</p>;
          })}
        </div>

        {/* Shop CTA */}
        <div className="mt-12 rounded-3xl bg-gradient-to-br from-brand to-brand-dark text-white p-7 sm:p-8 shadow-cardHover">
          <div className="text-[10px] uppercase tracking-widest font-bold text-yellow-200 mb-2">
            Kunjungi tokonya
          </div>
          <h3 className="font-heading font-extrabold text-2xl sm:text-3xl">
            Cek langsung {story.shop_name}
          </h3>
          <p className="text-white/85 mt-2 text-sm">
            Dukung UMKM Indonesia. Cerita di atas dimulai dari toko ini — boleh banget mampir, lihat menu / produknya.
          </p>
          <Link to={`/toko/${story.shop_slug}`}
            className="mt-5 inline-flex items-center gap-2 bg-white text-brand font-bold rounded-xl px-5 h-11 hover:bg-brand-sand transition btn-press"
            data-testid="cerita-detail-shop-cta">
            Buka Toko <ExternalLink className="w-4 h-4" />
          </Link>
        </div>

        {/* Lapakin CTA */}
        <div className="mt-8 rounded-2xl border-2 border-dashed border-brand-line bg-white p-5 text-center"
          data-testid="cerita-detail-lapakin-cta">
          <p className="text-sm text-brand-mute">
            Mau buat toko online seperti {story.shop_name}? <Link to="/register" className="text-brand font-bold hover:underline">Mulai gratis di Lapakin →</Link>
          </p>
        </div>
      </article>
    </div>
  );
}
