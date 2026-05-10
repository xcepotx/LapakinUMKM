/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL || "https://dev.lapakin.my.id/toko/warung-bu-sari";
const EXPECTED_VARIANT = process.env.EXPECTED_VARIANT || "food_warm_menu";
const EXPECTED_CLASS = process.env.EXPECTED_CLASS || "ltr-business-food-warm";
const EXPECTED_MODE = process.env.EXPECTED_MODE || "food_menu";
const EXPECTED_STYLE = process.env.EXPECTED_STYLE || "playful";
const ARTIFACT_DIR =
  process.env.SMOKE_ARTIFACT_DIR ||
  path.join("/tmp", `lapakin-smoke-storefront-variant-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function slugFromBaseUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const tokoIndex = parts.indexOf("toko");
    return tokoIndex >= 0 ? parts[tokoIndex + 1] : parts[parts.length - 1];
  } catch {
    return "";
  }
}

(async () => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    const slug = slugFromBaseUrl(BASE_URL);

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const publicPayload = await page.evaluate(async (shopSlug) => {
      const res = await fetch(`/api/shops/by-slug/${shopSlug}`);
      return res.json();
    }, slug);

    const dom = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="storefront-template-renderer"]');
      const eyebrow = document.querySelector('[data-testid="storefront-business-variant-eyebrow"]');

      return {
        rootClass: root?.className || "",
        businessVariant: root?.getAttribute("data-business-variant") || "",
        eyebrow: eyebrow?.innerText || "",
        bodyText: document.body.innerText || "",
      };
    });

    const shop = publicPayload.shop || {};

    const result = {
      ok: true,
      baseUrl: BASE_URL,
      slug,
      expected: {
        variant: EXPECTED_VARIANT,
        className: EXPECTED_CLASS,
        mode: EXPECTED_MODE,
        style: EXPECTED_STYLE,
      },
      payload: {
        storefront_layout_variant: shop.storefront_layout_variant,
        storefront_renderer: shop.storefront_renderer,
        storefront_mode: shop.storefront_mode,
        storefront_style: shop.storefront_style,
      },
      dom,
      checks: {
        payloadVariant: shop.storefront_layout_variant === EXPECTED_VARIANT,
        payloadRendererTemplate: shop.storefront_renderer === "template",
        payloadMode: shop.storefront_mode === EXPECTED_MODE,
        payloadStyle: shop.storefront_style === EXPECTED_STYLE,
        domVariant: dom.businessVariant === EXPECTED_VARIANT,
        domClass: dom.rootClass.includes(EXPECTED_CLASS),
        cartStillPresent: dom.bodyText.includes("Keranjang") || dom.bodyText.includes("Pesan"),
        paymentStillNotMainVisible: !dom.bodyText.includes("Test QRIS dan transfer BCA."),
      },
      artifactDir: ARTIFACT_DIR,
    };

    fs.writeFileSync(path.join(ARTIFACT_DIR, "result.json"), JSON.stringify(result, null, 2));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "storefront-variant.png"), fullPage: true });

    console.log(JSON.stringify(result, null, 2));

    for (const [key, value] of Object.entries(result.checks)) {
      assert(value, `Check failed: ${key}`);
    }

    console.log("");
    console.log(`Smoke PASS. Artifacts: ${ARTIFACT_DIR}`);
  } catch (error) {
    const result = {
      ok: false,
      baseUrl: BASE_URL,
      artifactDir: ARTIFACT_DIR,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };

    fs.writeFileSync(path.join(ARTIFACT_DIR, "result.json"), JSON.stringify(result, null, 2));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "error.png"), fullPage: true }).catch(() => {});

    console.error(JSON.stringify(result, null, 2));
    console.error("");
    console.error(`Smoke FAIL. Artifacts: ${ARTIFACT_DIR}`);

    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
