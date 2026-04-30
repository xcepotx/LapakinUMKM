# Auto-Renewal SSL dengan Cloudflare (untuk Rumahweb & domain lain)

**Kenapa?** Wildcard SSL yang kita buat pakai `certbot --manual` **TIDAK bisa auto-renew** — 90 hari lagi cert expired, semua toko subdomain down. Solusi termudah: pindah DNS management ke Cloudflare (gratis), lalu Certbot pakai plugin Cloudflare untuk renew otomatis tiap 60 hari.

⚠️ **PENTING**: Domain **tetap di Rumahweb** (sebagai registrar). Yang pindah hanya "DNS management" ke Cloudflare. Kamu tidak perlu transfer domain.

---

## ① Daftar Cloudflare & Add Site

1. Buka https://dash.cloudflare.com/sign-up → daftar (gratis)
2. Verify email
3. Klik **"+ Add a Site"** → masukkan `lapakin.my.id` → pilih **Free** plan
4. Cloudflare akan scan DNS records existing dari Rumahweb → review + klik Continue
5. Cloudflare kasih **2 nameserver** (contoh):
   ```
   penny.ns.cloudflare.com
   zeke.ns.cloudflare.com
   ```
   **Copy keduanya** (ini unik per account).

---

## ② Ganti Nameserver di Rumahweb

1. Login ke https://my.rumahweb.com
2. Menu **Domain → [lapakin.my.id] → Manage → Nameservers**
3. Ganti dari `ns1.rumahweb.com` / `ns2.rumahweb.com` ke nameserver Cloudflare tadi
4. Klik Save / Update
5. **Tunggu 15 menit – 24 jam** propagasi (biasanya < 1 jam)

**Cek propagasi:**
```bash
dig NS lapakin.my.id
# Harus muncul: penny.ns.cloudflare.com dan zeke.ns.cloudflare.com
```

Cloudflare juga akan kirim email "Your domain is active" ketika nameserver sudah aktif.

---

## ③ Konfigurasi DNS di Cloudflare

Di Cloudflare Dashboard → `lapakin.my.id` → **DNS → Records**, pastikan:

| Type | Name | Content | Proxy status |
|------|------|---------|--------------|
| A | `@` (lapakin.my.id) | `IP_VPS` | **DNS only** (abu-abu) |
| A | `www` | `IP_VPS` | **DNS only** (abu-abu) |
| A | `*` | `IP_VPS` | **DNS only** (abu-abu) |

⚠️ **KRITIS**: Proxy status **harus abu-abu (DNS only)**, bukan oranye (Proxied). Kalau oranye:
- Certbot DNS-01 challenge gagal
- Cloudflare inject JS tag yang bisa ganggu storefront
- SSL cert Let's Encrypt tidak bisa dipakai (Cloudflare pakai cert sendiri)

---

## ④ Buat Cloudflare API Token

1. Dashboard → klik foto profil kanan atas → **My Profile**
2. Tab **API Tokens** → **Create Token**
3. Pilih template **"Edit zone DNS"**
4. Configure:
   - **Permissions**: Zone → DNS → Edit
   - **Zone Resources**: Include → Specific zone → `lapakin.my.id`
   - **Client IP Filtering**: (kosongkan, optional)
   - **TTL**: (kosongkan = permanent)
5. Continue → Summary → **Create Token**
6. **COPY TOKEN** (muncul hanya sekali!) — simpan di password manager

---

## ⑤ Setup Certbot Plugin di VPS

SSH ke VPS, lalu:

```bash
# Install plugin
sudo apt update
sudo apt install python3-certbot-dns-cloudflare -y

# Simpan API token di file terproteksi
sudo mkdir -p /root/.secrets
sudo tee /root/.secrets/cloudflare.ini > /dev/null <<'EOF'
dns_cloudflare_api_token = PASTE_TOKEN_CLOUDFLARE_DI_SINI
EOF

# Permission 600 (root-only, WAJIB)
sudo chmod 600 /root/.secrets/cloudflare.ini
```

---

## ⑥ Re-issue Cert (Force Renew via Cloudflare Plugin)

```bash
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 60 \
  --cert-name lapakin.my.id \
  --force-renewal \
  -d lapakin.my.id \
  -d "*.lapakin.my.id"
```

**Apa yang terjadi:**
1. Certbot otomatis buat TXT record `_acme-challenge` di Cloudflare via API
2. Tunggu 60 detik propagasi
3. Let's Encrypt verify
4. Cert baru terbit + Certbot auto-hapus TXT record
5. Renewal config tersimpan dengan method Cloudflare

**Verify:**
```bash
sudo certbot certificates
# Expect: renewal_method=dns-cloudflare (bukan manual)
```

---

## ⑦ Test Auto-Renewal (Dry Run)

```bash
sudo certbot renew --dry-run
```

Expected output:
```
Processing /etc/letsencrypt/renewal/lapakin.my.id.conf
...
Congratulations, all simulated renewals succeeded
```

✅ Kalau sukses → renewal akan jalan otomatis tiap 60 hari via `certbot.timer` systemd service.

```bash
# Cek timer jalan
sudo systemctl status certbot.timer
# Active: active (waiting)
```

---

## ⑧ Reload NGINX Setelah Cert Baru

```bash
sudo nginx -t && sudo systemctl reload nginx

# Test
curl -I https://lapakin.my.id
curl -I https://warung-bu-sari.lapakin.my.id
```

---

## 🎁 Bonus Cloudflare Features

Setelah DNS pindah ke Cloudflare (DNS-only mode), kamu tetap dapat:
- **DDoS protection di Level DNS** (gratis, always-on)
- **Analytics** (traffic per jam, negara asal visitor)
- **Email routing** (forward email @lapakin.my.id ke Gmail, gratis)
- **Page Rules** (redirect custom)

Yang **tidak aktif** (karena proxy off):
- Cloudflare CDN/cache
- Image optimization
- Workers

Kalau nanti mau aktifkan proxy (awan oranye), pastikan:
1. SSL/TLS → **Full (strict)** — bukan Flexible
2. Rule: bypass cache untuk `/api/*` supaya backend tetap jalan

---

## 🆘 Troubleshooting

### "Certbot DNS challenge timeout"
Cloudflare propagation kadang > 60 detik. Tambah: `--dns-cloudflare-propagation-seconds 120`

### "Token invalid"
Pastikan token punya permission **Zone → DNS → Edit** (bukan Read). Regenerate kalau perlu.

### "Nameserver belum aktif setelah 24 jam"
Hubungi Rumahweb support — kadang mereka cache nameserver lama.

### "SSL error setelah DNS pindah"
Kalau proxy Cloudflare oranye → matikan (klik awan sampai abu-abu). Atau set SSL mode ke "Full (strict)" di Cloudflare SSL/TLS settings.

---

## 📌 Checklist Final

- [ ] Account Cloudflare dibuat + domain added
- [ ] Nameserver di Rumahweb → Cloudflare
- [ ] DNS records (A @, A www, A *) di Cloudflare → DNS only (abu-abu)
- [ ] API Token Cloudflare dibuat + saved di VPS
- [ ] Certbot plugin Cloudflare installed
- [ ] Cert re-issued via plugin (bukan manual)
- [ ] `certbot renew --dry-run` sukses
- [ ] `certbot.timer` aktif

Setelah semua ☑️ → **kamu tidak perlu pikirin SSL lagi selamanya.** Cert auto-renew tiap 60 hari tanpa intervensi.
