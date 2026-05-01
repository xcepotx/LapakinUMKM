/**
 * Detect tenant subdomain on the frontend.
 *
 * Returns the slug if user visits `<slug>.lapakin.my.id`, else null.
 * Reserved subdomains (www, admin, api, cdn, static) are ignored.
 */
const RESERVED = new Set(["www", "admin", "api", "cdn", "static", "assets", "localhost", "dev", "staging", "preview"]);
const ROOT_DOMAIN = "lapakin.my.id";

export function detectTenantSlug() {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return null;
  }
  // Must end in the root domain
  if (!host.endsWith(ROOT_DOMAIN)) return null;
  const prefix = host.slice(0, -ROOT_DOMAIN.length).replace(/\.$/, "");
  if (!prefix) return null;                       // apex domain (lapakin.my.id)
  if (prefix.includes(".")) return null;          // multi-level, not a tenant
  if (RESERVED.has(prefix)) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/i.test(prefix)) return null;
  return prefix.toLowerCase();
}

export function isOnTenantSubdomain() {
  return !!detectTenantSlug();
}
