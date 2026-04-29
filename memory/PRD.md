# Lapakin — PRD

## Original Problem Statement (Bahasa Indonesia)
> "Saya sedang merancang system seperti CMS… Saya lihat banyak UMKM yang kesulitan membuat website sendiri… para owner ini pasti tidak tahu soal backend nya seperti domain VPS security dll, sampai kata-kata yang mau dibuat untuk deskripsi produknya tidak tahu, sampai menampilkan fotonya juga jelek-jelek… target UMKM, di mana mereka tidak mengerti soal AI atau buat teknologi."

User confirmed concept: **WhatsApp/Web-first AI CMS** for UMKM where AI handles photo enhancement, product copywriting, and IG/TikTok caption generation. Brand: **Lapakin**. Tagline: *"AI bikin tokomu cling."*

## Architecture
- **Frontend**: React (CRA + craco), Tailwind, shadcn/ui, lucide-react, Plus Jakarta Sans + Manrope
- **Backend**: FastAPI + Motor (MongoDB), bcrypt, PyJWT, httpx
- **AI**: Emergent Universal LLM Key
  - **Gemini 2.5 Flash** for content generation (Indonesian copywriting)
  - **Gemini Nano Banana (gemini-3.1-flash-image-preview)** for product photo enhancement
- **Auth**: Custom JWT (email+password) + Emergent Google OAuth — coexisting, auto-link by email

## User Personas
1. **Bu Sari (warung kuliner)** — gaptek, jualan via WA, butuh website tapi gak ngerti hosting
2. **Mas Adi (kopi specialty)** — sudah punya IG tapi konten manual, butuh content factory
3. **Mbak Ratih (UMKM kerajinan)** — pingin foto produk profesional tanpa beli kamera mahal

## Core Requirements (Static)
- Login & register dengan email/password atau Google
- Onboarding singkat (2 langkah) untuk buat toko
- AI Studio: upload foto → enhance + generate deskripsi/caption Indonesia
- CRUD produk
- Storefront publik mobile-first di `/toko/{slug}` dengan checkout WhatsApp
- Bahasa Indonesia di seluruh UI

## What's Been Implemented (✅ 2026-04-29)

### Iteration 2 (✅ 2026-04-29 — features 1, 4, 5 + simplified 2 & 3)
- **Edit Produk**: `EditProductDialog` component with full edit (name, price, stock, description, captions, hashtags, images reorder/remove)
- **Multi-foto produk**: up to 5 images per product. Backward-compat field `image_data` auto-syncs to `images[0]`. Storefront has lightbox with prev/next.
- **Forgot Password (simple mode)**: token returned in API response + UI "reset link card" with copy/open buttons. Real email send deferred to phase 2.
- **WhatsApp Bot via Twilio**: webhook endpoint at `/api/whatsapp/webhook` that handles pairing (`lapakin <code>`), help, list, unlink, and full product creation flow (text + media). Indonesian price parser handles `25000`, `25rb`, `25k`, `Rp 25.000`. Twilio creds optional — bot works without them in pairing/list modes (webhook returns TwiML XML directly). `_wa_send` and `_download_media` no-op when creds absent.
- **Auto-post Instagram (Share Pack mode)**: instead of full Meta Graph API, the AI Studio now has a "Share Pack 📦" section with: download all images, copy IG caption + hashtags to clipboard, copy TikTok caption, "Share Pack (IG)" one-click combo. No external API needed; pragmatic for UMKM that still post manually.

### Backend (`/app/backend/server.py`)
- Auth: register/login/logout/me/refresh, JWT cookies + Bearer fallback, bcrypt hashing, brute-force not yet (deferred)
- Google OAuth: `/api/auth/google/session` exchanges Emergent session_id → cookie
- Shops CRUD: create with auto-unique slug, update, get-by-slug (public)
- Products CRUD: create/list/update/delete with ownership checks
- AI: `/api/ai/enhance-image` (Nano Banana), `/api/ai/generate-content` (Gemini 2.5 Flash JSON), `/api/ai/suggest-theme`
- MongoDB indexes on email, slug, session_token TTL
- Admin auto-seed (`admin@lapakin.id` / `lapakin123`)

### Frontend (`/app/frontend/src/`)
- Landing page (`/`) — hero terracotta + warm sand, features, cara kerja, harga, CTA
- Login + Register (with Google button)
- AuthCallback for `#session_id=` flow
- Onboarding (2-step) with AI theme suggestion
- Dashboard with stats + storefront URL copy
- AI Studio with image enhance + content generation + clipboard copy per field
- Products list with delete
- Shop Settings
- Public Storefront (`/toko/:slug`) with WhatsApp checkout button

### Verified (testing agent iteration 1)
- 25/25 backend pytest passing
- All critical frontend flows green: register → onboarding → dashboard → AI Studio (enhance + generate + save) → products → public storefront → logout
- Nano Banana actually returned an enhanced image
- AI generate-content returns proper JSON with Indonesian description, IG caption, TikTok caption, and 8 hashtags

## Backlog (Prioritized)

### P0 — Next sprint
- [ ] (none — all P0 from iter1 are done)

### P1 — Phase 2
- [ ] Email service (Resend/SendGrid) for forgot-password instead of "simple mode"
- [ ] Real Twilio creds + signature verification (X-Twilio-Signature HMAC) on `/api/whatsapp/webhook`
- [ ] Direct Instagram posting via Meta Graph API (currently Share Pack manual flow)
- [ ] Auto-post to TikTok via TikTok Business API
- [ ] Custom domain support
- [ ] Categories / tags for products

### P2 — Phase 3
- [ ] Marketplace mode (`gou mkm.id`-style hub)
- [ ] Stripe / Midtrans / QRIS payment integration
- [ ] Order management & analytics
- [ ] Subscription billing (Free / Premium tiers)
- [ ] AI Reels generator (Sora 2)

## Known Code-Review Notes (non-blocking)
- `server.py` is monolithic (~540 lines) — split into routers when adding more features
- Tighten CORS allowlist in production (currently `*`)
- Friendly Indonesian error messages for AI failures
- Use `<a target="_blank">` instead of `onClick` for "Lihat Toko" so middle-click works
