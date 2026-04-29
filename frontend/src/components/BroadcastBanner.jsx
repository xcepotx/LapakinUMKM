import { useEffect, useState } from "react";
import api from "@/lib/api";
import { X, Megaphone } from "lucide-react";

const VARIANT_STYLE = {
  info: "bg-blue-50 border-blue-200 text-blue-900",
  success: "bg-green-50 border-green-200 text-green-900",
  warning: "bg-amber-50 border-amber-200 text-amber-900",
};

export default function BroadcastBanner() {
  const [bc, setBc] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/me/broadcast");
        if (data && data.active && data.target !== "whatsapp") setBc(data);
      } catch (_) {}
    })();
  }, []);

  if (!bc) return null;
  const dismiss = async () => {
    try { await api.post(`/me/broadcast/${bc.broadcast_id}/dismiss`); } catch (_) {}
    setBc(null);
  };
  const cls = VARIANT_STYLE[bc.variant] || VARIANT_STYLE.info;

  return (
    <div className={`rounded-2xl border ${cls} p-4 mb-6 flex items-start gap-3`} data-testid="broadcast-banner">
      <Megaphone className="w-5 h-5 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-bold">{bc.title}</div>
        <p className="text-sm mt-1 leading-relaxed">{bc.message}</p>
      </div>
      <button onClick={dismiss} className="shrink-0 p-1 hover:bg-black/5 rounded-lg" aria-label="dismiss" data-testid="broadcast-dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
