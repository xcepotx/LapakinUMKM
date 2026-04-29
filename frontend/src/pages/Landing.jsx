import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sparkles, Wand2, ImageIcon, Smartphone, ArrowRight, Check, Store } from "lucide-react";

const HERO_IMG =
  "https://images.unsplash.com/photo-1777049645539-ed5b46f3fa5d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxNzV8MHwxfHNlYXJjaHwxfHxhc2lhbiUyMHNtYWxsJTIwYnVzaW5lc3MlMjBtYXJrZXQlMjBzdGFsbHxlbnwwfHx8fDE3Nzc0MzExMzh8MA&ixlib=rb-4.1.0&q=85";

export default function Landing() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [featured, setFeatured] = useState([]);
  useEffect(() => {
    (async () => {
      try { const { data } = await api.get("/featured-shops"); setFeatured(data || []); } catch (_) {}
    })();
  }, []);

  return (
    <div className="min-h-screen bg-brand-sand text-brand-ink">
      {/* Sticky nav */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-brand-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" data-testid="brand-logo">
            <span className="w-8 h-8 rounded-xl bg-brand grid place-items-center text-white">
              <Sparkles className="w-4 h-4" />
            </span>
            <span className="font-heading font-extrabold text-lg tracking-tight">Lapakin</span>
          </Link>
          <div className="hidden sm:flex items-center gap-8 text-sm text-brand-mute">
            <a href="#fitur" className="hover:text-brand-ink transition-colors">Fitur</a>
            <a href="#cara-kerja" className="hover:text-brand-ink transition-colors">Cara Kerja</a>
            <a href="#harga" className="hover:text-brand-ink transition-colors">Harga</a>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <Button variant="ghost" onClick={() => navigate("/dashboard")} data-testid="nav-dashboard-btn">
                  Dashboard
                </Button>
                <Button variant="outline" onClick={logout} data-testid="nav-logout-btn">Keluar</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => navigate("/login")} data-testid="nav-login-btn" className="text-brand-ink">
                  Masuk
                </Button>
                <Button
                  className="bg-brand hover:bg-brand-hover text-white rounded-xl font-semibold btn-press"
                  onClick={() => navigate("/register")}
                  data-testid="nav-register-btn"
                >
                  Daftar Gratis
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 gradient-grain pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand-accent/30 blur-3xl animate-blob pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-brand-moss/15 blur-3xl animate-blob pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-24 grid lg:grid-cols-2 gap-12 items-center relative">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold tracking-[0.2em] uppercase bg-white border border-brand-line text-brand">
              <Sparkles className="w-3 h-3" /> Untuk UMKM Indonesia
            </span>
            <h1 className="mt-5 font-heading font-extrabold text-4xl sm:text-5xl lg:text-6xl leading-[1.05] tracking-tight">
              Tokomu cling, <br />
              <span className="text-brand">tanpa ribet teknologi.</span>
            </h1>
            <p className="mt-6 text-lg text-brand-mute max-w-xl leading-relaxed">
              Upload satu foto produk pakai HP — AI Lapakin yang bikin foto profesional, deskripsi menjual,
              dan caption Instagram &amp; TikTok. Tokomu langsung tayang. Beneran 5 menit.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                size="lg"
                className="bg-brand hover:bg-brand-hover text-white rounded-xl px-7 py-6 text-base font-semibold btn-press shadow-card"
                onClick={() => navigate(user ? "/dashboard" : "/register")}
                data-testid="hero-cta-primary"
              >
                Mulai Gratis <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="rounded-xl px-7 py-6 text-base border-brand-line bg-white"
                onClick={() => document.getElementById("cara-kerja")?.scrollIntoView({ behavior: "smooth" })}
                data-testid="hero-cta-secondary"
              >
                Lihat Cara Kerja
              </Button>
            </div>
            <div className="mt-8 flex items-center gap-6 text-sm text-brand-mute">
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-moss" /> Tanpa kartu kredit</div>
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-moss" /> Subdomain gratis</div>
            </div>
          </div>

          <div className="relative animate-fade-up" style={{ animationDelay: "120ms" }}>
            <div className="absolute -inset-6 bg-brand/10 rounded-[2rem] rotate-2" />
            <img
              src={HERO_IMG}
              alt="Pemilik UMKM perempuan tersenyum di lapaknya"
              className="relative rounded-3xl shadow-cardHover object-cover w-full h-[460px]"
            />
            <div className="absolute -bottom-6 -left-4 bg-white border border-brand-line shadow-card rounded-2xl p-4 max-w-[260px] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-accent/20 grid place-items-center">
                <Wand2 className="w-5 h-5 text-brand" />
              </div>
              <div>
                <div className="text-xs text-brand-mute">AI sedang bekerja…</div>
                <div className="font-semibold text-sm">Menulis deskripsi produkmu</div>
              </div>
            </div>
            <div className="absolute -top-6 -right-4 bg-white border border-brand-line shadow-card rounded-2xl px-4 py-3">
              <div className="text-xs text-brand-mute">Foto sebelum / sesudah</div>
              <div className="font-heading font-bold text-brand">+247% klik 🚀</div>
            </div>
          </div>
        </div>
      </section>

      {/* FITUR */}
      <section id="fitur" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-2xl">
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-brand">Fitur</span>
          <h2 className="font-heading font-bold text-3xl sm:text-4xl mt-3">
            AI yang ngerti UMKM, bukan jargon teknologi.
          </h2>
          <p className="mt-4 text-brand-mute">
            Tiga senjata utama buatmu yang gak punya waktu &amp; gak ngerti coding.
          </p>
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-6">
          <FeatureCard
            icon={<ImageIcon className="w-5 h-5" />}
            title="Foto Produk Profesional"
            desc="Upload foto seadanya pakai HP. AI bersihkan latar, perbaiki cahaya, hasilnya kayak hasil studio."
            tid="feature-image"
          />
          <FeatureCard
            icon={<Wand2 className="w-5 h-5" />}
            title="Deskripsi & Caption Otomatis"
            desc="AI menulis deskripsi produk, caption IG, dan TikTok — semuanya bahasa Indonesia, gaya warung modern."
            tid="feature-content"
          />
          <FeatureCard
            icon={<Smartphone className="w-5 h-5" />}
            title="Toko Online Instan"
            desc="Tiap toko dapat halaman cantik di lapakin.id/toko/namamu. Mobile-first, cepat, siap dishare."
            tid="feature-storefront"
          />
        </div>
      </section>

      {/* CARA KERJA */}
      <section id="cara-kerja" className="bg-brand-off border-y border-brand-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 grid lg:grid-cols-2 gap-12">
          <div>
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-brand">Cara Kerja</span>
            <h2 className="font-heading font-bold text-3xl sm:text-4xl mt-3">
              Cuma 3 langkah, tokomu langsung tayang.
            </h2>
            <ul className="mt-8 space-y-5">
              <Step n="01" t="Daftar & buat toko" d="Login email atau Google. Jawab 4 pertanyaan singkat soal toko kamu." />
              <Step n="02" t="Upload foto produk" d="Foto seadanya pakai HP. AI Lapakin bersihkan latar & perbaiki pencahayaan." />
              <Step n="03" t="AI bikin konten" d="Deskripsi web, caption IG, caption TikTok, hashtag. Tinggal copy-paste." />
            </ul>
          </div>
          <div className="bg-white rounded-3xl p-6 sm:p-10 border border-brand-line shadow-card">
            <div className="text-xs text-brand-mute uppercase tracking-[0.2em] font-bold">Contoh hasil AI</div>
            <h3 className="mt-3 font-heading font-bold text-xl">Kopi Susu Gula Aren</h3>
            <p className="mt-3 text-brand-ink leading-relaxed">
              Perpaduan kopi robusta lokal dan gula aren cair khas Bandung. Manisnya pas, aromanya legit,
              cocok buat teman ngopi sore di balkon. Tiap tegukan, ada cerita kampung halaman.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["#kopisusu", "#kopilokal", "#gulaaren", "#umkmnaikkelas", "#kopiindonesia"].map((h) => (
                <span key={h} className="text-xs font-semibold rounded-full px-3 py-1 bg-brand-off border border-brand-line">
                  {h}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED SHOPS */}
      {featured.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20" data-testid="featured-section">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <span className="text-xs font-bold tracking-[0.2em] uppercase text-brand">Toko Pilihan</span>
              <h2 className="font-heading font-bold text-3xl sm:text-4xl mt-3">UMKM yang sudah cling pakai Lapakin.</h2>
            </div>
          </div>
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {featured.map((s) => (
              <Link key={s.shop_id} to={`/toko/${s.slug}`}
                className="bg-white rounded-2xl border border-brand-line p-5 shadow-card card-hover hover:shadow-cardHover hover:border-brand/40"
                data-testid={`featured-${s.slug}`}>
                <div className="w-12 h-12 rounded-xl grid place-items-center text-white font-heading font-extrabold text-lg"
                  style={{ background: s.brand_color || "#C04A3B" }}>
                  {(s.name || "?")[0].toUpperCase()}
                </div>
                <div className="font-heading font-bold mt-3 line-clamp-1">{s.name}</div>
                {s.tagline && <p className="text-xs text-brand-mute mt-1 line-clamp-2">{s.tagline}</p>}
                <div className="text-[10px] uppercase tracking-wider font-bold text-brand-mute mt-3">{s.business_type}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* HARGA */}
      <section id="harga" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-brand">Harga</span>
          <h2 className="font-heading font-bold text-3xl sm:text-4xl mt-3">Mulai gratis, upgrade kalau butuh.</h2>
          <p className="mt-3 text-brand-mute">
            MVP ini gratis untuk dicoba. Premium &amp; WhatsApp Bot menyusul.
          </p>
        </div>
        <div className="mt-12 grid md:grid-cols-2 gap-6">
          <PriceCard
            name="Gratis"
            price="Rp 0"
            features={["Toko online di subdomain Lapakin", "10 produk", "AI Studio (foto + caption)", "Branding 'Powered by Lapakin'"]}
            cta="Mulai Sekarang"
            onClick={() => navigate(user ? "/dashboard" : "/register")}
            tid="price-free"
          />
          <PriceCard
            name="Premium (segera)"
            price="Rp 99rb/bln"
            highlight
            features={["Produk unlimited", "AI Studio prioritas", "Custom domain", "WhatsApp bot pengelolaan toko", "Tanpa branding"]}
            cta="Daftar Waiting List"
            onClick={() => navigate(user ? "/dashboard" : "/register")}
            tid="price-premium"
          />
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <div className="rounded-3xl bg-brand text-white p-10 sm:p-14 relative overflow-hidden">
          <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-brand-accent/40 blur-3xl" />
          <div className="relative max-w-2xl">
            <h3 className="font-heading font-extrabold text-3xl sm:text-4xl leading-tight">
              Saatnya tokomu ikutan cling.
            </h3>
            <p className="mt-3 text-white/85">
              Daftar sekarang, kelola produk pakai HP, biar AI yang ngerjain bagian susahnya.
            </p>
            <Button
              size="lg"
              className="mt-7 bg-white text-brand hover:bg-brand-sand rounded-xl px-7 py-6 font-semibold btn-press"
              onClick={() => navigate(user ? "/dashboard" : "/register")}
              data-testid="footer-cta-btn"
            >
              Daftar Gratis Sekarang <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-brand-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between text-sm text-brand-mute">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-brand grid place-items-center text-white">
              <Sparkles className="w-3 h-3" />
            </span>
            <span className="font-heading font-bold text-brand-ink">Lapakin</span>
            <span>· AI bikin tokomu cling.</span>
          </div>
          <div>© {new Date().getFullYear()} Lapakin · Made for UMKM Indonesia 🇮🇩</div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, desc, tid }) {
  return (
    <div
      className="bg-white border border-brand-line rounded-2xl p-7 shadow-card card-hover hover:border-brand/40 hover:shadow-cardHover"
      data-testid={tid}
    >
      <div className="w-11 h-11 rounded-xl bg-brand-off grid place-items-center text-brand">{icon}</div>
      <h3 className="mt-5 font-heading font-bold text-lg">{title}</h3>
      <p className="mt-2 text-sm text-brand-mute leading-relaxed">{desc}</p>
    </div>
  );
}

function Step({ n, t, d }) {
  return (
    <li className="flex gap-4">
      <div className="font-heading font-extrabold text-2xl text-brand w-12 shrink-0">{n}</div>
      <div>
        <div className="font-heading font-bold text-lg">{t}</div>
        <div className="text-sm text-brand-mute mt-1 max-w-md">{d}</div>
      </div>
    </li>
  );
}

function PriceCard({ name, price, features, cta, onClick, highlight, tid }) {
  return (
    <div
      className={`rounded-2xl p-7 border ${highlight ? "bg-brand text-white border-brand" : "bg-white border-brand-line"} shadow-card card-hover`}
      data-testid={tid}
    >
      <div className={`text-xs font-bold uppercase tracking-[0.2em] ${highlight ? "text-white/80" : "text-brand"}`}>{name}</div>
      <div className="mt-3 font-heading font-extrabold text-3xl">{price}</div>
      <ul className={`mt-6 space-y-3 text-sm ${highlight ? "text-white/90" : "text-brand-ink"}`}>
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className={`w-4 h-4 mt-0.5 ${highlight ? "text-brand-accent" : "text-brand-moss"}`} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Button
        onClick={onClick}
        className={`mt-7 w-full rounded-xl font-semibold btn-press ${highlight ? "bg-white text-brand hover:bg-brand-sand" : "bg-brand text-white hover:bg-brand-hover"}`}
      >
        {cta}
      </Button>
    </div>
  );
}
