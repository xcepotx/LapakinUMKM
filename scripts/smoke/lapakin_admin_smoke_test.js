const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL || "https://dev.lapakin.my.id").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.TEST_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.TEST_ADMIN_PASSWORD || "";
const REQUIRE_ADMIN_SMOKE = process.env.REQUIRE_ADMIN_SMOKE === "1";

const ADMIN_ROUTES = [
  {
    path: "/admin",
    name: "Admin dashboard",
    keywords: ["admin", "Toko Paling Banyak Dikunjungi"],
  },
  {
    path: "/admin/users",
    name: "Admin users",
    keywords: ["user", "pengguna", "email", "tier", "trial", "Detail admin"],
  },
  {
    path: "/admin/shops",
    name: "Admin shops",
    keywords: ["toko", "shop", "status", "owner"],
  },
  {
    path: "/admin/products",
    name: "Admin products",
    keywords: ["produk", "product", "stok", "kategori"],
  },
  {
    path: "/admin/pricing",
    name: "Admin pricing",
    keywords: ["pricing", "tier", "harga", "paket"],
  },
];

function log(message) {
  console.log(`[admin-smoke] ${message}`);
}

function fail(message) {
  throw new Error(`[admin-smoke][ERROR] ${message}`);
}

async function fillFirst(page, selectors, value, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(value);
      log(`filled ${label}: ${selector}`);
      return true;
    }
  }
  return false;
}

async function clickFirst(page, selectors, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click();
      log(`clicked ${label}: ${selector}`);
      return true;
    }
  }
  return false;
}

async function assertNotBlank(page, route) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const bodyText = (await page.locator("body").innerText({ timeout: 10000 })).trim();
  const normalized = bodyText.replace(/\s+/g, " ");

  if (normalized.length < 40) {
    fail(`${route.name} appears blank. body length=${normalized.length}, url=${page.url()}`);
  }

  const lower = normalized.toLowerCase();
  const hasKeyword = route.keywords.some((keyword) => lower.includes(keyword.toLowerCase()));

  if (!hasKeyword) {
    fail(`${route.name} missing expected keywords ${route.keywords.join(", ")}. body="${normalized.slice(0, 220)}"`);
  }

  const blankSignals = [
    "something went wrong",
    "application error",
    "uncaught",
    "cannot read properties",
    "is not defined",
    "failed to fetch",
  ];

  const signal = blankSignals.find((item) => lower.includes(item));
  if (signal) {
    fail(`${route.name} contains error signal: ${signal}. body="${normalized.slice(0, 260)}"`);
  }

  log(`ok ${route.name}: body length=${normalized.length}`);
}

async function main() {
  console.log("=== Lapakin Admin Smoke Test ===");
  console.log(`BASE_URL: ${BASE_URL}`);

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    const message = "ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin smoke.";
    if (REQUIRE_ADMIN_SMOKE) fail(message);
    console.log(`[admin-smoke][SKIP] ${message}`);
    return;
  }

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const pageErrors = [];
  const failedRequests = [];

  context.on("page", (page) => {
    page.on("pageerror", (err) => {
      pageErrors.push(err.message || String(err));
      console.error(`[admin-smoke][PAGE ERROR] ${err.message || err}`);
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (url.includes("/api/") || url.includes(BASE_URL)) {
        failedRequests.push(`${request.method()} ${url} ${request.failure()?.errorText || ""}`);
      }
    });
  });

  const page = await context.newPage();

  page.on("response", async (response) => {
    const url = response.url();
    const status = response.status();
    if (url.startsWith(BASE_URL) && status >= 500) {
      failedRequests.push(`${status} ${url}`);
    }
  });

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await fillFirst(page, ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="email" i]'], ADMIN_EMAIL, "email");
    await fillFirst(page, ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="password" i]'], ADMIN_PASSWORD, "password");

    const clicked = await clickFirst(page, ['button[type="submit"]', 'button:has-text("Masuk")', 'button:has-text("Login")'], "login submit");
    if (!clicked) fail("login submit button not found");

    await page.waitForURL(/dashboard|admin/, { timeout: 30000 }).catch(() => {});
    log(`logged in: ${page.url()}`);

    for (const route of ADMIN_ROUTES) {
      const url = `${BASE_URL}${route.path}`;
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const status = response ? response.status() : 0;

      if (status >= 400) {
        fail(`${route.name} HTTP ${status} at ${url}`);
      }

      await assertNotBlank(page, route);
    }

    if (pageErrors.length) {
      fail(`page errors detected: ${pageErrors.slice(0, 5).join(" | ")}`);
    }

    const hardFailures = failedRequests.filter((item) => !item.includes("401") && !item.includes("favicon"));
    if (hardFailures.length) {
      fail(`failed requests detected: ${hardFailures.slice(0, 5).join(" | ")}`);
    }

    console.log("=== Admin Smoke Test Completed ===");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
