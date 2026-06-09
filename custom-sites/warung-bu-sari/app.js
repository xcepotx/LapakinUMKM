const API_URL = "/api/public/storefront/warung-bu-sari?compact=1";
const WA_FALLBACK = "08118701518";
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

let store = null;
let products = [];
let activeCategory = "Semua";
let cart = new Map();

const el = (id) => document.getElementById(id);
const safeText = (value, fallback = "") => String(value || fallback || "").trim();
const imageOf = (item) => item?.image_data || (Array.isArray(item?.images) ? item.images[0] : "") || "";
const escapeHtml = (value) => safeText(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function waNumber(raw) {
  return String(raw || WA_FALLBACK).replace(/[^0-9]/g, "").replace(/^0/, "62");
}

function fillTemplate(template, values) {
  return safeText(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => values[key] ?? match);
}

function paymentInstruction() {
  const shop = store?.shop || {};
  if (!shop.storefront_show_payment_instruction) return "";
  return shop.storefront_payment_instruction || "";
}

function orderText() {
  const shop = store?.shop || {};
  const lines = [...cart.values()].map(({ product, qty }) => `${qty}x ${product.name} - ${money.format(product.price || 0)}`);
  const total = [...cart.values()].reduce((sum, item) => sum + (Number(item.product.price || 0) * item.qty), 0);
  const template = shop.storefront_whatsapp_checkout_template || "";
  if (template) {
    return fillTemplate(template, {
      shop_name: shop.name || "Warung Bu Sari",
      items: lines.join("\n"),
      total: money.format(total),
      customer_name: "",
      notes: "",
      payment_instruction: paymentInstruction(),
    }).trim();
  }
  return [
    `Halo ${shop.name || "Warung Bu Sari"}, saya mau pesan:`,
    "",
    lines.join("\n"),
    "",
    `Total sementara: ${money.format(total)}`,
    "Nama:",
    "Catatan:",
    paymentInstruction(),
  ].filter((line) => line !== "").join("\n");
}

function productText(product) {
  const shop = store?.shop || {};
  const template = shop.storefront_whatsapp_product_template || "";
  if (template) {
    return fillTemplate(template, {
      shop_name: shop.name || "Warung Bu Sari",
      product_name: product.name || "Menu",
      product_price: money.format(product.price || 0),
    }).trim();
  }
  return `Halo ${shop.name || "Warung Bu Sari"}, saya mau tanya ${product.name} (${money.format(product.price || 0)}). Apakah masih tersedia?`;
}

function openWhatsApp(text) {
  const number = waNumber(store?.shop?.whatsapp);
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function checkout() {
  if (!cart.size) {
    location.hash = "menu";
    return;
  }
  openWhatsApp(orderText());
}

function updateSeo(shop) {
  const seo = shop.seo || {};
  document.title = seo.title || `${shop.name || "Warung Bu Sari"} - Masakan Rumahan Jawa`;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", seo.description || shop.description || shop.tagline || "Masakan rumahan Jawa.");
}

function renderHero() {
  const shop = store.shop || {};
  updateSeo(shop);
  el("heroTitle").textContent = shop.storefront_hero_title || "Masakan Jawa yang rasanya pulang ke rumah.";
  el("heroCopy").textContent = shop.storefront_hero_subtitle || shop.tagline || shop.description || "Masakan rumahan Jawa, hangat dan murah meriah.";
  el("heroCta").textContent = shop.storefront_cta_label || "Lihat menu";
  el("storyText").textContent = shop.about || shop.description || "Masakan rumah yang diracik harian dari bahan segar.";
  const schedule = shop.schedule_status || {};
  el("factHours").textContent = schedule.is_open_now === false ? "Tutup" : (shop.hours || "Buka harian");
  el("factProducts").textContent = String(products.length || 0);
  el("factArea").textContent = (shop.service_area || shop.store_address || "Beringharjo").split(",")[0].replace(/^Jl\.\s*/i, "");
  const heroImage = shop.cover_image_url || shop.cover_image || imageOf(products[0]);
  if (heroImage) el("heroMedia").style.backgroundImage = `url(${heroImage})`;
  const wa = `https://wa.me/${waNumber(shop.whatsapp)}?text=${encodeURIComponent(`Halo ${shop.name || "Warung Bu Sari"}, saya mau tanya menu hari ini.`)}`;
  el("heroWhatsapp").href = wa;
  el("topOrder").href = wa;
  el("syncInfo").textContent = `Menu ${shop.name || "warung"} siap dipesan. Update terakhir mengikuti control panel Lapakin.`;
}

function renderFeatureStrip() {
  const shop = store.shop || {};
  const items = [];
  if (shop.order_whatsapp_enabled !== false) items.push(["Order WhatsApp", "Pesanan langsung masuk ke Bu Sari"]);
  if (shop.pickup_available) items.push(["Pickup", "Ambil di warung"]);
  if (shop.delivery_available) items.push(["Delivery", shop.service_area || "Area sekitar warung"]);
  if (shop.hours) items.push(["Jam buka", shop.hours]);
  if (shop.store_address) items.push(["Alamat", shop.store_address]);
  const strip = el("featureStrip");
  strip.innerHTML = items.map(([title, body]) => `<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div>`).join("");
  strip.hidden = items.length === 0;
}

function renderDetails() {
  const shop = store.shop || {};
  const about = shop.about || shop.description || "";
  el("aboutText").textContent = about;
  el("aboutCard").hidden = !about;

  const locationBits = [shop.store_address, shop.service_area].filter(Boolean);
  el("locationText").textContent = locationBits.join(" · ");
  el("fulfillmentBadges").innerHTML = [
    shop.pickup_available ? "Pickup tersedia" : "",
    shop.delivery_available ? "Delivery tersedia" : "",
    shop.order_whatsapp_enabled !== false ? "Order via WhatsApp" : "",
  ].filter(Boolean).map((x) => `<span>${escapeHtml(x)}</span>`).join("");
  if (shop.google_maps_url) {
    el("mapsLink").href = shop.google_maps_url;
    el("mapsLink").hidden = false;
  } else {
    el("mapsLink").hidden = true;
  }
  el("locationCard").hidden = !locationBits.length && !shop.pickup_available && !shop.delivery_available && !shop.google_maps_url;

  const payment = paymentInstruction();
  el("paymentTitle").textContent = shop.storefront_payment_method_label || "Instruksi pembayaran";
  el("paymentText").textContent = payment;
  el("paymentCard").hidden = !payment;

  const social = [];
  if (shop.instagram) social.push(["Instagram", `https://instagram.com/${shop.instagram.replace(/^@/, "")}`]);
  if (shop.tiktok) social.push(["TikTok", shop.tiktok.startsWith("http") ? shop.tiktok : `https://tiktok.com/@${shop.tiktok.replace(/^@/, "")}`]);
  if (shop.shopee) social.push(["Shopee", shop.shopee]);
  el("socialLinks").innerHTML = social.map(([label, href]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`).join("");
  el("socialCard").hidden = social.length === 0;
}

function renderFeatured() {
  const shop = store.shop || {};
  const ids = Array.isArray(shop.storefront_featured_product_ids) ? shop.storefront_featured_product_ids : [];
  const featured = ids.length ? ids.map((id) => products.find((p) => p.product_id === id)).filter(Boolean) : products.slice(0, 4);
  el("featuredTitle").textContent = shop.storefront_featured_title || "Menu Favorit Hari Ini";
  el("featuredGrid").innerHTML = featured.map((product) => `<button type="button" class="featured-item" data-featured-add="${product.product_id}">
    <span>${escapeHtml(product.name)}</span>
    <strong>${money.format(product.price || 0)}</strong>
  </button>`).join("");
  el("featuredGrid").querySelectorAll("[data-featured-add]").forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.featuredAdd)));
  el("featuredSection").hidden = featured.length === 0;
}

function renderFilters() {
  const categories = ["Semua", ...new Set(products.map((p) => p.category_name || p.category).filter(Boolean))];
  el("categoryFilters").innerHTML = categories.map((cat) => `<button type="button" class="${cat === activeCategory ? "active" : ""}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join("");
  el("categoryFilters").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      renderMenu();
      renderFilters();
    });
  });
}

function renderMenu() {
  const shown = activeCategory === "Semua" ? products : products.filter((p) => (p.category_name || p.category) === activeCategory);
  el("menuGrid").innerHTML = shown.map((product) => {
    const img = imageOf(product);
    const desc = safeText(product.description, "Menu favorit dapur Bu Sari, dimasak hangat dan siap dipesan hari ini.");
    return `<article class="menu-card">
      <div class="menu-image" style="${img ? `background-image:url(${img})` : ""}">
        <span class="menu-badge">${escapeHtml(product.category_name || product.category || "Menu")}</span>
      </div>
      <div class="menu-body">
        <h3>${escapeHtml(product.name || "Menu Warung")}</h3>
        <p>${escapeHtml(desc)}</p>
        <div class="price-row">
          <strong>${money.format(Number(product.price || 0))}</strong>
          <button type="button" data-add="${escapeHtml(product.product_id)}">Tambah</button>
        </div>
        <button class="ask-button" type="button" data-chat="${escapeHtml(product.product_id)}">Tanya menu ini</button>
      </div>
    </article>`;
  }).join("");
  el("menuGrid").querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.add)));
  el("menuGrid").querySelectorAll("[data-chat]").forEach((button) => button.addEventListener("click", () => {
    const product = products.find((item) => item.product_id === button.dataset.chat);
    if (product) openWhatsApp(productText(product));
  }));
}

function addToCart(productId) {
  const product = products.find((item) => item.product_id === productId);
  if (!product) return;
  const current = cart.get(productId) || { product, qty: 0 };
  current.qty += 1;
  cart.set(productId, current);
  renderCart();
}

function changeQty(productId, delta) {
  const current = cart.get(productId);
  if (!current) return;
  current.qty += delta;
  if (current.qty <= 0) cart.delete(productId);
  renderCart();
}

function renderCart() {
  const items = [...cart.values()];
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const total = items.reduce((sum, item) => sum + Number(item.product.price || 0) * item.qty, 0);
  el("cartCount").textContent = String(count);
  el("orderTotal").textContent = money.format(total);
  el("panelTotal").textContent = money.format(total);
  el("cartItems").innerHTML = items.length ? items.map(({ product, qty }) => `<div class="cart-item">
    <div><strong>${escapeHtml(product.name)}</strong><span>${money.format(product.price || 0)} per item</span></div>
    <div class="qty"><button type="button" data-minus="${escapeHtml(product.product_id)}">-</button><strong>${qty}</strong><button type="button" data-plus="${escapeHtml(product.product_id)}">+</button></div>
  </div>`).join("") : `<p style="color:#71584c">Keranjang masih kosong. Pilih menu dulu.</p>`;
  el("cartItems").querySelectorAll("[data-minus]").forEach((btn) => btn.addEventListener("click", () => changeQty(btn.dataset.minus, -1)));
  el("cartItems").querySelectorAll("[data-plus]").forEach((btn) => btn.addEventListener("click", () => changeQty(btn.dataset.plus, 1)));
}

async function init() {
  try {
    const response = await fetch(API_URL, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    store = await response.json();
    products = (store.products || []).filter((p) => p.availability_status !== "hidden");
    renderHero();
    renderFeatureStrip();
    renderFeatured();
    renderDetails();
    renderFilters();
    renderMenu();
    renderCart();
    el("loadingState").hidden = true;
    el("menuGrid").hidden = false;
  } catch (error) {
    el("loadingState").innerHTML = `<p style="grid-column:1/-1;color:#7a4a3a;font-weight:800">Menu belum bisa dimuat. Silakan chat Bu Sari lewat WhatsApp.</p>`;
  }
}

el("cartToggle").addEventListener("click", () => { el("cartPanel").hidden = false; });
el("cartClose").addEventListener("click", () => { el("cartPanel").hidden = true; });
el("checkoutButton").addEventListener("click", checkout);
el("panelCheckout").addEventListener("click", checkout);
init();
