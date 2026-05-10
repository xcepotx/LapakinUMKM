/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE_URL =
  process.env.BASE_URL ||
  process.env.SMOKE_STOREFRONT_URL ||
  "https://dev.lapakin.my.id/toko/warung-bu-sari";

const PRODUCTS = (process.env.SMOKE_PRODUCTS || "Gudeg Special,Nasi Rames Komplit")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const EXPECTED_TOTAL_TEXT = process.env.SMOKE_EXPECTED_TOTAL || "40.000";
const CUSTOMER_NAME = process.env.SMOKE_CUSTOMER_NAME || "Budi Smoke Test";
const CUSTOMER_NOTES = process.env.SMOKE_CUSTOMER_NOTES || "Catatan smoke test checkout.";
const ARTIFACT_DIR =
  process.env.SMOKE_ARTIFACT_DIR ||
  path.join("/tmp", `lapakin-smoke-cart-checkout-${Date.now()}`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function decodeWhatsappText(href) {
  if (!href || href === "#") return "";

  try {
    return new URL(href).searchParams.get("text") || "";
  } catch {
    return "";
  }
}

async function saveScreenshot(page, name) {
  const filePath = path.join(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false }).catch(() => {});
  return filePath;
}

async function clickAddByProduct(page, productName) {
  const selectors = [
    `button[aria-label*="Tambah ${productName}"][aria-label*="keranjang"]`,
    `button[aria-label*="${productName}"][aria-label*="keranjang"]`,
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    const count = await button.count().catch(() => 0);

    if (count > 0) {
      await button.waitFor({ timeout: 15000 });
      await button.scrollIntoViewIfNeeded().catch(() => {});
      await button.click({ timeout: 10000 });
      await page.waitForTimeout(450);
      return;
    }
  }

  throw new Error(`Tidak menemukan tombol tambah keranjang untuk produk: ${productName}`);
}

async function openCart(page) {
  const floatingCart = page.locator('[data-testid="storefront-template-floating-cart"]').first();

  if (await floatingCart.isVisible().catch(() => false)) {
    await floatingCart.click({ timeout: 10000 });
    return "floating-cart";
  }

  const mobileCart = page.locator('.ltr-mobile-sticky-order button:has-text("Keranjang")').first();

  if (await mobileCart.isVisible().catch(() => false)) {
    await mobileCart.click({ timeout: 10000 });
    return "mobile-sticky-cart";
  }

  await saveScreenshot(page, "open-cart-not-visible");
  throw new Error("Tidak menemukan tombol keranjang yang visible.");
}

async function preparePage(browser, scenarioName) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.addInitScript(() => {
    window.__lapakinOpenCalls = [];
    window.open = (url, target, features) => {
      window.__lapakinOpenCalls.push({
        type: "window.open",
        url: String(url || ""),
        target,
        features,
      });
      return { closed: false, focus() {} };
    };
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

  await page.evaluate(() => {
    const keys = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith("lapakin_cart_")) {
        keys.push(key);
      }
    }

    keys.forEach((key) => localStorage.removeItem(key));
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await saveScreenshot(page, `${scenarioName}-loaded`);

  return page;
}

async function addProductsAndOpenCart(page, scenarioName) {
  for (const productName of PRODUCTS) {
    await clickAddByProduct(page, productName);
  }

  const urlBeforeOpenCart = page.url();
  const openMethod = await openCart(page);
  await page.waitForTimeout(700);

  const drawer = page.locator('[data-testid="storefront-template-cart-drawer"]');
  await drawer.waitFor({ state: "visible", timeout: 10000 });

  const drawerInfo = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="storefront-template-cart-drawer"]');
    const backdrop = document.querySelector(".ltr-cart-backdrop");
    const drawerNode = document.querySelector(".ltr-cart-drawer");

    function read(el) {
      if (!el) return null;

      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);

      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        position: style.position,
      };
    }

    return {
      root: read(root),
      backdrop: read(backdrop),
      drawer: read(drawerNode),
    };
  });

  const cartText = await drawer.innerText();

  assert(page.url() === urlBeforeOpenCart, "URL berubah saat membuka cart drawer.");
  assert(drawerInfo.drawer, "Cart drawer tidak ditemukan.");
  assert(drawerInfo.drawer.width <= 560, `Cart drawer terlalu lebar: ${drawerInfo.drawer.width}px.`);
  assert(
    !String(drawerInfo.backdrop?.backgroundImage || "").includes("linear-gradient"),
    `Backdrop kembali memakai gradient: ${drawerInfo.backdrop?.backgroundImage}`
  );

  for (const productName of PRODUCTS) {
    assert(cartText.includes(productName), `Cart drawer tidak memuat produk: ${productName}`);
  }

  assert(cartText.includes(EXPECTED_TOTAL_TEXT), `Cart drawer tidak memuat expected total: ${EXPECTED_TOTAL_TEXT}`);

  await saveScreenshot(page, `${scenarioName}-cart-open`);

  return {
    openMethod,
    cartText,
    drawerInfo,
  };
}

async function assertCheckoutModal(page, scenarioName) {
  await page.locator('[data-testid="storefront-checkout-whatsapp-link"]').click({ timeout: 10000 });
  await page.waitForTimeout(700);

  const modal = page.locator('[data-testid="storefront-lead-capture-modal"]');
  await modal.waitFor({ state: "visible", timeout: 10000 });

  const modalText = await modal.innerText();

  assert(modalText.toLowerCase().includes("ringkasan pesanan"), "Modal tidak memuat Ringkasan Pesanan.");
  assert(!modalText.includes("Pengaturan dasar untuk kontak dan metode order"), "Intro box masih muncul di checkout cart.");
  assert(!modalText.includes("Biar penjual lebih mudah follow up pesanan kamu"), "Helper text masih muncul di checkout cart.");

  for (const productName of PRODUCTS) {
    assert(modalText.includes(productName), `Modal tidak memuat produk: ${productName}`);
  }

  assert(modalText.includes(EXPECTED_TOTAL_TEXT), `Modal tidak memuat expected total: ${EXPECTED_TOTAL_TEXT}`);

  await saveScreenshot(page, `${scenarioName}-modal`);

  return modalText;
}

async function runContinueScenario(browser) {
  const page = await preparePage(browser, "continue");

  try {
    await addProductsAndOpenCart(page, "continue");
    await assertCheckoutModal(page, "continue");

    const nameInput = page.locator('input[placeholder="Nama kamu"]');

    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(CUSTOMER_NAME);
    }

    const notesInput = page.locator('textarea[placeholder*="Contoh"]');

    if (await notesInput.isVisible().catch(() => false)) {
      await notesInput.fill(CUSTOMER_NOTES);
    }

    await page.locator('[data-testid="lead-capture-continue-whatsapp"]').click({ timeout: 10000 });
    await page.waitForTimeout(1000);

    const openCalls = await page.evaluate(() => window.__lapakinOpenCalls || []);
    assert(openCalls.length === 1, `Lanjut WhatsApp harus open 1x, tapi terdeteksi ${openCalls.length}x.`);

    const openedUrl = openCalls[0]?.url || "";
    const whatsappText = decodeWhatsappText(openedUrl);

    for (const productName of PRODUCTS) {
      assert(whatsappText.includes(productName), `Text WA Lanjut tidak memuat produk: ${productName}`);
    }

    assert(whatsappText.includes(EXPECTED_TOTAL_TEXT), `Text WA Lanjut tidak memuat total: ${EXPECTED_TOTAL_TEXT}`);
    assert(whatsappText.includes(CUSTOMER_NAME), "Text WA Lanjut tidak memuat nama customer.");
    assert(whatsappText.includes(CUSTOMER_NOTES), "Text WA Lanjut tidak memuat catatan customer.");

    return {
      scenario: "continue",
      openCallCount: openCalls.length,
      openedUrl,
      whatsappText,
    };
  } catch (error) {
    await saveScreenshot(page, "continue-error");
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}

async function runSkipScenario(browser) {
  const page = await preparePage(browser, "skip");

  try {
    await addProductsAndOpenCart(page, "skip");
    await assertCheckoutModal(page, "skip");

    await page.locator('[data-testid="lead-capture-skip"], button:has-text("Lewati")').first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);

    const openCalls = await page.evaluate(() => window.__lapakinOpenCalls || []);
    assert(openCalls.length === 1, `Lewati harus open 1x, tapi terdeteksi ${openCalls.length}x.`);

    const openedUrl = openCalls[0]?.url || "";
    const whatsappText = decodeWhatsappText(openedUrl);

    for (const productName of PRODUCTS) {
      assert(whatsappText.includes(productName), `Text WA Lewati tidak memuat produk: ${productName}`);
    }

    assert(whatsappText.includes(EXPECTED_TOTAL_TEXT), `Text WA Lewati tidak memuat total: ${EXPECTED_TOTAL_TEXT}`);

    return {
      scenario: "skip",
      openCallCount: openCalls.length,
      openedUrl,
      whatsappText,
    };
  } catch (error) {
    await saveScreenshot(page, "skip-error");
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const startedAt = new Date().toISOString();

  try {
    const continueResult = await runContinueScenario(browser);
    const skipResult = await runSkipScenario(browser);

    const result = {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      products: PRODUCTS,
      expectedTotalText: EXPECTED_TOTAL_TEXT,
      artifactDir: ARTIFACT_DIR,
      results: [continueResult, skipResult],
    };

    fs.writeFileSync(path.join(ARTIFACT_DIR, "result.json"), JSON.stringify(result, null, 2));

    console.log(JSON.stringify(result, null, 2));
    console.log("");
    console.log(`Smoke PASS. Artifacts: ${ARTIFACT_DIR}`);
  } catch (error) {
    const result = {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      products: PRODUCTS,
      expectedTotalText: EXPECTED_TOTAL_TEXT,
      artifactDir: ARTIFACT_DIR,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };

    fs.writeFileSync(path.join(ARTIFACT_DIR, "result.json"), JSON.stringify(result, null, 2));

    console.error(JSON.stringify(result, null, 2));
    console.error("");
    console.error(`Smoke FAIL. Artifacts: ${ARTIFACT_DIR}`);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
