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
    "~*meta-externalagent"   1;
    "~*facebookcatalog"      1;
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
tambahkan rule routing kondisional menggunakan pola `error_page` trick
(LEBIH RELIABLE dari `if+rewrite+last` yang notorious buggy di nginx):

```nginx
# Bot crawler diarahkan ke endpoint OG via internal redirect
location ~ ^/toko/(?<shop_slug>[a-zA-Z0-9-]+)/?$ {
    error_page 418 = @bot_og;
    recursive_error_pages on;
    if ($is_social_bot = 1) { return 418; }
    # Manusia → React SPA fallback
    try_files $uri /index.html;
}

# Internal-only location: proxy ke backend OG endpoint
location @bot_og {
    proxy_pass http://127.0.0.1:8001/api/og/shop/$shop_slug;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

> Pastikan `try_files $uri /index.html;` ini mengarah ke folder build React kamu
> sesuai konfigurasi `root` di server block.

> Pola `error_page 418 = @location` sebagai workaround untuk "if is evil" issue
> di nginx — `if + rewrite + last` di dalam location block sering bermasalah,
> sedangkan `error_page` ke named location SELALU bekerja konsisten.

## ⚠️ Wajib: Pakai modifier `^~` di location /api/

Jika nginx config kamu punya regex location untuk static asset (`.png`, `.jpg`, dst.),
regex itu akan **ikut match** URL `/api/og/shop/<slug>.png` dan menyerahkan ke
React build folder → 404 nginx.

Solusinya: pakai `^~` di location `/api/` supaya prioritasnya naik di atas regex.

```nginx
# WAJIB pakai ^~ supaya prefix /api/ menang dari regex .png/.jpg
location ^~ /api/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

Tanpa `^~`, request `/api/og/shop/kopi-senja.png` akan mismatch ke regex
location `\.(js|css|png|...)$` dan gagal.

Verifikasi cepat:
```bash
curl -I https://your-domain.com/api/og/shop/<slug>.png
# Harus: HTTP/2 200, content-type: image/png
# Salah: HTTP/2 404, server: nginx (berarti regex priority masih bermasalah)
```

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
