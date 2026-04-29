import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) {
      navigate("/login", { replace: true });
      return;
    }
    const session_id = decodeURIComponent(m[1]);

    (async () => {
      try {
        const { data } = await api.post("/auth/google/session", { session_id });
        setUser(data);
        // Clean the hash from URL
        window.history.replaceState(null, "", window.location.pathname);
        navigate(data?.shop_id ? "/dashboard" : "/onboarding", { replace: true, state: { user: data } });
      } catch (e) {
        navigate("/login?error=google", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-sand">
      <div className="text-brand-mute" data-testid="oauth-processing">Sedang memproses login Google…</div>
    </div>
  );
}
