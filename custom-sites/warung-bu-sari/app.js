const API_URL = "/api/public/storefront/warung-bu-sari";
const WA_FALLBACK = "08118701518";
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

let store = null;
let products = [];
let activeCategory = "Semua";
let cart = new Map();

const el = (id) => document.getElementById(id);
const safeText = (value, fallback = "") => String(value || fallback || "").trim();
const imageOf = (item) => item?.image_data || (Array.isArray(item?.images) ? item.images[0] : "") || "";

function waNumber(raw) {
  return String(raw || WA_FALLBACK).replace(/[^0-9]/g, "").replace(/^0/, "62");
}

function orderText() {
  const lines = [...cart.values()].map(({ product, qty }) => `${qty}x ${product.name} - ${money.format(product.price || 0)}`);
  const total = [...cart.values()].reduce((sum, item) => sum + (Number(item.product.price || 0) * item.qty), 0);
  return [
    `Halo ${store?.shop?.name || "Warung Bu Sari"}, saya mau pesan:`,
    "",
    lines.join("\n"),
    "",
    `Total sementara: ${money.format(total)}`,
    "Nama:",
    "Catatan:",
  ].join("\n");
}

function checkout() {
  if (!cart.size) {
    location.hash = "menu";
    return;
  }
  const number = waNumber(store?.shop?.whatsapp);
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(orderText())}`, "_blank", "noopener");
}

function renderHero() {
  const shop = store.shop || {};
  document.title = `${shop.name || "Warung Bu Sari"} - Masakan Rumahan Jawa`;
  el("heroCopy").textContent = shop.tagline || shop.description || "Masakan rumahan Jawa, hangat dan murah meriah.";
  el("storyText").textContent = shop.description || "Masakan rumah yang diracik harian dari bahan segar.";
  el("factHours").textContent = shop.hours || "07:00-15:00";
  el("factProducts").textContent = String(products.length || 0);
  el("factArea").textContent = (shop.store_address || "Beringharjo").split(",")[0].replace(/^Jl\.\s*/i, "");
  const heroImage = shop.cover_image || imageOf(products[0]);
  if (heroImage) el("heroMedia").style.backgroundImage = `url(${heroImage})`;
  const wa = `https://wa.me/${waNumber(shop.whatsapp)}?text=${encodeURIComponent(`Halo ${shop.name || "Warung Bu Sari"}, saya mau tanya menu hari ini.`)}`;
  el("heroWhatsapp").href = wa;
  el("topOrder").href = wa;
  el("syncInfo").textContent = `Menu ${shop.name || "warung"} siap dipesan. Update terakhir mengikuti control panel Lapakin.`;
}

function renderFilters() {
  const categories = ["Semua", ...new Set(products.map((p) => p.category_name || p.category).filter(Boolean))];
  el("categoryFilters").innerHTML = categories.map((cat) => `<button type="button" class="${cat === activeCategory ? "active" : ""}" data-category="${cat}">${cat}</button>`).join("");
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
        <span class="menu-badge">${safeText(product.category_name || product.category, "Menu")}</span>
      </div>
      <div class="menu-body">
        <h3>${safeText(product.name, "Menu Warung")}</h3>
        <p>${desc}</p>
        <div class="price-row">
          <strong>${money.format(Number(product.price || 0))}</strong>
          <button type="button" data-add="${product.product_id}">Tambah</button>
        </div>
      </div>
    </article>`;
  }).join("");
  el("menuGrid").querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.add)));
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
    <div><strong>${product.name}</strong><span>${money.format(product.price || 0)} per item</span></div>
    <div class="qty"><button type="button" data-minus="${product.product_id}">-</button><strong>${qty}</strong><button type="button" data-plus="${product.product_id}">+</button></div>
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
