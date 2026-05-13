// LAPAKIN_ERROR_CENTER_PHASE2_FRONTEND_LOGGER_V1
// Lightweight frontend error logger for Lapakin Error Center.
// Tidak memakai axios supaya tidak membuat loop saat API error.

const ERROR_CENTER_ENDPOINT = "/api/errors/client";
const MAX_STACK = 6000;
const MAX_MESSAGE = 1200;

const SENSITIVE_KEYS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "secret",
  "api_key",
  "apikey",
  "credential",
  "card",
  "cvv",
];

const seenRecently = new Map();

function cleanText(value, limit = MAX_MESSAGE) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trim()}…` : text;
}

function truncateStack(value) {
  const text = String(value || "");
  return text.length > MAX_STACK ? text.slice(-MAX_STACK) : text;
}

function redact(value, depth = 0) {
  if (depth > 5) return "[max-depth]";

  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => redact(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const out = {};

    Object.keys(value).slice(0, 80).forEach((key) => {
      const lower = key.toLowerCase();

      if (SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive))) {
        out[key] = "[redacted]";
      } else {
        out[key] = redact(value[key], depth + 1);
      }
    });

    return out;
  }

  if (typeof value === "string" && value.length > 2000) {
    return `${value.slice(0, 2000)}…`;
  }

  return value;
}

function getFeatureFromPath(path) {
  const value = String(path || "");

  if (value.includes("/content-studio")) return "content_studio";
  if (value.includes("/admin")) return "admin";
  if (value.includes("/dashboard")) return "dashboard";
  if (value.includes("/products")) return "products";
  if (value.includes("/analytics")) return "analytics";
  if (value.includes("/payment") || value.includes("/billing")) return "payment";
  if (value.includes("/toko/") || value.includes("/storefront")) return "storefront";
  if (value.includes("/auth") || value.includes("/login")) return "auth";

  return "frontend";
}

function makeFingerprint(payload) {
  return [
    payload.source || "frontend",
    payload.severity || "error",
    payload.path || "",
    cleanText(payload.message, 240),
    cleanText((payload.stack || "").split("\n").find(Boolean) || "", 240),
  ].join("|");
}

function shouldSkipPayload(payload) {
  const message = String(payload?.message || "").toLowerCase();
  const path = String(payload?.path || "");

  if (!message && !payload?.stack) return true;
  if (path.includes("/api/errors/client")) return true;

  // Common browser/plugin noise.
  if (message.includes("resizeobserver loop limit exceeded")) return true;
  if (message.includes("script error") && !payload?.stack) return true;
  if (message.includes("network error") && !navigator.onLine) return true;

  const fingerprint = makeFingerprint(payload);
  const now = Date.now();
  const last = seenRecently.get(fingerprint) || 0;

  if (now - last < 15000) return true;

  seenRecently.set(fingerprint, now);

  // Keep memory small.
  if (seenRecently.size > 80) {
    const cutoff = now - 60000;
    Array.from(seenRecently.entries()).forEach(([key, ts]) => {
      if (ts < cutoff) seenRecently.delete(key);
    });
  }

  return false;
}

function safePost(payload) {
  if (typeof window === "undefined") return;
  if (shouldSkipPayload(payload)) return;

  const body = JSON.stringify(redact({
    source: "frontend",
    severity: payload.severity || "error",
    message: cleanText(payload.message || "Frontend error"),
    stack: truncateStack(payload.stack || ""),
    path: payload.path || window.location.pathname,
    method: payload.method || "",
    status_code: payload.status_code,
    feature: payload.feature || getFeatureFromPath(payload.path || window.location.pathname),
    browser: navigator.userAgent || "",
    component: payload.component || "",
    release: window.__LAPAKIN_RELEASE__ || "",
    metadata: {
      url: window.location.href,
      title: document.title,
      online: navigator.onLine,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      ...redact(payload.metadata || {}),
    },
  }));

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ERROR_CENTER_ENDPOINT, blob)) return;
    }
  } catch {
    // fallback fetch below
  }

  try {
    fetch(ERROR_CENTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "include",
    }).catch(() => {});
  } catch {
    // Logging must never break app.
  }
}

export function logFrontendErrorToErrorCenter(error, extra = {}) {
  const err = error instanceof Error ? error : null;

  safePost({
    severity: extra.severity || "error",
    message:
      extra.message ||
      (err ? `${err.name || "Error"}: ${err.message || ""}` : cleanText(error || "Frontend error")),
    stack: extra.stack || (err ? err.stack : ""),
    path: extra.path || window.location.pathname,
    feature: extra.feature,
    component: extra.component,
    metadata: extra.metadata,
  });
}

export function logApiErrorToErrorCenter(error) {
  try {
    const config = error?.config || {};
    const response = error?.response || {};
    const status = response?.status;
    const url = config?.url || "";
    const method = String(config?.method || "").toUpperCase();

    if (String(url).includes("/errors/client")) return;

    // Jangan spam untuk auth normal.
    if (status === 401 && (String(url).includes("/auth/me") || String(url).includes("/admin/error-logs"))) {
      return;
    }

    // 4xx user-input biasa tidak perlu masuk error center kecuali 429/402 penting.
    if (status && status < 500 && ![402, 408, 409, 429].includes(status)) {
      return;
    }

    safePost({
      severity: status >= 500 ? "error" : "warning",
      message: `API ${status || "NETWORK"} ${method || "GET"} ${url}`,
      stack: error?.stack || "",
      path: url,
      method,
      status_code: status || null,
      feature: getFeatureFromPath(url),
      metadata: {
        api_error: {
          baseURL: config?.baseURL || "",
          timeout: config?.timeout,
          status,
          statusText: response?.statusText,
          responseData: response?.data,
          params: config?.params,
          data: config?.data,
        },
      },
    });
  } catch {
    // ignore
  }
}

function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return;
  if (window.__LAPAKIN_ERROR_CENTER_INSTALLED__) return;

  window.__LAPAKIN_ERROR_CENTER_INSTALLED__ = true;

  window.addEventListener("error", (event) => {
    const target = event.target;

    // Resource loading error: script/css/img chunk gagal load.
    if (target && target !== window && target.tagName) {
      const tag = String(target.tagName || "").toLowerCase();
      const url = target.src || target.href || "";

      if (url) {
        safePost({
          severity: tag === "script" ? "error" : "warning",
          message: `Resource load failed: ${tag}`,
          path: window.location.pathname,
          feature: "frontend",
          metadata: {
            resource: {
              tag,
              url,
            },
          },
        });
      }

      return;
    }

    safePost({
      severity: "error",
      message: event.message || "Window error",
      stack: event.error?.stack || "",
      path: window.location.pathname,
      feature: getFeatureFromPath(window.location.pathname),
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const isError = reason instanceof Error;

    safePost({
      severity: "error",
      message: isError ? `${reason.name || "Error"}: ${reason.message || ""}` : `Unhandled rejection: ${cleanText(reason)}`,
      stack: isError ? reason.stack : "",
      path: window.location.pathname,
      feature: getFeatureFromPath(window.location.pathname),
      metadata: {
        reason: isError ? undefined : reason,
      },
    });
  });
}

installGlobalErrorHandlers();

export default {
  logFrontendErrorToErrorCenter,
  logApiErrorToErrorCenter,
};
