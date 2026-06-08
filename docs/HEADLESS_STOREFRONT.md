# Headless Storefront / Website Custom

Lapakin can act as the control panel and data source for tenant websites built outside the built-in Lapakin templates.

Use this when a tenant wants a custom website from an agency, a hand-coded landing page, WordPress, Next.js, or another frontend, while still managing products, pricing, WhatsApp checkout copy, SEO, and store profile from Lapakin.

## Dashboard Flow

1. Open **Dashboard > Tampilan Website**.
2. In **Mode Website**, choose **Website Custom**.
3. Fill the custom website URL, for example `https://tokokamu.com`.
4. Save changes.
5. Give the public API endpoint to the website developer.

The old Lapakin storefront URL `/toko/{slug}` can behave in two ways:

- `handoff`: show a lightweight Lapakin page with a button to the custom website.
- `redirect`: automatically redirect visitors to the custom website URL.

Use `handoff` while migrating, and `redirect` once the external website is live and tested.

## Public API

```http
GET /api/public/storefront/{slug}
```

Example:

```bash
curl https://dev.lapakin.my.id/api/public/storefront/warung-bu-sari
```

Response shape:

```json
{
  "ok": true,
  "version": "2026-06-08",
  "mode": "headless_storefront",
  "shop": {
    "shop_id": "shop_xxx",
    "slug": "warung-bu-sari",
    "name": "Warung Bu Sari",
    "tagline": "Masakan rumahan",
    "brand_color": "#C04A3B",
    "whatsapp": "62812...",
    "website_mode": "external_custom",
    "external_website_url": "https://tokokamu.com",
    "storefront_whatsapp_checkout_template": "...",
    "seo": {
      "title": "...",
      "description": "...",
      "image": "..."
    }
  },
  "products": [
    {
      "product_id": "prod_xxx",
      "name": "Bakso Spesial",
      "price": 25000,
      "category_name": "Makanan",
      "availability_status": "active",
      "images": []
    }
  ],
  "categories": ["Makanan"],
  "links": {
    "lapakin_storefront": "/toko/warung-bu-sari",
    "headless_endpoint": "/api/public/storefront/warung-bu-sari"
  }
}
```

## JavaScript Example

```js
async function loadStorefront(slug) {
  const res = await fetch(`https://dev.lapakin.my.id/api/public/storefront/${slug}`);
  if (!res.ok) throw new Error("Storefront not found");
  return res.json();
}

const data = await loadStorefront("warung-bu-sari");
console.log(data.shop.name, data.products);
```

## Checkout WhatsApp

Use `shop.whatsapp` and product/cart data to build a WhatsApp URL:

```js
function waNumber(raw) {
  return String(raw || "").replace(/[^0-9]/g, "").replace(/^0/, "62");
}

function whatsappLink(shop, text) {
  return `https://wa.me/${waNumber(shop.whatsapp)}?text=${encodeURIComponent(text)}`;
}
```

## Notes

- Hidden products are not returned by the headless endpoint.
- The endpoint is public by design. Do not put private tenant/admin data in it.
- Lapakin remains the source of truth for product and shop data.
- Custom domains can still point to either a Lapakin template or an external website, depending on DNS and deployment strategy.
