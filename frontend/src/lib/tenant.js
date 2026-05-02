/**
 * Detect tenant subdomain on the frontend.
 *
 * Production:
 * - lapakin.my.id                    => app utama
 * - warung-bu-sari.lapakin.my.id     => tenant storefront
 *
 * Development VPS:
 * - dev.lapakin.my.id                => app utama dev
 * - warung-bu-sari.dev.lapakin.my.id => tenant storefront dev
 */

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "cdn",
  "static",
  "dev",
  "staging",
  "stage",
]);

const BASE_DOMAINS = [
  process.env.REACT_APP_BASE_DOMAIN,
  "dev.lapakin.my.id",
  "lapakin.my.id",
]
  .filter(Boolean)
  .map((domain) => domain.toLowerCase())
  .sort((a, b) => b.length - a.length);

function normalizeHost(hostname) {
  return (hostname || "")
    .split(":")[0]
    .toLowerCase()
    .trim();
}

function detectTenantSlug(hostname) {
  const host =
    normalizeHost(hostname) ||
    normalizeHost(typeof window !== "undefined" ? window.location.hostname : "");

  if (!host) return null;

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost")
  ) {
    return null;
  }

  const baseDomain = BASE_DOMAINS.find(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );

  if (!baseDomain) return null;

  // Base domain bukan tenant.
  // Contoh: lapakin.my.id dan dev.lapakin.my.id
  if (host === baseDomain || host === `www.${baseDomain}`) {
    return null;
  }

  const prefix = host.slice(0, -(baseDomain.length + 1));

  if (!prefix) return null;

  // Untuk format tenant normal:
  // warung-bu-sari.lapakin.my.id => warung-bu-sari
  //
  // Untuk format dev:
  // warung-bu-sari.dev.lapakin.my.id => warung-bu-sari
  //
  // Kalau lebih dari 1 level sebelum base domain, ambil paling kiri.
  const slug = prefix.split(".")[0];

  if (!slug || RESERVED_SUBDOMAINS.has(slug)) {
    return null;
  }

  return slug;
}

function isTenantHost(hostname) {
  return Boolean(detectTenantSlug(hostname));
}

module.exports = {
  detectTenantSlug,
  isTenantHost,
};
