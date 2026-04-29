# Resend Email Setup Guide — Lapakin

Ini panduan 3 langkah supaya email transaksional Lapakin aktif mengirim dari `noreply@lapakin.my.id`.

## Langkah 1 — Buat Akun Resend (gratis)

1. Buka [https://resend.com](https://resend.com) → **Sign Up** (pakai Google atau email biasa)
2. Login → **Dashboard** → **API Keys** → **Create API Key**
3. Nama: `Lapakin Production`
4. Permission: `Sending access` (default)
5. Copy API key yang tampil (mulai dengan `re_...`). **Simpan baik-baik — hanya ditampilkan sekali.**

Tier gratis: **100 email/hari, 3.000/bulan** — cukup untuk fase awal UMKM kamu.

## Langkah 2 — Verifikasi Domain `lapakin.my.id`

1. Di dashboard Resend, buka **Domains** → **Add Domain**
2. Masukkan `lapakin.my.id` → **Add**
3. Resend akan generate 3 DNS record. Buka registrar domain kamu (Niagahoster / Rumahweb / Namecheap / dst), masuk ke **DNS Management** dan tambahkan:

### Record 1 — SPF (TXT)
```
Type:  TXT
Name:  send.lapakin.my.id   (atau "send" saja tergantung registrar)
Value: v=spf1 include:amazonses.com ~all
TTL:   Auto atau 3600
```

### Record 2 — DKIM (TXT)
```
Type:  TXT
Name:  resend._domainkey.lapakin.my.id   (atau "resend._domainkey")
Value: <copy panjang dari dashboard Resend — mulai dengan "p=MIGfMA0GCSqGSIb...">
TTL:   Auto atau 3600
```

### Record 3 — DMARC (TXT, opsional tapi recommended)
```
Type:  TXT
Name:  _dmarc.lapakin.my.id   (atau "_dmarc")
Value: v=DMARC1; p=none;
TTL:   Auto atau 3600
```

> **Tips**: Di beberapa registrar, field "Name" cukup isi subdomain saja (`send`, `resend._domainkey`, `_dmarc`) tanpa perlu `.lapakin.my.id` di belakangnya karena root domain sudah implisit.

Setelah tambah record, klik **Verify DNS Records** di dashboard Resend. Biasanya propagasi 5-30 menit, max 24 jam.

Status berubah dari `pending` → `verified` (hijau). Setelah itu baru boleh kirim dari `noreply@lapakin.my.id`.

## Langkah 3 — Kasih Key-nya ke Aplikasi

Setelah key dari Langkah 1 ready, paste ke aku (Emergent main agent) di chat:
```
RESEND_API_KEY = re_xxxxxxxxxx...
```

Aku akan:
1. Update `/app/backend/.env` dengan key kamu
2. Restart backend
3. Test kirim real email ke alamat kamu untuk verifikasi

## Cara Kerja Email di Lapakin

| Trigger                               | Email                          | Template                       |
|---------------------------------------|--------------------------------|--------------------------------|
| User register baru                    | Welcome + Trial Pro 14 hari    | `welcome(name)`                |
| User klik "Lupa password"             | Reset link (expiry 60 menit)   | `password_reset(name, link)`   |
| User login saat trial H-3 sampai H-0  | Trial expiring reminder        | `trial_expiring(name, days)`   |
| Produk baru tayang via WhatsApp Bot   | Konfirmasi owner               | `product_created_via_wa(...)`  |

### Mode "No-op Logging" (tanpa RESEND_API_KEY)
- Aplikasi tetap jalan normal, tidak crash
- Email yang seharusnya dikirim → di-log ke `/var/log/supervisor/backend.err.log`
- Forgot-password fallback: token reset langsung ditampilkan di UI (seperti sebelumnya)

Setelah `RESEND_API_KEY` di-set:
- Email beneran dikirim via Resend
- Forgot-password UI hanya tampilkan toast "Cek inbox kamu" (tidak lagi tampilkan token)

## Troubleshoot

**Email tidak sampai / masuk Spam**
- Cek `/var/log/supervisor/backend.err.log` — cari baris `[EMAIL→...]` vs `[EMAIL-FAIL→...]`
- Pastikan SPF + DKIM status `verified` di Resend dashboard
- DMARC policy = `none` (biar bisa warmup sebelum strict)

**Error "You can only send testing emails to your own email address"**
- Artinya domain belum di-verify. Gunakan `onboarding@resend.dev` sementara (ubah `SENDER_EMAIL` di `.env`), dan send hanya ke email yang sudah kamu verifikasi.

**Ingin warm-up dulu sebelum blast 100 email/hari?**
- Resend free tier cukup untuk UMKM kecil. Kalau mau blast newsletter, upgrade ke `$20/mo = 50.000 email/bulan`.
