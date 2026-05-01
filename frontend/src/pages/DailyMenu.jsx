import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  ArrowLeft, Calendar, CheckCircle2, Lock, Loader2, Save, Sparkles, Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { rupiah } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const DAYS = [
  { idx: 0, short: "Sen", label: "Senin" },
  { idx: 1, short: "Sel", label: "Selasa" },
  { idx: 2, short: "Rab", label: "Rabu" },
  { idx: 3, short: "Kam", label: "Kamis" },
  { idx: 4, short: "Jum", label: "Jumat" },
  { idx: 5, short: "Sab", label: "Sabtu" },
  { idx: 6, short: "Min", label: "Minggu" },
];

/**
 * DailyMenu — Pro/Bisnis page to plan which products show on which weekday.
 * Bulk grid: rows = products, columns = Sen..Min. Click cell → toggle.
 * "Setiap hari" = empty available_days array.
 */
export default function DailyMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState({}); // product_id → days[]

  const tier = user?.tier || "free";
  const isProPlus = tier === "pro" || tier === "business";

  useEffect(() => {
    if (!isProPlus) { setLoading(false); return; }
    api.get("/products?limit=500").then((r) => {
      const items = r.data.items || r.data || [];
      const init = {};
      items.forEach((p) => {
        init[p.product_id] = Array.isArray(p.available_days) ? [...p.available_days] : [];
      });
      setProducts(items);
      setEdits(init);
    }).catch(() => toast.error("Gagal memuat produk"))
      .finally(() => setLoading(false));
  }, [isProPlus]);

  const todayIdx = (new Date().getDay() + 6) % 7; // JS Sun=0, ours Mon=0

  const toggleDay = (pid, dayIdx) => {
    setEdits((prev) => {
      const cur = prev[pid] || [];
      const isOn = cur.includes(dayIdx);
      const next = isOn ? cur.filter((d) => d !== dayIdx) : [...cur, dayIdx].sort();
      return { ...prev, [pid]: next };
    });
  };

  const setAllDays = (pid) => {
    // Empty array = "Setiap hari" (toggle: if already all-7 or empty, mark explicit none-day instead)
    setEdits((prev) => ({ ...prev, [pid]: [] }));
  };

  const setNoDays = (pid) => {
    setEdits((prev) => ({ ...prev, [pid]: [-1] })); // sentinel; we'll convert to [] but mark "tutup"
  };

  // Quick action: set today's menu
  const setTodayOnly = (pid) => {
    setEdits((prev) => ({ ...prev, [pid]: [todayIdx] }));
  };

  // Compute: which products have changed from initial
  const changedCount = useMemo(() => {
    return products.filter((p) => {
      const init = Array.isArray(p.available_days) ? [...p.available_days].sort().join(",") : "";
      const cur = (edits[p.product_id] || []).filter((d) => d >= 0).sort().join(",");
      return init !== cur;
    }).length;
  }, [edits, products]);

  // Today's count preview
  const todayCount = useMemo(() => {
    return products.filter((p) => {
      const days = edits[p.product_id] || [];
      return days.length === 0 || days.includes(todayIdx);
    }).length;
  }, [edits, products, todayIdx]);

  const save = async () => {
    setSaving(true);
    try {
      const updates = Object.entries(edits)
        .map(([product_id, days]) => ({
          product_id,
          available_days: days.filter((d) => d >= 0),
        }));
      const r = await api.put("/products/daily-menu", { updates });
      toast.success(`✅ Tersimpan — ${r.data.updated} produk diupdate`);
      // Refresh local "initial" state to current edits
      setProducts((prev) => prev.map((p) => ({
        ...p,
        available_days: edits[p.product_id]?.filter((d) => d >= 0) || [],
      })));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal simpan");
    } finally {
      setSaving(false);
    }
  };

  // ---- Free tier upsell ----
  if (!isProPlus) {
    return (
      <div className="min-h-screen bg-brand-paper">
        <Header />
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="bg-white border border-brand-line rounded-3xl p-8 text-center shadow-card" data-testid="daily-menu-upsell">
            <div className="w-16 h-16 rounded-2xl bg-brand/10 grid place-items-center mx-auto mb-4">
              <Lock className="w-7 h-7 text-brand" />
            </div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-brand mb-2">PRO &amp; BISNIS</div>
            <h1 className="font-heading font-extrabold text-3xl">Menu Per-Hari</h1>
            <p className="text-brand-mute mt-3 max-w-xl mx-auto">
              Atur produk mana yang tampil di hari apa. Cocok untuk warung yang punya menu rotasi
              (Senin nasi rames, Selasa gado-gado, dst). Pelanggan cuma lihat menu yang tersedia hari itu.
            </p>
            <Link to="/pricing">
              <Button className="bg-brand text-white hover:bg-brand-dark rounded-xl font-bold h-11 px-6 mt-5"
                data-testid="daily-menu-upgrade-cta">
                Upgrade ke Pro — Rp 49rb/bulan
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-paper">
      <Header />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-brand mb-1">PERENCANA MENU</div>
            <h1 className="font-heading font-extrabold text-3xl">Menu Per-Hari</h1>
            <p className="text-brand-mute text-sm mt-1 max-w-xl">
              Pilih hari aktif untuk tiap produk. Kosong = tampil <b>setiap hari</b>. Pelanggan cuma lihat
              produk yang aktif di hari itu.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="bg-white border border-brand-line rounded-xl px-4 py-2.5 text-xs" data-testid="daily-menu-today-summary">
              <div className="text-[10px] uppercase tracking-widest font-bold text-brand-mute">Hari ini ({DAYS[todayIdx].label})</div>
              <div className="font-heading font-extrabold text-base mt-0.5">{todayCount} produk akan tampil</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-brand-mute">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-brand-line">
            <p className="text-brand-mute mb-3">Belum ada produk untuk diatur.</p>
            <Link to="/dashboard/products" className="text-brand font-bold hover:underline">Tambah produk →</Link>
          </div>
        ) : (
          <>
            {/* Save bar — sticky */}
            <div className="bg-white border-2 border-brand rounded-2xl p-4 shadow-card mb-5 flex items-center justify-between gap-3 flex-wrap sticky top-2 z-10"
              data-testid="daily-menu-save-bar">
              <div className="text-sm">
                {changedCount > 0
                  ? <span className="font-semibold text-brand-ink">{changedCount} produk diubah, belum disimpan</span>
                  : <span className="text-brand-mute">Belum ada perubahan</span>}
              </div>
              <Button onClick={save} disabled={saving || changedCount === 0}
                className="bg-brand text-white hover:bg-brand-dark rounded-xl h-10 px-5 font-bold"
                data-testid="daily-menu-save">
                {saving
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Menyimpan…</>
                  : <><Save className="w-4 h-4 mr-2" /> Simpan Perubahan</>}
              </Button>
            </div>

            {/* Grid: produk × hari */}
            <div className="bg-white border border-brand-line rounded-2xl shadow-card overflow-hidden" data-testid="daily-menu-grid">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-brand-off border-b border-brand-line">
                    <tr>
                      <th className="text-left text-xs font-bold uppercase tracking-widest text-brand-mute py-3 px-3 sticky left-0 bg-brand-off z-10 min-w-[200px]">
                        Produk
                      </th>
                      {DAYS.map((d) => (
                        <th key={d.idx} className={`text-center text-xs font-bold uppercase py-3 px-2 ${
                          d.idx === todayIdx ? "text-brand" : "text-brand-mute"
                        }`}
                          data-testid={`daily-menu-col-${d.short}`}>
                          {d.short}
                          {d.idx === todayIdx && <div className="text-[8px] mt-0.5 normal-case text-brand">hari ini</div>}
                        </th>
                      ))}
                      <th className="text-xs font-bold uppercase tracking-widest text-brand-mute py-3 px-3">
                        Quick
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => {
                      const days = edits[p.product_id] || [];
                      const isAllDay = days.length === 0 || days.length === 7;
                      const img = (p.images || [])[0];
                      return (
                        <tr key={p.product_id} className="border-b border-brand-line/50 hover:bg-brand-off/50"
                          data-testid={`daily-menu-row-${p.product_id}`}>
                          <td className="py-2.5 px-3 sticky left-0 bg-white z-10">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-9 h-9 rounded-lg bg-brand-off shrink-0 overflow-hidden grid place-items-center">
                                {img ? <img src={img} alt={p.name} className="w-full h-full object-cover" />
                                  : <ImageIcon className="w-4 h-4 text-brand-mute" />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold truncate">{p.name}</div>
                                <div className="text-[11px] text-brand-mute">{rupiah(p.price)}</div>
                              </div>
                            </div>
                          </td>
                          {DAYS.map((d) => {
                            const isOn = isAllDay || days.includes(d.idx);
                            return (
                              <td key={d.idx} className="text-center py-2.5 px-1">
                                <button type="button"
                                  onClick={() => toggleDay(p.product_id, d.idx)}
                                  className={`w-9 h-9 rounded-lg border-2 grid place-items-center transition ${
                                    isOn
                                      ? "bg-brand border-brand text-white"
                                      : "bg-white border-brand-line text-brand-mute hover:border-brand/50"
                                  }`}
                                  data-testid={`daily-menu-cell-${p.product_id}-${d.idx}`}
                                  title={d.label}>
                                  {isOn && <CheckCircle2 className="w-4 h-4" />}
                                </button>
                              </td>
                            );
                          })}
                          <td className="py-2.5 px-3">
                            <div className="flex gap-1 flex-wrap">
                              <button onClick={() => setAllDays(p.product_id)}
                                className="text-[10px] font-bold uppercase tracking-wider text-brand-mute hover:text-brand-ink"
                                data-testid={`daily-menu-allday-${p.product_id}`}>
                                Semua
                              </button>
                              <span className="text-brand-mute">·</span>
                              <button onClick={() => setTodayOnly(p.product_id)}
                                className="text-[10px] font-bold uppercase tracking-wider text-brand hover:text-brand-dark"
                                data-testid={`daily-menu-today-${p.product_id}`}>
                                Hari ini
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Helper notes */}
            <div className="mt-5 bg-brand-off rounded-xl border border-brand-line p-4 text-xs text-brand-mute leading-relaxed">
              <p>
                💡 <b className="text-brand-ink">Tips:</b> Centang semua hari = produk muncul tiap hari.
                Klik <b className="text-brand-ink">"Semua"</b> untuk reset cepat ke setiap hari.
                Klik <b className="text-brand-ink">"Hari ini"</b> untuk bikin produk cuma tampil hari ini saja.
              </p>
              <p className="mt-2">
                Pelanggan akan melihat <b className="text-brand-ink">{todayCount} produk</b> hari ini ({DAYS[todayIdx].label}).
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="border-b border-brand-line bg-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/dashboard" className="text-sm text-brand-mute hover:text-brand-ink font-semibold inline-flex items-center gap-1" data-testid="daily-menu-back">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="text-xs uppercase tracking-widest font-bold text-brand-mute flex items-center gap-1">
          <Calendar className="w-3 h-3" /> Menu Per-Hari
        </div>
      </div>
    </div>
  );
}
