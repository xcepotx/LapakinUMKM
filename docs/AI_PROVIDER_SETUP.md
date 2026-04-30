# Setup AI di VPS Production (Gemini API)

⚠️ **Masalah**: `EMERGENT_LLM_KEY` (Universal Key Emergent) hanya bisa dipakai dari **dalam** preview environment Emergent. Untuk production VPS, kita perlu API key dari provider langsung.

✅ **Solusi**: Pakai **Google Gemini API** — ada free tier yang **lebih dari cukup** untuk Lapakin (15 req/menit, 1500 req/hari gratis).

---

## ① Dapatkan Gemini API Key (Gratis, 2 menit)

1. Buka https://aistudio.google.com/app/apikey
2. Login dengan akun Google kamu
3. Klik **"Create API Key"**
4. Pilih project (atau buat baru, default OK)
5. Copy key — format: `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` (39 karakter)

**Free tier limit (per Februari 2026)**:
- ✅ Gemini 2.5 Flash: **15 RPM**, **1,500 req/hari**, **1M token/hari**
- ✅ Gemini 2.5 Pro: 5 RPM, 25 req/hari (untuk story panjang)
- 💰 Pay-as-you-go kalau lewat limit (sangat murah, $0.075/1M input token)

Untuk Lapakin sehari-hari (~50 tip generation + 5-10 story draft), **free tier cukup banget**.

---

## ② Set di `.env` VPS

SSH ke VPS, lalu:

```bash
cd /home/lapakin/LapakinUMKM/backend
nano .env
```

**Tambahkan di akhir file**:
```bash
GEMINI_API_KEY="AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

⚠️ **JANGAN hapus** key lain di `.env` (MONGO_URL, RESEND_API_KEY, dst). Cuma tambah baris baru.

Save (Ctrl+X → Y → Enter).

---

## ③ Restart Backend

```bash
pm2 restart lapakin-backend

# Verify reading env
pm2 logs lapakin-backend --lines 5
```

---

## ④ Verify

```bash
# Login admin
ADMIN_TOKEN=$(curl -s -X POST https://lapakin.my.id/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lapakin.id","password":"YOUR_ADMIN_PASS"}' | \
  python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Test AI tip generation
curl -s -X POST https://lapakin.my.id/api/tips/today/refresh \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -m json.tool

# Test AI story generation
curl -s -X POST https://lapakin.my.id/api/admin/stories/draft \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"shop_slug":"warung-bu-sari"}' | python3 -m json.tool | head -30
```

Kalau muncul JSON dengan `"title": "..."` dan `"content_md": "..."` → ✅ **AI work**.

---

## 🔍 Troubleshooting

### Error 403 "API key not valid"
Pastikan key dari https://aistudio.google.com/app/apikey (BUKAN Google Cloud Console). Region kamu mungkin perlu enable API Studio dulu.

### Error 429 "Quota exceeded"
Sudah hit limit free tier. Tunggu 1 menit (RPM reset) atau besok pagi (daily reset). Atau enable billing di Google Cloud untuk pay-as-you-go (sangat murah).

### Error tetap "Free users can only use Universal Key from within Emergent"
Berarti `GEMINI_API_KEY` belum ke-load. Cek:
```bash
cd /home/lapakin/LapakinUMKM/backend
grep GEMINI_API_KEY .env
# Harus muncul. Kalau kosong → re-add dan restart pm2.
```

Atau kode lama belum di-pull. Pull terbaru:
```bash
cd /home/lapakin/LapakinUMKM
git pull origin main
pm2 restart lapakin-backend
```

---

## 💡 Provider Alternatif + Failover

Kalau gak suka Gemini, bisa pakai OpenAI:

```bash
# Daftar di https://platform.openai.com → API keys
# Top-up minimal $5 di Billing → Payment methods

# Tambah ke .env:
OPENAI_API_KEY="sk-proj-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

### 🔁 Automatic Failover Chain (NEW)

Backend **secara otomatis** try provider chain berurutan saat error (quota, rate limit, network):

1. `GEMINI_API_KEY` (primary)
2. `OPENAI_API_KEY` (kalau Gemini fail → auto switch)
3. `EMERGENT_LLM_KEY` (preview env only)

**Cara pakai**: set **2 keys sekaligus** di `.env` untuk resilience maksimal:
```bash
GEMINI_API_KEY="AIzaSy..."        # Primary (gratis, 1500 req/hari)
OPENAI_API_KEY="sk-proj-..."      # Fallback (kena charge $0.001/req kalau kena)
```

Kalau Gemini quota habis di tengah jam sibuk, user kamu gak notice apa-apa — OpenAI otomatis take over. Log tercatat di backend:
```
llm.chat_text — fell back to 'openai' after 'gemini' failed (attempt #2)
```

### 🔍 Cek Status Provider dari Admin Panel

Login admin, lalu:
```bash
curl -s https://lapakin.my.id/api/admin/llm/status \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Output:
```json
{
  "active": "gemini",
  "chain": ["gemini", "openai"],
  "count": 2,
  "ok": true
}
```

Kalau `count: 0` atau `ok: false` → belum ada API key yang ke-set, AI features bakal gagal.

---

## 📊 Monitoring Usage

Cek penggunaan kuota:
- Gemini: https://aistudio.google.com/app/usage
- OpenAI: https://platform.openai.com/usage

Untuk 100 user aktif dengan 1 tip/hari + 1 story draft seminggu sekali, estimate:
- ~3,000 req/bulan
- ~$0.50/bulan (OpenAI gpt-4o-mini)
- $0 (Gemini free tier — masih dalam batas)

---

## ✅ Checklist Sebelum Generate Cerita di Production

- [ ] Gemini API Key sudah dapat dari aistudio.google.com
- [ ] `.env` sudah di-update dengan `GEMINI_API_KEY="..."`
- [ ] `pm2 restart lapakin-backend` sudah dijalankan
- [ ] Test curl `/api/tips/today/refresh` → return JSON tip valid
- [ ] Test curl `/api/admin/stories/draft` → return JSON story valid
- [ ] Buka admin panel `/admin/stories` → klik "Generate Draft" → tampil draft

Setelah semua ✅, **AI features fully working di VPS production tanpa dependency Emergent**. 🚀
