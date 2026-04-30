/**
 * Regression tests for tenant subdomain detection.
 * Run with: cd /app/frontend && node src/lib/__tests__/tenant.test.js
 */
const { detectTenantSlug } = require("../tenant.js");

const mockHost = (h) => {
  global.window = { location: { hostname: h } };
  return detectTenantSlug();
};

const cases = [
  ["warung-bu-sari.lapakin.my.id", "warung-bu-sari"],
  ["my-shop.lapakin.my.id", "my-shop"],
  ["lapakin.my.id", null],
  ["www.lapakin.my.id", null],
  ["admin.lapakin.my.id", null],
  ["api.lapakin.my.id", null],
  ["cdn.lapakin.my.id", null],
  ["foo.bar.lapakin.my.id", null],
  ["localhost", null],
  ["192.168.1.1", null],
  ["learn-indonesian-22.preview.emergentagent.com", null],
];

let pass = 0, fail = 0;
for (const [host, expected] of cases) {
  const got = mockHost(host);
  const ok = got === expected;
  console.log((ok ? "PASS" : "FAIL"), host, "->", got, "(expected", expected, ")");
  ok ? pass++ : fail++;
}
console.log(`\nResults: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
