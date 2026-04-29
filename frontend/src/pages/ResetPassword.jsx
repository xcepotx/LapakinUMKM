import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Lock } from "lucide-react";
import { toast } from "sonner";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { setToken(params.get("token") || ""); }, [params]);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { toast.error("Password minimal 6 karakter"); return; }
    if (password !== confirm) { toast.error("Password tidak cocok"); return; }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      toast.success("Password berhasil di-reset! Silakan login.");
      navigate("/login");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-brand-sand">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-8">
          <span className="w-8 h-8 rounded-xl bg-brand grid place-items-center text-white"><Sparkles className="w-4 h-4" /></span>
          <span className="font-heading font-extrabold text-lg">Lapakin</span>
        </Link>
        <h1 className="font-heading font-bold text-2xl">Reset Password</h1>
        <p className="text-brand-mute mt-1 text-sm">Masukkan password baru untuk akunmu.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="token">Token Reset</Label>
            <Input id="token" required value={token} onChange={(e) => setToken(e.target.value)}
              className="mt-1 rounded-xl border-brand-line h-12 font-mono text-xs"
              data-testid="reset-token-input" />
          </div>
          <div>
            <Label htmlFor="pw">Password Baru</Label>
            <div className="relative mt-1">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
              <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter" className="pl-10 rounded-xl border-brand-line h-12"
                data-testid="reset-password-input" />
            </div>
          </div>
          <div>
            <Label htmlFor="pw2">Ulangi Password</Label>
            <div className="relative mt-1">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
              <Input id="pw2" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="pl-10 rounded-xl border-brand-line h-12"
                data-testid="reset-confirm-input" />
            </div>
          </div>
          <Button type="submit" disabled={loading}
            className="w-full bg-brand hover:bg-brand-hover text-white rounded-xl h-12 font-semibold btn-press"
            data-testid="reset-submit-btn">
            {loading ? "Memproses…" : "Reset Password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
