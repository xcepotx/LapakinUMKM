/**
 * Midtrans Snap loader + checkout helper.
 *
 * Loads Snap.js dynamically (correct sandbox/production URL + client key)
 * and exposes `openSnapCheckout()` to kick off the pay flow.
 */
import api from "@/lib/api";

let _snapPromise = null;

export async function loadSnap() {
  if (window.snap) return { ok: true, cfg: window.__snapCfg };
  if (_snapPromise) return _snapPromise;

  _snapPromise = (async () => {
    const { data: cfg } = await api.get("/payment/config");
    if (!cfg.configured) {
      return { ok: false, cfg, error: "Pembayaran belum aktif. Admin belum mengonfigurasi Midtrans." };
    }
    window.__snapCfg = cfg;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = cfg.snap_url;
      s.setAttribute("data-client-key", cfg.client_key);
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Gagal memuat Snap.js"));
      document.head.appendChild(s);
    });
    return { ok: true, cfg };
  })();

  return _snapPromise;
}

/**
 * Create a transaction + open Snap popup.
 * @param {string} planId  "pro_monthly" | "pro_yearly" | "business_monthly" | "business_yearly"
 * @param {object} handlers  { onSuccess, onPending, onError, onClose }
 * @returns {Promise<{order_id: string}>}
 */
export async function openSnapCheckout(planId, handlers = {}) {
  const loaded = await loadSnap();
  if (!loaded.ok) throw new Error(loaded.error || "Snap tidak tersedia");

  const { data } = await api.post("/payment/create-transaction", { plan_id: planId });
  const { snap_token, order_id } = data;

  window.snap.pay(snap_token, {
    onSuccess: (r) => handlers.onSuccess && handlers.onSuccess(r, order_id),
    onPending: (r) => handlers.onPending && handlers.onPending(r, order_id),
    onError:   (r) => handlers.onError   && handlers.onError(r, order_id),
    onClose:   ()  => handlers.onClose   && handlers.onClose(order_id),
  });

  return { order_id };
}

/**
 * Poll /payment/status/{order_id} every 4s up to ~3min.
 * Resolves with final status when status != "pending" or maxAttempts reached.
 */
export async function pollPaymentStatus(orderId, { interval = 4000, maxAttempts = 45 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { data } = await api.get(`/payment/status/${orderId}`);
      if (data.status && data.status !== "pending") return data;
    } catch {
      // ignore transient errors, keep polling
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return { order_id: orderId, status: "pending", timeout: true };
}
