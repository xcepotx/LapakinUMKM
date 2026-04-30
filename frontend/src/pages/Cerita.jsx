import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { Sparkles, ArrowRight, Loader2, Store } from "lucide-react";

/**
 * Cerita — public list of UMKM success stories.
 */
export default function Cerita() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/stories").then((r) => {
      setItems(r.data.items || []);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-brand-paper">
      {/* Header */}
      <div className="border-b border-brand-line bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-heading font-extrabold text-lg" data-testid="cerita-logo">
            <span className="w-8 h-8 rounded-lg bg-brand text-white grid place-items-center">
              <Sparkles className="w-4 h-4" />
            </span>
            Lapakin
          </Link>
          <Link to="/" className="text-sm text-brand-mute hover:text-brand-ink font-semibold" data-testid="cerita-back">
            ← Beranda
          </Link>
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-4 pt-12 pb-8">
        <div className="text-[11px] uppercase font-bold tracking-[0.18em] text-brand mb-3">
          ✨ Cerita UMKM Lapakin
        </div>
        <h1 className="font-heading font-extrabold text-3xl sm:text-5xl text-brand-ink leading-tight">
          Cerita inspiratif dari pedagang Indonesia
        </h1>
        <p className="text-brand-mute text-base sm:text-lg mt-3 max-w-2xl">
          Setiap toko punya cerita. Pelajari bagaimana mereka memulai,
          tantangan apa yang dilalui, dan strategi yang bikin tokonya tumbuh.
        </p>
      </div>

      {/* List */}
      <div className="max-w-5xl mx-auto px-4 pb-16">
        {loading ? (
          <div className="text-center py-12 text-brand-mute" data-testid="cerita-loading">
            <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" /> Memuat cerita…
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-brand-line" data-testid="cerita-empty">
            <Store className="w-10 h-10 mx-auto text-brand-mute mb-2" />
            <h3 className="font-heading font-bold">Belum ada cerita</h3>
            <p className="text-sm text-brand-mute mt-1">
              Tim Lapakin lagi nyusun cerita-cerita inspiratif. Pantengin terus ya 🙏
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-5">
            {items.map((s) => (
              <Link
                to={`/cerita/${s.slug}`}
                key={s.story_id}
                className="bg-white rounded-2xl border border-brand-line shadow-card hover:shadow-cardHover hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col"
                data-testid={`cerita-card-${s.slug}`}>
                <div className="aspect-[16/9] bg-gradient-to-br from-brand to-brand-dark relative overflow-hidden">
                  {s.hero_image
                    ? <img src={s.hero_image} alt={s.shop_name} className="w-full h-full object-cover" />
                    : <div className="absolute inset-0 grid place-items-center text-white/80 font-heading font-bold text-2xl">
                        {s.shop_name}
                      </div>}
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-brand mb-1.5">
                    {s.shop_name}
                  </div>
                  <h2 className="font-heading font-bold text-lg leading-snug" data-testid={`cerita-title-${s.slug}`}>
                    {s.title}
                  </h2>
                  <p className="text-sm text-brand-mute mt-2 line-clamp-3 flex-1">
                    {s.excerpt}
                  </p>
                  <div className="mt-4 inline-flex items-center gap-1.5 text-brand font-bold text-sm">
                    Baca cerita lengkap <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
