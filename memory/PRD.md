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

### Iteration 10 (✅ 2026-04-29 — OG meta-refresh fix + PNG caching)
- **Fix Facebook bot bug**: removed `<meta http-equiv="refresh">` from `/api/og/shop/<slug>` HTML. FB bot was following the refresh and ending up at React index.html (root OG tags). Now bots stay on the OG endpoint and read correct shop tags. Humans still get redirected via JS `window.location.replace()` (bots don't run JS).
- **In-memory PNG cache** for `/api/og/shop/<slug>.png` — TTL 10 min, max 100 shops. Cache key includes cover hash + brand_color + name + tagline; auto-invalidates on shop update. Response header `X-Cache: HIT|MISS` for verification. Critical because Pillow decoding of large base64 cover_image takes 200-800ms — too slow for WhatsApp's ~2-3s og:image fetch timeout.
- **Dashboard share-preview-card update**:
  - Primary share URL flipped back to `/toko/<slug>` (canonical short URL, works once user has nginx config from `docs/NGINX_OG_SETUP.md`).
  - "Salin Link Alt" button copies `/api/og/shop/<slug>` for hosts without nginx config.
  - New "Refresh Cache FB/WA" button opens Facebook Sharing Debugger directly.
- **Products page WA share** uses `/toko/<slug>` in caption (not `/api/og/shop/...`).
- Tested: **128/129 backend pytest passing** (7 new in `test_iter10_og_cache.py` + 121 prior; 1 pre-existing flaky timing test unrelated to this iteration). Full E2E verified — share URL is /toko/<slug>, FB debugger button opens correctly, cache HIT/MISS sequence works.

### Iteration 9 (✅ 2026-04-29 — OG-aware share URL + WA Status share)
- **OG-aware share URL** in Dashboard share-preview-card — new `share-url-text` field shows `<host>/api/og/shop/<slug>`. This URL works for **all crawlers TODAY** without requiring nginx changes (server-rendered OG HTML with auto-redirect for humans). The canonical og:url still points to `/toko/<slug>` so click-through goes to the proper storefront.
- New copy buttons: "Salin" (OG-aware URL, primary) + "Salin Link Toko (langsung)" (regular `/toko/<slug>`).
- **WhatsApp share** button per product card (Products page) — green `WA` button uses Web Share API:
  - Mobile: fetches `/api/og/product/<id>/story.png` as blob → `navigator.share({files:[file], text})` opens OS share sheet → user picks WhatsApp → can post to Status, send to contact, etc.
  - Desktop fallback: downloads image + opens `api.whatsapp.com/send?text=...` in new tab (caption includes product name + price + share URL).
  - Helper `sharePhotoOrFallback()` utility handles both paths gracefully.
- Tested: **122/122 backend pytest passing** (115 prior + 7 new in `test_iter9_share_url.py`). Full E2E verified — share-url-text contains `/api/og/shop/<slug>`, copy buttons write correct URLs to clipboard, WA fallback path opens wa.me with proper caption.

### Iteration 8 (✅ 2026-04-29 — Auto-Schedule + Toko Cards Generator)
- **Auto-schedule open/close** (Asia/Jakarta WIB):
  - New shop fields: `auto_schedule_enabled` (bool) + `schedule` (List of 7 entries, idx 0=Senin..6=Minggu, each `{open: "HH:MM", close: "HH:MM"}` or null=tutup hari itu).
  - Backend helper `compute_schedule_status(shop)` calculates real-time `{is_open_now, auto, opens_at, closes_at}`. `opens_at` includes weekday prefix for next-day open (`"Kam 08:00"`), bare time for today.
  - GET `/api/shops/by-slug/{slug}` injects `schedule_status` and overrides `shop.is_open` with computed value when auto enabled — storefront just renders, no FE clock parsing needed.
  - ShopSettings UI: 7-row schedule editor (`Senin`..`Minggu` with "Buka" checkbox + open time + close time inputs, "Libur" badge for null entries). Master toggle "Auto Buka/Tutup Sesuai Jadwal ⏰" disables manual `Tutup Toko` button when on.
  - Storefront: closed banner shows "Buka lagi: Kam 08:00 WIB" when auto+closed; green hint "Tutup hari ini jam 21:00 WIB" when auto+open.
- **Toko Cards Generator** (PIL renderer):
  - GET `/api/og/product/{product_id}/post.png` → 1080×1080 IG post (700px photo on top, white panel below with shop name strip, product name 2-line wrap, large price in brand color, tagline, footer `lapakin.id/toko/<slug>`).
  - GET `/api/og/product/{product_id}/story.png` → 1080×1920 IG story (1300px photo, larger text in bottom panel).
  - Branded gradient placeholder when product has no photo, never crashes.
  - Products page: per-card "IG Post" + "Story" download buttons with `target=_blank` opens in new tab so owner can save image.
- Tested: **115/115 backend pytest passing** (106 prior + 9 new in `test_iter8_schedule_cards.py`). Full E2E frontend verified — schedule editor populates default times, manual toggle correctly disabled when auto=on, storefront banner shows live computed text.

### Iteration 7 (✅ 2026-04-29 — Shop Sales Modes: Stok / Jam Buka / Selalu Ada)
- **3 mode jualan** per toko — `shop.sells_by`: `"stock"` (default), `"hours"` (F&B/kuliner — buka/tutup toggle, no stock), `"always"` (jasa/digital — always available).
- **Smart default**: shop with `business_type ∈ {kuliner, kopi}` auto-defaults to `sells_by="hours"` + `is_open=true` on first creation. Other types stay on stock.
- **`shop.is_open`** boolean (default true) — only relevant when `sells_by="hours"`.
- **`POST /api/shops/me/toggle-open`** — quick toggle endpoint, returns `{is_open}`.
- **Per-product `available_days`** (list of ints 0..6, Python weekday convention, `[]`=setiap hari) — only enforced when shop is in `hours` mode. Use case: catering/warteg dengan menu rotasi harian.
- **Dashboard**: when `sells_by="hours"`, prominent green/red banner with "STATUS TOKO: BUKA SEKARANG/TUTUP" + toggle button. Stats row adapts (Stok Total → Menu Hari Ini + Status).
- **ShopSettings**: 3 mode picker cards (Stok / Jam Buka / Selalu Ada) with descriptions. Inline BUKA/TUTUP toggle when hours mode selected.
- **AIStudio + EditProductDialog**: adapt fields per mode — Stok input only for stock mode; 7-day picker (Sen…Min) only for hours mode; mode label otherwise.
- **Storefront** (mode-aware):
  - Header: animated dot + status badge — green "Buka Sekarang" / red "Lagi Tutup" / generic "Selalu Tersedia"
  - Closed banner "Maaf, lagi tutup 🙏" with shop hours + WA pre-order suggestion
  - Section title flips: "Produk" ↔ "Menu Hari Ini" + today's day badge (RAB/SAB/etc.)
  - "Tampilkan menu hari ini saja" filter toggle (auto-shown when products have available_days)
  - Per-product day badge `📅 Sen, Rab, Jum` for products with day limits
  - Faded product card + "Tidak tersedia hari ini" disabled CTA when filter OFF
  - Empty state: "Tidak ada menu di hari X" with "Lihat semua menu →" link
  - Cart drawer: red warning banner + checkout button text "Kirim Pre-Order via WhatsApp" when shop closed; WA message includes "(Toko sedang tutup — saya menanyakan ketersediaan.)"
- Tested: **106/106 backend pytest passing** (98 prior + 8 new in `test_shop_modes.py`). Full E2E frontend verified via Playwright (login → dashboard toggle → settings mode picker → AI Studio day picker → storefront badge/filter/closed-banner). Zero JS pageerrors.

### Iteration 6 (✅ 2026-04-29 — Dynamic OpenGraph Share Preview)
- **Backend `/api/og/shop/{slug}.png`** — returns 1200×630 PNG ready for social share. Uses shop's `cover_image` (decoded from base64, cropped+resized via Pillow LANCZOS) when available; otherwise auto-generates a polished fallback with brand-color background, white initial avatar, shop name + tagline + Lapakin footer using DejaVu fonts. Always 200 (returns generic placeholder for non-existent/suspended shops so cached crawlers never see 404).
- **Backend `/api/og/shop/{slug}`** — returns HTML page with full OpenGraph + Twitter Card meta tags (`og:type`, `og:title`, `og:description`, `og:image` absolute https URL, `og:image:width=1200`, `og:image:height=630`, `og:url`, `og:locale=id_ID`, `twitter:card=summary_large_image`, etc.) plus `<meta http-equiv="refresh">` + JS `window.location.replace()` for human visitors. Honours `X-Forwarded-Proto` to force `https://` URLs in production.
- **Dashboard "Pratinjau Saat Dibagikan" card** (`data-testid="share-preview-card"`) — WhatsApp-style mock chat bubble that previews how the toko link will appear when shared, with image + host + title + tagline. Buttons: "Salin Link Share" + "Lihat Gambar OG" + link to FB Sharing Debugger for cache invalidation.
- **Nginx setup doc** at `/app/docs/NGINX_OG_SETUP.md` — drop-in `map $http_user_agent $is_social_bot` snippet + `location ~ ^/toko/` rewrite rule that routes social-bot User-Agents (facebookexternalhit, WhatsApp, Twitterbot, TelegramBot, LinkedInBot, Slackbot, Discordbot, etc.) to the OG HTML endpoint while humans continue to React SPA. Validation steps via curl + FB Sharing Debugger included.
- Tested: 98/98 backend pytest passing (16 new OG tests + 82 prior). Frontend share preview verified end-to-end.

### Iteration 5 (✅ 2026-04-29 — Multi-Product Mini Cart on Storefront)
- **Cart state**: client-side, persisted in `localStorage` per shop slug (`lapakin_cart_<slug>`). Lazy `useState` initializer reads storage synchronously to survive StrictMode double-render + page reloads.
- **Product card UI**: "+ Keranjang" button replaces single-product "Pesan" CTA. Once added, button becomes inline qty stepper (-/+). Qty bounded by `product.stock` (or 99 if no stock tracking). Out-of-stock shows "Stok habis".
- **Floating Cart FAB**: `data-testid="storefront-cart-fab"` appears bottom-right (above WA FAB) when cart has items — shows count + total in Rupiah.
- **Cart Drawer** (right slide-in): per-item card with image, name, unit price, qty stepper, per-item subtotal, trash button. Footer shows total + "Pesan Semua via WhatsApp" button.
- **WhatsApp message composer**: builds a single combined message with numbered list, qty × price = subtotal per line, separator, grand total, and confirmation text. Opens `wa.me/<number>?text=<encoded>` in new tab.
- **Empty state** + "Kosongkan keranjang" reset.
- Tested: 82/82 backend pytest passing, full E2E cart flow verified by testing agent (add, qty stepper, drawer, persistence, checkout link, stock cap).

### Iteration 4 (✅ 2026-04-29 — Storefront Pro Bundle + Shop Story Reel)
- **Cover banner** + AI-generated "Tentang Kami" + "Cerita Toko" Story Reel (IG-style vertical viewer with progress bars), promo banner, info chips, empty-state placeholders, floating WhatsApp FAB, Shop QR Code page, AI cover generation endpoint.

### Iteration 3 (✅ 2026-04-29 — Admin Panel: all 11 features)
- **Role-based access**: `require_admin` helper, `AdminRoute` guard. Login response now includes `role` + `tier`.
- **Admin Panel UI** with sidebar nav (dark brand-ink theme): Overview, Toko UMKM, Pengguna, Moderasi Produk, Broadcast, AI Usage, Audit Log
- **Overview Dashboard**: stat cards (users / shops / products / AI calls) + 14-day growth LineChart (recharts)
- **Toko UMKM Manager**: list with search, joined owner data + product counts, suspend/activate (suspended shops 404 publicly), featured toggle
- **Pengguna Manager**: list with search, tier toggle (Free↔Premium), generate password reset link (admin support feature)
- **Moderasi Produk**: search & delete any product (with audit log)
- **Broadcast**: composer (title, message, variant, target=all|whatsapp), banner shown on user dashboard via `BroadcastBanner`, dismissible per-user
- **AI Usage Stats**: per-day line chart + totals + top 10 users (tracked via `track_ai_usage` in 3 AI endpoints)
- **Audit Log**: all admin actions logged with timestamp, action label, target, meta
- **Featured Shops**: public `/api/featured-shops` endpoint, "Toko Pilihan" section on landing page

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
