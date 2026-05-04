import { Component, useEffect, useMemo, useState } from "react";
import "./storefront-template-renderer.css";

function cx(...classes) {
  return classes
    .flatMap((item) => {
      if (!item) return [];
      if (typeof item === "string") return [item];
      if (typeof item === "object") {
        return Object.entries(item)
          .filter(([, enabled]) => Boolean(enabled))
          .map(([className]) => className);
      }
      return [];
    })
    .join(" ");
}

function getShop(data) {
  return (
    data?.shop ||
    data?.store ||
    data?.tenant ||
    data?.data?.shop ||
    data?.data?.store ||
    data ||
    {}
  );
}

function getProducts(data) {
  const candidates = [
    data?.products,
    data?.items,
    data?.data?.products,
    data?.data?.items,
    data?.shop?.products,
    data?.store?.products,
  ];

  const found = candidates.find((item) => Array.isArray(item));
  return found || [];
}

function getValue(obj, keys, fallback = "") {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function getProductId(product, index) {
  return getValue(product, ["id", "_id", "product_id", "sku"], `product-${index}`);
}

function getProductName(product) {
  return getValue(product, ["name", "title", "product_name"], "Produk");
}

function getProductDescription(product) {
  return getValue(product, ["description", "desc", "short_description", "caption"], "");
}

function getProductCategory(product) {
  return getValue(product, ["category", "category_name", "type"], "Pilihan");
}

function getProductImage(product) {
  const image = getValue(product, [
    "image_url",
    "image",
    "photo_url",
    "thumbnail_url",
    "thumbnail",
    "cover_url",
  ]);

  if (image) return image;

  const images = product?.images || product?.photos || product?.media;
  if (Array.isArray(images) && images.length) {
    const first = images[0];
    if (typeof first === "string") return first;
    return first?.url || first?.image_url || first?.src || "";
  }

  return "";
}

function getProductPrice(product) {
  const price = getValue(product, ["price", "selling_price", "amount", "base_price"], 0);
  const number = Number(price);
  return Number.isFinite(number) ? number : 0;
}

function formatPrice(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "Hubungi toko";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(number);
}

function normalizeWhatsapp(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  return digits;
}

function buildWhatsappLink(shop, product) {
  const phone = normalizeWhatsapp(
    getValue(shop, [
      "whatsapp",
      "whatsapp_number",
      "phone",
      "phone_number",
      "contact_phone",
      "wa_number",
    ])
  );

  if (!phone) return "#";

  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "toko");
  const productName = product ? getProductName(product) : "";
  const message = productName
    ? `Halo ${shopName}, saya tertarik dengan ${productName}.`
    : `Halo ${shopName}, saya ingin bertanya.`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}


function normalizeSocialUrl(value, platform) {
  if (!value) return "";

  let raw = String(value).trim();
  if (!raw) return "";

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }

  raw = raw.replace(/^@+/, "");

  if (platform === "instagram") {
    return `https://instagram.com/${raw}`;
  }

  if (platform === "tiktok") {
    return `https://www.tiktok.com/@${raw}`;
  }

  return raw;
}

function getSocialLinks(shop) {
  const socials = shop?.socials || shop?.social_links || {};

  const instagram = getValue(
    {
      ...shop,
      instagram_from_socials: socials.instagram,
      instagram_url_from_socials: socials.instagram_url,
      ig_from_socials: socials.ig,
    },
    [
      "instagram_url",
      "instagram",
      "ig_url",
      "ig",
      "social_instagram",
      "instagram_handle",
      "instagram_from_socials",
      "instagram_url_from_socials",
      "ig_from_socials",
    ],
    ""
  );

  const tiktok = getValue(
    {
      ...shop,
      tiktok_from_socials: socials.tiktok,
      tiktok_url_from_socials: socials.tiktok_url,
    },
    [
      "tiktok_url",
      "tiktok",
      "tik_tok",
      "social_tiktok",
      "tiktok_handle",
      "tiktok_from_socials",
      "tiktok_url_from_socials",
    ],
    ""
  );

  return [
    {
      key: "instagram",
      label: "Instagram",
      url: normalizeSocialUrl(instagram, "instagram"),
    },
    {
      key: "tiktok",
      label: "TikTok",
      url: normalizeSocialUrl(tiktok, "tiktok"),
    },
  ].filter((item) => item.url);
}

function hasAboutContent(shop) {
  return Boolean(
    getValue(
      shop,
      ["about", "description", "bio", "tagline", "story", "business_description"],
      ""
    )
  );
}

function getCategories(products) {
  return Array.from(
    new Set(
      products
        .map((product) => getProductCategory(product))
        .filter(Boolean)
    )
  ).slice(0, 8);
}

function getModeFromTemplate(template) {
  const key = template?.templateKey || "";
  if (key.startsWith("food_")) return "food_menu";
  if (key.startsWith("services_")) return "services";
  return "catalog";
}

function getSectionTitle(section, mode) {
  const titles = {
    hero: "",
    featured_products: mode === "food_menu" ? "Menu Favorit" : mode === "services" ? "Layanan Unggulan" : "Produk Unggulan",
    all_products: mode === "food_menu" ? "Semua Menu" : mode === "services" ? "Semua Layanan" : "Semua Produk",
    today_menu: "Menu Hari Ini",
    menu_list: "Daftar Menu",
    menu_grid: "Pilihan Menu",
    signature_menu: "Signature Menu",
    service_list: "Daftar Layanan",
    categories: mode === "services" ? "Kategori Layanan" : "Kategori",
    collections: "Koleksi Pilihan",
    brand_story: "Cerita Brand",
    about: "Tentang Kami",
    benefits: "Kenapa Pilih Kami",
    testimonials: "Dipercaya Pelanggan",
    promo_banner: "Promo Spesial",
    faq: "Pertanyaan Umum",
    contact: "Hubungi Toko",
  };

  return titles[section] || section;
}

function getHeroCopy(mode, template) {
  if (mode === "food_menu") {
    return {
      eyebrow: "Menu siap dipesan",
      titlePrefix: "Nikmati pilihan menu dari",
      subtitle:
        "Pilih menu favorit, cek harga, lalu pesan langsung lewat WhatsApp tanpa ribet.",
      cta: "Pesan Sekarang",
    };
  }

  if (mode === "services") {
    return {
      eyebrow: "Jasa & layanan",
      titlePrefix: "Temukan layanan dari",
      subtitle:
        "Lihat pilihan layanan, estimasi harga, dan konsultasikan kebutuhan kamu langsung ke toko.",
      cta: "Konsultasi Sekarang",
    };
  }

  return {
    eyebrow: template?.label || "Katalog toko",
    titlePrefix: "Belanja mudah di",
    subtitle:
      "Lihat produk pilihan, cek detail dan harga, lalu hubungi toko untuk memesan.",
    cta: "Hubungi Toko",
  };
}


function getShopSlug(shop) {
  return getValue(shop, ["slug", "shop_slug", "store_slug", "subdomain"], "storefront");
}

function getCartStorageKey(shop) {
  return `lapakin_template_cart_${getShopSlug(shop)}`;
}

function getProductSnapshot(product, index = 0) {
  return {
    id: getProductId(product, index),
    name: getProductName(product),
    description: getProductDescription(product),
    category: getProductCategory(product),
    image_url: getProductImage(product),
    price: getProductPrice(product),
  };
}

function getCartTotal(cartItems) {
  return cartItems.reduce((sum, item) => {
    return sum + (Number(item.product?.price || 0) * Number(item.qty || 0));
  }, 0);
}

function buildCartWhatsappLink(shop, cartItems) {
  const phone = normalizeWhatsapp(
    getValue(shop, [
      "whatsapp",
      "whatsapp_number",
      "phone",
      "phone_number",
      "contact_phone",
      "wa_number",
    ])
  );

  if (!phone) return "#";

  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "toko");

  const lines = [
    `Halo ${shopName}, saya ingin pesan:`,
    "",
    ...cartItems.map((item, index) => {
      const product = item.product || {};
      const qty = Number(item.qty || 0);
      const price = Number(product.price || 0);
      const subtotal = price * qty;
      return `${index + 1}. ${product.name} x${qty} - ${formatPrice(subtotal)}`;
    }),
    "",
    `Total: ${formatPrice(getCartTotal(cartItems))}`,
  ];

  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\\n"))}`;
}


function ProductImage({ product, className }) {
  const image = getProductImage(product);
  const name = getProductName(product);

  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className={cx("ltr-product-image", className)}
        loading="lazy"
      />
    );
  }

  return (
    <div className={cx("ltr-product-image ltr-product-image-placeholder", className)}>
      <span>{name.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

function CategoryChips({ products, template }) {
  const categories = getCategories(products);
  if (!categories.length) return null;

  return (
    <div className="ltr-category-chips" data-template-nav={template?.categoryNav}>
      {categories.map((category) => (
        <span key={category} className="ltr-chip">
          {category}
        </span>
      ))}
    </div>
  );
}


function SocialLinks({ shop }) {
  const links = getSocialLinks(shop);

  if (!links.length) return null;

  return (
    <div className="ltr-social-links">
      {links.map((link) => (
        <a
          key={link.key}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className={`ltr-social-link ltr-social-${link.key}`}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

function HeroSection({ shop, products, template }) {
  const mode = getModeFromTemplate(template);
  const copy = getHeroCopy(mode, template);
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");
  const customHeroTitle = getValue(shop, ["storefront_hero_title"], "");
  const description =
    getValue(shop, ["storefront_hero_subtitle"], "") ||
    getValue(shop, ["description", "tagline", "bio", "about"], "") ||
    copy.subtitle;
  const ctaLabel = getValue(shop, ["storefront_cta_label"], "") || copy.cta;
  const logo = getValue(shop, ["logo_url", "logo", "avatar_url", "image_url"], "");
  const featured = products[0];

  return (
    <section className={cx("ltr-hero", `ltr-hero-${template.hero}`)}>
      <div className="ltr-hero-content">
        <div className="ltr-eyebrow">{copy.eyebrow}</div>
        <h1>
          {customHeroTitle ? (
            customHeroTitle
          ) : (
            <>
              {copy.titlePrefix} <span>{shopName}</span>
            </>
          )}
        </h1>
        <p>{description}</p>

        <div className="ltr-hero-actions">
          <a className="ltr-primary-cta" href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
            {ctaLabel}
          </a>
        </div>

        <div className="ltr-hero-stats">
          <div>
            <strong>{products.length || 0}</strong>
            <span>{mode === "services" ? "Layanan" : mode === "food_menu" ? "Menu" : "Produk"}</span>
          </div>
          <div>
            <strong>{getCategories(products).length || 1}</strong>
            <span>Kategori</span>
          </div>
          <div>
            <strong>WA</strong>
            <span>Order cepat</span>
          </div>
        </div>
      </div>

      <div className="ltr-hero-visual">
        {logo ? (
          <img src={logo} alt={shopName} className="ltr-hero-logo" />
        ) : featured ? (
          <ProductImage product={featured} className="ltr-hero-product" />
        ) : (
          <div className="ltr-hero-logo ltr-product-image-placeholder">
            <span>{shopName.slice(0, 1).toUpperCase()}</span>
          </div>
        )}

        <div className="ltr-hero-card">
          <span>{mode === "food_menu" ? "Rekomendasi" : mode === "services" ? "Layanan Populer" : "Produk Pilihan"}</span>
          <strong>{featured ? getProductName(featured) : shopName}</strong>
          {featured && <small>{formatPrice(getProductPrice(featured))}</small>}
        </div>
      </div>
    </section>
  );
}


function TemplateCartDrawer({
  shop,
  cartItems,
  cartOpen,
  onClose,
  onIncrease,
  onDecrease,
  onRemove,
  onClear,
}) {
  if (!cartOpen) return null;

  const total = getCartTotal(cartItems);
  const checkoutHref = buildCartWhatsappLink(shop, cartItems);

  return (
    <div className="ltr-cart-overlay" data-testid="storefront-template-cart-drawer">
      <button className="ltr-cart-backdrop" type="button" onClick={onClose} aria-label="Tutup keranjang" />

      <aside className="ltr-cart-drawer">
        <div className="ltr-cart-header">
          <div>
            <span>Keranjang</span>
            <h2>Cek pesanan kamu</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup keranjang">
            ×
          </button>
        </div>

        {cartItems.length ? (
          <>
            <div className="ltr-cart-items">
              {cartItems.map((item) => {
                const product = item.product || {};
                const qty = Number(item.qty || 0);

                return (
                  <div key={product.id} className="ltr-cart-item">
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} />
                    ) : (
                      <div className="ltr-cart-item-placeholder">
                        {String(product.name || "P").slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <div className="ltr-cart-item-body">
                      <h3>{product.name}</h3>
                      <p>{formatPrice(product.price)}</p>

                      <div className="ltr-cart-qty">
                        <button type="button" onClick={() => onDecrease(product.id)}>
                          −
                        </button>
                        <strong>{qty}</strong>
                        <button type="button" onClick={() => onIncrease(product.id)}>
                          +
                        </button>
                        <button type="button" onClick={() => onRemove(product.id)}>
                          Hapus
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="ltr-cart-footer">
              <div>
                <span>Total</span>
                <strong>{formatPrice(total)}</strong>
              </div>

              <a href={checkoutHref} target="_blank" rel="noreferrer">
                Checkout WhatsApp
              </a>

              <button type="button" onClick={onClear}>
                Kosongkan Keranjang
              </button>
            </div>
          </>
        ) : (
          <div className="ltr-cart-empty">
            <h3>Keranjang masih kosong</h3>
            <p>Pilih produk lalu tekan Tambah ke Keranjang.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function FloatingCartButton({ count, onOpen }) {
  if (!count) return null;

  return (
    <button
      type="button"
      className="ltr-floating-cart"
      onClick={onOpen}
      data-testid="storefront-template-floating-cart"
    >
      <span>Keranjang</span>
      <strong>{count}</strong>
    </button>
  );
}

function ProductCard({ product, shop, template, index, onAddToCart }) {
  const mode = getModeFromTemplate(template);
  const variant = template.productCard;
  const name = getProductName(product);
  const description = getProductDescription(product);
  const price = getProductPrice(product);
  const category = getProductCategory(product);
  const isService = mode === "services";
  const isFood = mode === "food_menu";

  return (
    <article
      className={cx("ltr-product-card", `ltr-card-${variant}`, {
        "ltr-product-card-featured": index === 0,
      })}
    >
      <ProductImage product={product} />

      <div className="ltr-product-body">
        <div className="ltr-product-meta">
          <span>{category}</span>
          {isFood && <span>Siap pesan</span>}
          {isService && <span>Konsultasi</span>}
        </div>

        <h3>{name}</h3>

        {description && <p>{description}</p>}

        <div className="ltr-product-footer">
          <strong>
            {isService && price > 0 ? "Mulai dari " : ""}
            {formatPrice(price)}
          </strong>

          <div className="ltr-product-actions">
            <button
              type="button"
              className="ltr-add-cart-btn"
              onClick={() => onAddToCart?.(product, index)}
              data-testid="storefront-template-add-cart"
              aria-label={`Tambah ${name} ke keranjang`}
              title="Tambah ke keranjang"
            >
              <svg
                className="ltr-add-cart-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M7 18.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM6.2 6l.34 2H20a1 1 0 0 1 .97 1.24l-1.35 5.4A3 3 0 0 1 16.7 17H8.1a3 3 0 0 1-2.96-2.5L3.72 6H2.5a1 1 0 1 1 0-2h2.06a1 1 0 0 1 .99.84L5.75 6h.45Zm.68 4 .7 4.17a1 1 0 0 0 .99.83h8.13a1 1 0 0 0 .97-.76L18.73 10H6.88Z" />
              </svg>
              <span>Keranjang</span>
            </button>

            <a href={buildWhatsappLink(shop, product)} target="_blank" rel="noreferrer">
              {isService ? "Tanya" : isFood ? "Pesan" : "Order"}
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductSection({ title, products, shop, template, limit, titleOverride, onAddToCart }) {
  const visibleProducts = (products || []).slice(0, limit || products.length);
  const finalTitle = titleOverride || title;

  if (!visibleProducts.length) {
    return (
      <section className="ltr-section">
        <div className="ltr-section-heading">
          <span>Segera hadir</span>
          <h2>{finalTitle}</h2>
          <p>Belum ada item yang ditampilkan untuk bagian ini.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ltr-section">
      <div className="ltr-section-heading">
        <span>{template.label}</span>
        <h2>{finalTitle}</h2>
        <p>{template.description}</p>
      </div>

      <div className={cx("ltr-products-grid", `ltr-products-${template.productCard}`)}>
        {visibleProducts.map((product, index) => (
          <ProductCard
            key={getProductId(product, index)}
            product={product}
            shop={shop}
            template={template}
            index={index}
            onAddToCart={onAddToCart}
          />
        ))}
      </div>
    </section>
  );
}

function PromoBanner({ shop, template }) {
  const mode = getModeFromTemplate(template);
  const title =
    mode === "food_menu"
      ? "Promo hari ini bisa langsung ditanyakan lewat WhatsApp."
      : mode === "services"
        ? "Butuh layanan khusus? Konsultasikan kebutuhan kamu."
        : "Ada produk yang cocok? Hubungi toko untuk cek stok.";

  return (
    <section className="ltr-promo">
      <div>
        <span>{template.mood}</span>
        <h2>{title}</h2>
      </div>
      <a href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
        Chat Toko
      </a>
    </section>
  );
}

function BrandStory({ shop, template }) {
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");
  const about = getValue(
    shop,
    ["about", "description", "bio", "tagline", "story", "business_description"],
    `${shopName} hadir untuk membantu pelanggan menemukan pilihan terbaik dengan proses order yang mudah.`
  );

  return (
    <section className="ltr-story" data-testid="storefront-about-section">
      <span>Tentang Kami</span>
      <h2>{getValue(shop, ["storefront_about_title"], "") || `Kenal lebih dekat dengan ${shopName}`}</h2>
      <p>{about}</p>
      <SocialLinks shop={shop} />
    </section>
  );
}

function Benefits({ template }) {
  const mode = getModeFromTemplate(template);
  const items =
    mode === "food_menu"
      ? ["Pesan mudah via WhatsApp", "Menu jelas dan cepat dipilih", "Cocok untuk order harian"]
      : mode === "services"
        ? ["Konsultasi langsung", "Pilihan layanan jelas", "Proses mudah dari awal"]
        : ["Katalog rapi", "Harga mudah dicek", "Order langsung ke toko"];

  return (
    <section className="ltr-section">
      <div className="ltr-section-heading">
        <span>Keunggulan</span>
        <h2>Kenapa pelanggan suka?</h2>
      </div>

      <div className="ltr-benefits">
        {items.map((item) => (
          <div key={item}>
            <strong>{item}</strong>
            <p>Dibuat agar pengalaman pelanggan terasa sederhana dan nyaman.</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContactSection({ shop, template }) {
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");
  const address = getValue(shop, ["address", "location", "full_address"], "");
  const mode = getModeFromTemplate(template);

  return (
    <section className="ltr-contact">
      <div>
        <span>{mode === "services" ? "Konsultasi" : "Order via WhatsApp"}</span>
        <h2>Hubungi {shopName}</h2>
        <p>
          {address ||
            "Klik tombol di bawah untuk bertanya, cek stok, pesan produk, atau konsultasi langsung."}
        </p>
        <div data-testid="storefront-contact-socials">
          <SocialLinks shop={shop} />
        </div>
      </div>

      <a href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
        {getValue(shop, ["storefront_cta_label"], "") || (mode === "services" ? "Konsultasi Sekarang" : "Chat WhatsApp")}
      </a>
    </section>
  );
}

function FaqSection({ template }) {
  const mode = getModeFromTemplate(template);
  const faqs =
    mode === "services"
      ? [
          ["Bagaimana cara booking?", "Hubungi toko via WhatsApp untuk jadwal dan kebutuhan layanan."],
          ["Apakah bisa konsultasi dulu?", "Bisa, pelanggan dapat bertanya terlebih dahulu sebelum memilih layanan."],
        ]
      : [
          ["Bagaimana cara order?", "Pilih item lalu klik tombol WhatsApp untuk menghubungi toko."],
          ["Apakah harga selalu update?", "Harga mengikuti informasi terbaru dari toko."],
        ];

  return (
    <section className="ltr-section">
      <div className="ltr-section-heading">
        <span>FAQ</span>
        <h2>Pertanyaan Umum</h2>
      </div>

      <div className="ltr-faq">
        {faqs.map(([question, answer]) => (
          <div key={question}>
            <strong>{question}</strong>
            <p>{answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function renderSection(section, context) {
  const { shop, products, template, onAddToCart } = context;
  const mode = getModeFromTemplate(template);
  const title = getSectionTitle(section, mode);
  const featured = products.filter((product) => product?.featured || product?.is_featured);
  const fallbackFeatured = featured.length ? featured : products.slice(0, 4);

  switch (section) {
    case "hero":
      return <HeroSection key={section} shop={shop} products={products} template={template} />;

    case "categories":
      return (
        <section key={section} className="ltr-section ltr-category-section">
          <div className="ltr-section-heading">
            <span>Jelajahi</span>
            <h2>{title}</h2>
          </div>
          <CategoryChips products={products} template={template} />
        </section>
      );

    case "featured_products":
    case "signature_menu":
    case "today_menu":
    case "collections":
      return (
        <ProductSection
          key={section}
          title={title}
          products={fallbackFeatured}
          shop={shop}
          template={template}
          onAddToCart={onAddToCart}
          limit={4}
          titleOverride={getValue(shop, ["storefront_featured_title"], "")}
        />
      );

    case "all_products":
    case "menu_list":
    case "menu_grid":
    case "service_list":
      return (
        <ProductSection
          key={section}
          title={title}
          products={products}
          shop={shop}
          template={template}
          onAddToCart={onAddToCart}
        />
      );

    case "promo_banner":
      return <PromoBanner key={section} shop={shop} template={template} />;

    case "brand_story":
    case "about":
      return <BrandStory key={section} shop={shop} template={template} />;

    case "benefits":
    case "testimonials":
      return <Benefits key={section} template={template} />;

    case "faq":
      return <FaqSection key={section} template={template} />;

    case "contact":
      return <ContactSection key={section} shop={shop} template={template} />;

    default:
      return null;
  }
}


function MobileStickyOrderBar({ shop, template, cartCount, onOpenCart }) {
  const mode = getModeFromTemplate(template);
  const shopName = getValue(shop, ["name", "shop_name", "store_name"], "Toko");

  const label =
    mode === "services"
      ? "Konsultasi via WhatsApp"
      : mode === "food_menu"
        ? "Pesan Menu via WhatsApp"
        : "Order via WhatsApp";

  return (
    <div className="ltr-mobile-sticky-order" data-testid="storefront-mobile-sticky-order">
      <div>
        <span>{shopName}</span>
        <strong>{label}</strong>
      </div>
      {cartCount > 0 ? (
        <button type="button" onClick={onOpenCart}>
          Keranjang ({cartCount})
        </button>
      ) : (
        <a href={buildWhatsappLink(shop)} target="_blank" rel="noreferrer">
          Chat
        </a>
      )}
    </div>
  );
}

export default function StorefrontTemplateRenderer({ data, template }) {
  const shop = getShop(data);
  const products = getProducts(data);
  const mode = getModeFromTemplate(template);
  const cartKey = getCartStorageKey(shop);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState(() => {
    if (typeof window === "undefined") return {};

    try {
      const raw = window.localStorage.getItem(cartKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      // ignore localStorage failures
    }
  }, [cart, cartKey]);

  const productMap = useMemo(() => {
    const map = {};
    products.forEach((product, index) => {
      const snapshot = getProductSnapshot(product, index);
      map[snapshot.id] = snapshot;
    });
    return map;
  }, [products]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([id, item]) => {
        const product = productMap[id] || item.product;
        const qty = Number(item.qty || 0);

        if (!product || !qty) return null;

        return {
          product,
          qty,
        };
      })
      .filter(Boolean);
  }, [cart, productMap]);

  const cartCount = cartItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);

  const addToCart = (product, index = 0) => {
    const snapshot = getProductSnapshot(product, index);

    setCart((prev) => ({
      ...prev,
      [snapshot.id]: {
        product: snapshot,
        qty: Number(prev?.[snapshot.id]?.qty || 0) + 1,
      },
    }));

  };

  const increaseCartItem = (id) => {
    setCart((prev) => {
      const current = prev[id];
      if (!current) return prev;

      return {
        ...prev,
        [id]: {
          ...current,
          qty: Number(current.qty || 0) + 1,
        },
      };
    });
  };

  const decreaseCartItem = (id) => {
    setCart((prev) => {
      const current = prev[id];
      if (!current) return prev;

      const nextQty = Number(current.qty || 0) - 1;
      if (nextQty <= 0) {
        const next = { ...prev };
        delete next[id];
        return next;
      }

      return {
        ...prev,
        [id]: {
          ...current,
          qty: nextQty,
        },
      };
    });
  };

  const removeCartItem = (id) => {
    setCart((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const baseSections = template?.sectionOrder?.length
    ? [...template.sectionOrder]
    : ["hero", "categories", "all_products", "contact"];

  const sections = [...baseSections];

  if (
    hasAboutContent(shop) &&
    !sections.includes("about") &&
    !sections.includes("brand_story")
  ) {
    const contactIndex = sections.indexOf("contact");
    if (contactIndex >= 0) {
      sections.splice(contactIndex, 0, "about");
    } else {
      sections.push("about");
    }
  }

  if (!sections.includes("contact")) {
    sections.push("contact");
  }

  return (
    <main
      className={cx(
        "ltr-page",
        `ltr-template-${template.templateKey}`,
        `ltr-mode-${mode}`,
        `ltr-density-${template.density}`,
        `ltr-card-layout-${template.productCard}`
      )}
      data-testid="storefront-template-renderer"
      data-template-key={template.templateKey}
    >
      <div className="ltr-background-orb ltr-background-orb-one" />
      <div className="ltr-background-orb ltr-background-orb-two" />

      <div className="ltr-container">
        {sections.map((section) => renderSection(section, { shop, products, template, onAddToCart: addToCart }))}
      </div>

      <FloatingCartButton count={cartCount} onOpen={() => setCartOpen(true)} />

      <TemplateCartDrawer
        shop={shop}
        cartItems={cartItems}
        cartOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        onIncrease={increaseCartItem}
        onDecrease={decreaseCartItem}
        onRemove={removeCartItem}
        onClear={() => setCart({})}
      />

      <MobileStickyOrderBar
        shop={shop}
        template={template}
        cartCount={cartCount}
        onOpenCart={() => setCartOpen(true)}
      />
    </main>
  );
}


class StorefrontTemplateRendererErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, info) {
    // Keep this log for renderer preview debugging.
    console.error("Storefront template renderer error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || "Unknown renderer error";

      return (
        <main className="min-h-screen bg-red-50 p-6 text-red-950">
          <div className="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-black uppercase tracking-wide text-red-600">
              Renderer Preview Error
            </p>
            <h1 className="mt-2 text-2xl font-black">
              Layout renderer gagal dimuat.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-red-800">
              Website normal tetap aman. Hapus query <code>?renderer=1</code> untuk kembali ke layout lama.
            </p>
            <pre className="mt-4 overflow-auto rounded-2xl bg-red-950 p-4 text-xs text-red-50">
              {String(message)}
            </pre>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export function SafeStorefrontTemplateRenderer(props) {
  return (
    <StorefrontTemplateRendererErrorBoundary>
      <StorefrontTemplateRenderer {...props} />
    </StorefrontTemplateRendererErrorBoundary>
  );
}
