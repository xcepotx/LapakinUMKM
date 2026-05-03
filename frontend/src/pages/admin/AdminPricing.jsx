import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Tags } from "lucide-react";
import { toast } from "sonner";

const TIER_ORDER = ["free", "starter", "pro", "business"];

const TIER_COPY = {
  free: {
    title: "Tier 1 — Free",
    desc: "Paket gratis. Harga selalu Rp0 dan tidak bisa diedit.",
  },
  starter: {
    title: "Tier 2 — Starter",
    desc: "Paket awal untuk UMKM baru mulai.",
  },
  pro: {
    title: "Tier 3 — Pro",
    desc: "Paket utama untuk toko aktif.",
  },
  business: {
    title: "Tier 4 — Business",
    desc: "Paket tertinggi untuk tim, cabang, dan fitur lanjutan.",
  },
};

function formatRp(value) {
  return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

export default function AdminPricing() {
  const [tiers, setTiers] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/admin/pricing");
      setTiers(data.tiers || {});
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal memuat pricing");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const update = (tier, key, value) => {
    setTiers((prev) => ({
      ...prev,
      [tier]: {
        ...(prev?.[tier] || {}),
        [key]: Number(value || 0),
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...tiers };

      // Tier 1 must always be Rp0.
      payload.free = {
        ...(payload.free || {}),
        price_idr_month: 0,
        price_idr_year: 0,
      };

      const { data } = await api.put("/admin/pricing", { tiers: payload });
      setTiers(data.tiers || payload);
      toast.success("Harga tier berhasil disimpan");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal menyimpan pricing");
    } finally {
      setSaving(false);
    }
  };

  if (!tiers) {
    return (
      <AdminLayout title="Pricing Tiers" subtitle="Atur harga paket Lapakin.">
        <div className="text-brand-mute">Memuat pricing…</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Pricing Tiers" subtitle="Atur harga Tier 1 sampai Tier 4. Tier 1 selalu Rp0.">
      <div className="grid lg:grid-cols-2 gap-4">
        {TIER_ORDER.map((tier, idx) => {
          const item = tiers[tier] || {};
          const locked = tier === "free";
          const copy = TIER_COPY[tier];

          return (
            <div key={tier} className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid={`admin-pricing-${tier}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-extrabold uppercase tracking-wider text-brand-mute">
                    Tier {idx + 1}
                  </div>
                  <h2 className="font-heading font-extrabold text-xl mt-1">{copy.title}</h2>
                  <p className="text-sm text-brand-mute mt-1">{copy.desc}</p>
                </div>

                <div className="w-11 h-11 rounded-xl bg-brand-off grid place-items-center text-brand">
                  <Tags className="w-5 h-5" />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 mt-5">
                <div>
                  <label className="text-xs font-bold uppercase text-brand-mute">Harga Bulanan</label>
                  <Input
                    type="number"
                    min="0"
                    disabled={locked}
                    value={locked ? 0 : item.price_idr_month || 0}
                    onChange={(e) => update(tier, "price_idr_month", e.target.value)}
                    className="mt-1 rounded-xl border-brand-line h-12"
                    data-testid={`price-month-${tier}`}
                  />
                  <div className="text-xs text-brand-mute mt-1">
                    {formatRp(locked ? 0 : item.price_idr_month)}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase text-brand-mute">Harga Tahunan</label>
                  <Input
                    type="number"
                    min="0"
                    disabled={locked}
                    value={locked ? 0 : item.price_idr_year || 0}
                    onChange={(e) => update(tier, "price_idr_year", e.target.value)}
                    className="mt-1 rounded-xl border-brand-line h-12"
                    data-testid={`price-year-${tier}`}
                  />
                  <div className="text-xs text-brand-mute mt-1">
                    {formatRp(locked ? 0 : item.price_idr_year)}
                  </div>
                </div>
              </div>

              {locked && (
                <div className="mt-4 rounded-xl border border-brand-line bg-brand-off/60 p-3 text-sm text-brand-mute">
                  Tier 1 dikunci di Rp0 agar paket gratis tetap tersedia.
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-4 mt-6 bg-white border border-brand-line rounded-2xl p-4 shadow-card flex items-center justify-between gap-3">
        <div>
          <div className="font-bold">Simpan perubahan harga</div>
          <div className="text-sm text-brand-mute">
            Perubahan akan tampil di Pricing dan Billing setelah disimpan.
          </div>
        </div>

        <Button
          onClick={save}
          disabled={saving}
          className="bg-brand hover:bg-brand-hover text-white rounded-xl font-bold h-12 px-6"
          data-testid="admin-pricing-save"
        >
          <Save className="w-4 h-4 mr-2" />
          {saving ? "Menyimpan…" : "Simpan Harga"}
        </Button>
      </div>
    </AdminLayout>
  );
}
