# Setup Dynamic OpenGraph di VPS lapakin.my.id

## Apa yang sudah otomatis aktif?

Setelah update terbaru, Lapakin sudah punya 2 endpoint OG di backend:

- `GET /api/og/shop/<slug>.png` → gambar pratinjau 1200×630 (cover toko atau auto-generate)
- `GET /api/og/shop/<slug>` → halaman HTML dengan tag `<meta og:*>` lengkap + JS redirect ke storefront

Contoh:
- https://lapakin.my.id/api/og/shop/toko-test-262897.png
- https://lapakin.my.id/api/og/shop/toko-test-262897

## Masalahnya

Saat user share link **`lapakin.my.id/toko/<slug>`**, bot crawler (WhatsApp, Facebook, Twitter,
Telegram, dst.) ambil HTML React kosong yang tidak punya tag OG per-toko. Hasilnya pratinjau
share gak nampilin banner toko.

## Solusi

Routing **bot User-Agent** dari `/toko/<slug>` ke `/api/og/shop/<slug>` di Nginx.
Browser manusia tetap diarahkan ke React SPA seperti biasa.

## Patch nginx config

Edit file nginx config kamu (biasanya `/etc/nginx/sites-available/lapakin.my.id` atau `nginx.conf`),
**tambahkan map block** di luar `server { }`:

```nginx
# /etc/nginx/conf.d/lapakin-bot-map.conf  (atau di awal nginx.conf, di luar `server { }`)
map $http_user_agent $is_social_bot {
    default 0;
    "~*facebookexternalhit"  1;
    "~*Facebot"              1;
    "~*WhatsApp"             1;
    "~*Twitterbot"           1;
    "~*TelegramBot"          1;
    "~*LinkedInBot"          1;
    "~*Slackbot"             1;
    "~*Discordbot"           1;
    "~*Pinterest"            1;
    "~*SkypeUriPreview"      1;
    "~*vkShare"              1;
    "~*Applebot"             1;
}
```

Lalu di dalam `server { }` block, **sebelum** location lain untuk `/toko/`,
tambahkan rule routing kondisional:

```nginx
# Bot crawler diarahkan ke endpoint OG
location ~ ^/toko/([a-zA-Z0-9-]+)/?$ {
    if ($is_social_bot = 1) {
        rewrite ^/toko/([a-zA-Z0-9-]+)/?$ /api/og/shop/$1 last;
    }
    # Manusia → React SPA fallback
    try_files $uri /index.html;
}
```

> Pastikan `try_files $uri /index.html;` ini mengarah ke folder build React kamu
> sesuai konfigurasi `root` di server block.

## Reload nginx

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Validasi

1. Test sebagai bot:
   ```bash
   curl -A "WhatsApp/2.23.20" -L https://lapakin.my.id/toko/<slug> | grep og:
   ```
   Output harus muncul tag `<meta property="og:image" ...>` dst.

2. Test sebagai manusia:
   ```bash
   curl -A "Mozilla/5.0" https://lapakin.my.id/toko/<slug> | head -20
   ```
   Output harus React HTML standar.

3. Validasi dengan tools resmi:
   - [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) — paste URL toko
   - [Twitter Card Validator](https://cards-dev.twitter.com/validator)
   - [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/)

   Klik "Scrape Again" / "Refresh" kalau preview lama masih ke-cache.

## Cache invalidation

Pratinjau di WhatsApp/Facebook bisa di-cache 1-7 hari. Kalau toko ganti cover,
gunakan tombol "Scrape Again" di Sharing Debugger (FB) — link ke tools tersebut
sudah ditampilkan di Dashboard Lapakin.

## Troubleshooting

- **Pratinjau gak nampil sama sekali**: pastikan endpoint `/api/og/shop/<slug>.png` accessible
  via HTTPS (bukan HTTP), ukuran < 5MB, response time < 3 detik (FB timeout).
- **Pratinjau lama masih nampil**: cache FB. Refresh via Sharing Debugger.
- **PNG fallback jelek**: upload cover image di Pengaturan Toko (rekomendasi rasio 16:5 atau 16:6).
