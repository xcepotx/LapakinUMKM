# Midtrans Snap Setup Guide — Lapakin

Panduan 4 langkah untuk aktifin pembayaran otomatis via Midtrans (QRIS, GoPay, OVO, DANA, ShopeePay, transfer bank, kartu kredit).

## Langkah 1 — Buat Akun Midtrans (gratis)

1. Buka [https://dashboard.midtrans.com/register](https://dashboard.midtrans.com/register)
2. Daftar pakai email bisnis + nomor HP
3. Verifikasi email + HP
4. Isi **Business Profile** (nama PT/CV/UD, alamat, NPWP jika ada)
5. Upload dokumen KYC (KTP + akta/SIUP) — butuh 1-3 hari kerja untuk approve **production key**

> **Sandbox key tersedia langsung tanpa KYC**, jadi kamu bisa tes flow dulu sambil nunggu approval production.

## Langkah 2 — Ambil API Keys

### Sandbox (untuk testing)
1. Login ke [dashboard.midtrans.com](https://dashboard.midtrans.com)
2. Di pojok kanan atas, pilih **Environment = Sandbox**
3. Menu kiri: **Settings → Access Keys**
4. Copy:
   - **Server Key** (format: `SB-Mid-server-xxxxxxxxxxxxxxx`)
   - **Client Key** (format: `SB-Mid-client-xxxxxxxxxxxxxxx`)

### Production (setelah KYC approve)
Ulangi langkah di atas dengan **Environment = Production**. Key production **tidak** diawali `SB-`.

## Langkah 3 — Set Webhook URL

Midtrans perlu tahu ke mana harus kirim notifikasi payment.

1. Dashboard Midtrans → **Settings → Configuration**
2. **Payment Notification URL**: 
   - Sandbox: `https://<preview-url>/api/payment/webhook`
   - Production: `https://lapakin.my.id/api/payment/webhook`
3. **Finish Redirect URL** (opsional, kalau customer pakai desktop credit card): 
   - `https://lapakin.my.id/dashboard/billing`
4. **Unfinish Redirect URL**: sama
5. **Error Redirect URL**: sama
6. Klik **Update**

> **Penting**: Midtrans akan test webhook URL dengan POST kosong. Endpoint kita return 403 untuk signature invalid — itu wajar, Midtrans cuma cek URL aktif (status code < 500 OK).

## Langkah 4 — Kasih Keys ke Aplikasi

Paste ke aku di chat, formatnya:
```
MIDTRANS_SERVER_KEY = SB-Mid-server-xxxxxxxxxxxxx
MIDTRANS_CLIENT_KEY = SB-Mid-client-xxxxxxxxxxxxx
MIDTRANS_IS_PRODUCTION = false
```

Aku akan:
1. Update `/app/backend/.env`
2. Restart backend
3. Test create-transaction + simulasi webhook pakai test card
4. Kasih kamu link `/pricing` untuk tes langsung

## Test Credentials (Sandbox)

Saat testing di sandbox, pakai test data ini:

### Credit Card
- Card Number: `4811 1111 1111 1114` (Visa sukses)
- Expiry: `12/28` (tanggal future)
- CVV: `123`
- OTP: `112233`
- 3DS Password: `112233`

### E-wallet
- **GoPay**: Scan QR di popup, auto-approve di sandbox
- **ShopeePay**: Auto-approve
- **OVO**: Auto-approve
- **DANA**: Auto-approve
- **QRIS**: Scan QR, auto-approve

### Bank Transfer (VA)
- Pilih bank (BCA/BNI/Mandiri/Permata)
- Copy Virtual Account number
- Simulasi pembayaran: [https://simulator.sandbox.midtrans.com/](https://simulator.sandbox.midtrans.com/) — masukkan VA number + klik pay

## Cara Kerja di Lapakin

| User Action                          | Backend                                     | Next |
|--------------------------------------|---------------------------------------------|------|
| Klik "Upgrade ke Pro" di /pricing    | `POST /api/payment/create-transaction`      | Return `snap_token` |
| Frontend pop Snap checkout           | —                                           | User bayar via Snap popup |
| User selesai bayar                   | Midtrans kirim notif → `POST /api/payment/webhook` | Verifikasi signature → update status |
| Frontend polling `/payment/status/:id` | Cek DB status                              | Aktivasi tier + redirect |
| Tier aktif                           | `user.tier = "pro"`, `subscription_expires_at = now+30d` | Fitur Pro langsung jalan |

### Expired Subscription
Setiap hit ke endpoint authenticated (`require_user`), backend cek `subscription_expires_at < now`. Kalau expired → auto-downgrade ke `free`.

### Idempotency
- Tiap Snap transaction dapat unik `order_id: lapakin-<plan_id>-<10char-hex>`
- Webhook cek `existing.status == "success"` sebelum aktivasi lagi → mencegah double-activation kalau Midtrans retry webhook
- Pending transaksi di 15 menit terakhir direuse kalau user klik tombol upgrade lagi (tidak buat token baru tiap klik)

## Troubleshoot

**"Pembayaran belum aktif. Admin belum mengonfigurasi Midtrans."**
- `MIDTRANS_SERVER_KEY` atau `MIDTRANS_CLIENT_KEY` kosong di `.env`. Isi lalu `sudo supervisorctl restart backend`.

**Webhook 403 "Invalid signature"**
- Kemungkinan: `MIDTRANS_SERVER_KEY` production tapi Midtrans kirim dari sandbox (atau sebaliknya). Pastikan `MIDTRANS_IS_PRODUCTION` match dengan environment keys yang kamu pakai.

**Status stuck di "pending" padahal sudah bayar**
- Cek log backend: `tail -f /var/log/supervisor/backend.err.log | grep -i midtrans`
- Cek dashboard Midtrans → **Transactions** → cari order_id-nya, lihat status di sana
- Kadang Midtrans sandbox delay 30-60 detik sebelum kirim webhook

**"Snap library failed to load"**
- Script tag inject dengan URL salah. Cek `/api/payment/config` response — `snap_url` harus sesuai `is_production`
- Ad-blocker user bisa block Snap.js. Suggest user buka di browser incognito.

**User sudah bayar tapi tier masih Gratis di dashboard**
- Frontend akan polling `/payment/status/:id` sampai 3 menit. Kalau timeout, user bisa refresh manual — `require_user` akan trigger re-fetch tier dari DB yang sudah update.

## Fee Midtrans (FYI untuk pricing strategy)

Fee resmi Midtrans ([midtrans.com/pricing](https://midtrans.com/pricing)):
- **QRIS**: 0.7% + Rp 500
- **GoPay / ShopeePay / OVO / DANA**: 2% + Rp 1.000
- **Credit Card**: 2.9% + Rp 2.000
- **VA Bank (BCA/Mandiri/BNI/Permata)**: Rp 4.000 flat per transaksi
- **Convenience Store (Alfamart/Indomaret)**: Rp 5.000 flat

Untuk Pro Rp 49.000/bulan via QRIS: fee = Rp 843 → net Rp 48.157 (~98.3%).
