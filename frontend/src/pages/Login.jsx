import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Mail, Lock } from "lucide-react";
import { toast } from "sonner";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
function startGoogleLogin() {
  const redirectUrl = window.location.origin + "/dashboard";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const showError = location.search.includes("error=google");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setUser(data);
      toast.success("Berhasil masuk!");
      if (data?.role === "admin") navigate("/admin");
      else navigate(data?.shop_id ? "/dashboard" : "/onboarding");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-brand-sand">
      <div className="hidden lg:flex flex-1 relative items-center justify-center bg-brand text-white p-12 overflow-hidden">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-brand-accent/30 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-brand-moss/30 blur-3xl" />
        <div className="relative max-w-md">
          <Link to="/" className="flex items-center gap-2 mb-12">
            <span className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur grid place-items-center"><Sparkles className="w-4 h-4" /></span>
            <span className="font-heading font-extrabold text-xl">Lapakin</span>
          </Link>
          <h1 className="font-heading font-extrabold text-4xl leading-tight">
            Selamat datang lagi 👋
          </h1>
          <p className="mt-4 text-white/85 leading-relaxed">
            Masuk dan lanjutkan kelola tokomu. AI Lapakin sudah nungguin foto-foto baru dari kamu.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8">
            <Link to="/" className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-brand grid place-items-center text-white"><Sparkles className="w-4 h-4" /></span>
              <span className="font-heading font-extrabold text-lg">Lapakin</span>
            </Link>
          </div>
          <h2 className="font-heading font-bold text-2xl">Masuk ke akunmu</h2>
          <p className="text-brand-mute mt-1 text-sm">Belum punya akun?{" "}
            <Link to="/register" className="text-brand font-semibold hover:underline" data-testid="goto-register-link">Daftar gratis</Link>
          </p>

          {showError && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="oauth-error">
              Login Google gagal. Coba lagi atau pakai email/password.
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={startGoogleLogin}
            className="mt-6 w-full rounded-xl py-6 border-brand-line bg-white hover:bg-brand-off btn-press"
            data-testid="google-login-btn"
          >
            <GoogleIcon /> <span className="ml-2 font-semibold">Lanjut dengan Google</span>
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs text-brand-mute">
            <div className="flex-1 h-px bg-brand-line" /> atau email <div className="flex-1 h-px bg-brand-line" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative mt-1">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
                <Input
                  id="email" type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="kamu@email.com"
                  className="pl-10 rounded-xl border-brand-line h-12"
                  data-testid="login-email-input"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative mt-1">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
                <Input
                  id="password" type="password" required value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="pl-10 rounded-xl border-brand-line h-12"
                  data-testid="login-password-input"
                />
              </div>
            </div>
            <Button
              type="submit" disabled={loading}
              className="w-full bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
              data-testid="login-submit-btn"
            >
              {loading ? "Memproses…" : "Masuk"}
            </Button>
            <div className="text-right">
              <Link to="/forgot-password" className="text-sm text-brand-mute hover:text-brand-ink hover:underline" data-testid="goto-forgot-link">
                Lupa password?
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.3h4.8c-.2 1.1-.8 2-1.7 2.6v2.2h2.8c1.6-1.5 2.7-3.7 2.7-6.4z" fill="#4285F4" />
      <path d="M9 18c2.4 0 4.4-.8 5.9-2.2l-2.8-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H1v2.3C2.5 15.9 5.5 18 9 18z" fill="#34A853" />
      <path d="M3.9 10.7C3.7 10.1 3.6 9.5 3.6 9s.1-1.1.3-1.7V5H1C.4 6.2 0 7.5 0 9s.4 2.8 1 4l2.9-2.3z" fill="#FBBC05" />
      <path d="M9 3.6c1.4 0 2.6.5 3.5 1.4l2.6-2.6C13.4.9 11.4 0 9 0 5.5 0 2.5 2.1 1 5l2.9 2.3C4.6 5.2 6.6 3.6 9 3.6z" fill="#EA4335" />
    </svg>
  );
}
