import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Mail, Lock, User } from "lucide-react";
import { toast } from "sonner";
import { GoogleLogin } from "@react-oauth/google";



async function handlePostGoogleLoginRedirect(api, navigate) {
  try {
    const meResponse = await api.get("/auth/me");
    const user = meResponse?.data || {};

    if (user?.subscription_status === "suspended") {
      navigate("/dashboard/billing?expired=1", { replace: true });
      return;
    }

    if (user?.shop_id) {
      await handlePostGoogleLoginRedirect(api, navigate);
      return;
    }

    navigate("/onboarding", { replace: true });
  } catch (err) {
    console.error("Post Google login auth/me failed", err);
    navigate("/login", { replace: true });
  }
}


export default function Register() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { toast.error("Password minimal 6 karakter"); return; }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", { name, email, password });
      setUser(data);
      toast.success(data?.shop_id ? "Akun berhasil dibuat dan kamu masuk ke tim toko!" : "Akun berhasil dibuat!");
      navigate(data?.shop_id ? "/dashboard" : "/onboarding");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  async function handleGoogleSuccess(credentialResponse) {
    if (!credentialResponse?.credential) {
      toast.error("Daftar dengan Google gagal. Token tidak ditemukan.");
      return;
    }

    try {
      const { data } = await api.post("/auth/google/id-token", {
        credential: credentialResponse.credential,
      });

      window.location.href = data?.shop_id ? "/dashboard" : "/onboarding";
    } catch (err) {
      toast.error(
        err?.response?.data?.detail ||
          "Daftar dengan Google gagal. Coba lagi atau pakai email/password."
      );
    }
  }

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
            5 menit lagi, tokomu sudah online.
          </h1>
          <p className="mt-4 text-white/85 leading-relaxed">
            Daftar gratis. Tidak perlu kartu kredit. Tidak perlu paham domain, hosting, atau coding.
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
          <h2 className="font-heading font-bold text-2xl">Buat akun gratis</h2>
          <p className="text-brand-mute mt-1 text-sm">Sudah punya akun?{" "}
            <Link to="/login" className="text-brand font-semibold hover:underline" data-testid="goto-login-link">Masuk</Link>
          </p>

          <div className="mt-4 flex justify-center" data-testid="google-register-btn">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() =>
                toast.error("Daftar dengan Google gagal. Coba lagi atau pakai email/password.")
              }
              useOneTap={false}
              text="signup_with"
              shape="pill"
              width="320"
            />
          </div>

          <div className="my-6 flex items-center gap-3 text-xs text-brand-mute">
            <div className="flex-1 h-px bg-brand-line" /> atau email <div className="flex-1 h-px bg-brand-line" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="name">Nama Anda</Label>
              <div className="relative mt-1">
                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Misal: Bu Sari" className="pl-10 rounded-xl border-brand-line h-12"
                  data-testid="register-name-input" />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative mt-1">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="kamu@email.com" className="pl-10 rounded-xl border-brand-line h-12"
                  data-testid="register-email-input" />
              </div>
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative mt-1">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter" className="pl-10 rounded-xl border-brand-line h-12"
                  data-testid="register-password-input" />
              </div>
            </div>
            <Button type="submit" disabled={loading}
              className="w-full bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
              data-testid="register-submit-btn">
              {loading ? "Memproses…" : "Daftar Sekarang"}
            </Button>
          </form>

          <p className="text-xs text-brand-mute mt-6 text-center">
            Dengan mendaftar, kamu setuju dengan ketentuan layanan Lapakin.
          </p>
        </div>
      </div>
    </div>
  );
}
