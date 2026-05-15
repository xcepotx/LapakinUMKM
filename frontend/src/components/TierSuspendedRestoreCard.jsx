import { useEffect, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";

export default function TierSuspendedRestoreCard() {
  const [restoreState, setRestoreState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyShopId, setBusyShopId] = useState("");

  const loadRestoreState = async () => {
    setLoading(true);

    try {
      const response = await api.get("/shops/tier-suspended-restore");
      setRestoreState(response.data || null);
    } catch {
      setRestoreState(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRestoreState();
  }, []);

  const restorableShops = restoreState?.restorable_shops || [];
  const summary = restoreState?.summary || {};
  const tier = restoreState?.tier || {};
  const canRestore = restoreState?.can_restore === true;

  const restoreShop = async (shopId) => {
    if (!shopId) return;

    setBusyShopId(shopId);

    try {
      await api.post("/shops/tier-suspended-restore", {
        shop_ids: [shopId],
        restore_all: false,
      });

      toast.success("Toko berhasil diaktifkan kembali");
      await loadRestoreState();
      window.location.reload();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal mengaktifkan toko");
    } finally {
      setBusyShopId("");
    }
  };

  if (loading || !restorableShops.length) {
    return null;
  }

  return (
    <section
      className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/40 px-4 py-3 shadow-sm"
      data-testid="tier-suspended-restore-card"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">
            Toko ekstra aman
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-base font-black text-brand-ink">
              {restorableShops.length} toko bisa aktif lagi setelah upgrade
            </h2>

            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-amber-800 ring-1 ring-amber-200">
              {canRestore ? "Siap diaktifkan" : "Menunggu upgrade"}
            </span>
          </div>

          <p className="mt-1 text-xs font-semibold leading-relaxed text-brand-mute">
            Data toko tetap tersimpan. Aktifkan kembali saat paket sudah aktif.
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:w-[420px]">
          {restorableShops.map((shop) => {
            const busy = busyShopId === shop.shop_id;

            return (
              <div
                key={shop.shop_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2"
                data-testid={`restorable-shop-${shop.shop_id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate font-heading text-sm font-black text-brand-ink">
                      {shop.name || "Toko"}
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase text-slate-600">
                      tertangguhkan
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] font-bold text-brand-mute">
                    /toko/{shop.slug || "-"} · {shop.product_count || 0} produk
                  </div>
                </div>

                {canRestore ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => restoreShop(shop.shop_id)}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-xl bg-brand px-3 text-[11px] font-black text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid={`restore-shop-${shop.shop_id}`}
                  >
                    {busy ? "..." : "Aktifkan"}
                  </button>
                ) : (
                  <div className="shrink-0 rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] font-black text-amber-900 ring-1 ring-amber-100">
                    Upgrade dulu
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 text-[10px] font-bold text-brand-mute">
        Plan: {tier.plan || "free"} · Status: {tier.status || "unknown"} · Slot tersisa: {summary.remaining_slots ?? 0}
      </div>
    </section>
  );
}

/* LAPAKIN_COMPACT_BILLING_NOTIFICATION_STACK_V1 */
