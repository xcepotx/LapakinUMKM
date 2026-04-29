import { useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Mail, Copy, Check } from "lucide-react";
import { toast } from "sonner";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/forgot-password", { email });
      if (data?.reset_token) {
        setResetToken(data.reset_token);
      } else {
        toast.success("Kalau email terdaftar, link reset kami kirim ke inbox kamu. Cek email (termasuk folder Spam) ya 📬");
        setEmail("");
      }
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetUrl = resetToken ? `${window.location.origin}/reset-password?token=${resetToken}` : "";

  const copy = () => {
    navigator.clipboard.writeText(resetUrl);
    setCopied(true);
    toast.success("Link tersalin!");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-brand-sand">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-8">
          <span className="w-8 h-8 rounded-xl bg-brand grid place-items-center text-white"><Sparkles className="w-4 h-4" /></span>
          <span className="font-heading font-extrabold text-lg">Lapakin</span>
        </Link>
        <h1 className="font-heading font-bold text-2xl">Lupa password?</h1>
        <p className="text-brand-mute mt-1 text-sm">Masukkan email akunmu, kami buatkan link reset.</p>

        {!resetToken ? (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative mt-1">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="kamu@email.com" className="pl-10 rounded-xl border-brand-line h-12"
                  data-testid="forgot-email-input" />
              </div>
            </div>
            <Button type="submit" disabled={loading}
              className="w-full bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
              data-testid="forgot-submit-btn">
              {loading ? "Memproses…" : "Buat Link Reset"}
            </Button>
            <div className="text-center text-sm text-brand-mute">
              <Link to="/login" className="text-brand font-semibold hover:underline">Kembali ke Login</Link>
            </div>
          </form>
        ) : (
          <div className="mt-6 space-y-4 bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="reset-link-card">
            <div>
              <div className="text-xs uppercase tracking-[0.15em] font-bold text-brand">Mode Sederhana</div>
              <p className="text-sm text-brand-mute mt-2">
                Karena layanan email belum dipasang, link reset password tampil di sini.
                Klik link untuk reset password (berlaku 1 jam).
              </p>
            </div>
            <div className="bg-brand-off border border-brand-line rounded-xl p-3 break-all text-sm font-mono">
              {resetUrl}
            </div>
            <div className="flex gap-2">
              <Button onClick={copy} className="flex-1 rounded-xl bg-brand-off text-brand-ink hover:bg-brand-off/70 border border-brand-line"
                data-testid="copy-reset-link-btn">
                {copied ? <><Check className="w-4 h-4 mr-2" /> Tersalin</> : <><Copy className="w-4 h-4 mr-2" /> Salin</>}
              </Button>
              <Link to={`/reset-password?token=${resetToken}`} className="flex-1">
                <Button className="w-full rounded-xl bg-brand hover:bg-brand-hover text-white font-semibold btn-press"
                  data-testid="open-reset-page-btn">
                  Buka Halaman Reset
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
