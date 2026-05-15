import axios from "axios";

import { logApiErrorToErrorCenter } from "./errorLogger";
// When user is on a tenant subdomain (<slug>.lapakin.my.id), keep API calls
// same-origin so the session cookie + nginx subdomain block is used. Falls
// back to REACT_APP_BACKEND_URL (main domain or preview) otherwise.
function resolveBackendUrl() {
  const envUrl = process.env.REACT_APP_BACKEND_URL || "";
  if (typeof window === "undefined") return envUrl;
  const host = window.location.hostname || "";
  // Tenant subdomain heuristic: ends with .lapakin.my.id and not www/admin/etc.
  // Using same-origin avoids CORS + wrong-host cookie scope.
  if (/\.lapakin\.my\.id$/i.test(host) && !/^(www|admin|api|cdn|static)\./i.test(host)) {
    return window.location.origin;
  }
  return envUrl;
}

const BACKEND_URL = resolveBackendUrl();
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});



// LAPAKIN_ERROR_CENTER_PHASE2_FRONTEND_LOGGER_V1
// Capture failed API calls into Error Center without blocking the app.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    try {
      logApiErrorToErrorCenter(error);
    } catch {
      // Never block the original API error flow.
    }

    return Promise.reject(error);
  }
);


// Phase E: normalize shop limit errors so every page shows a clean user message.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const headers = error?.response?.headers || {};
    const rawCode =
      headers["x-lapakin-error-code"] ||
      headers["X-Lapakin-Error-Code"] ||
      "";

    const rawDetail = error?.response?.data?.detail;
    const detailText =
      typeof rawDetail === "string"
        ? rawDetail
        : rawDetail?.message || rawDetail?.detail || "";

    const isShopLimitReached =
      rawCode === "SHOP_LIMIT_REACHED" ||
      detailText.startsWith("SHOP_LIMIT_REACHED");

    if (isShopLimitReached) {
      const cleanMessage = detailText.replace(/^SHOP_LIMIT_REACHED:\s*/i, "").trim() ||
        "Batas toko paket kamu sudah penuh. Upgrade untuk tambah toko.";

      error.lapakinErrorCode = "SHOP_LIMIT_REACHED";
      error.lapakinUserMessage = cleanMessage;

      if (error.response) {
        error.response.data = {
          ...(error.response.data || {}),
          detail: cleanMessage,
          code: "SHOP_LIMIT_REACHED",
        };
      }
    }

    return Promise.reject(error);
  }
);


export default api;

export function formatApiError(detail) {
  if (detail == null) return "Terjadi kesalahan. Coba lagi.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function rupiah(n) {
  if (n == null || n === "") return "Rp 0";
  const num = typeof n === "number" ? n : parseInt(n, 10) || 0;
  return "Rp " + num.toLocaleString("id-ID");
}
