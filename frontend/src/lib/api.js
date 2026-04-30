import axios from "axios";

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
