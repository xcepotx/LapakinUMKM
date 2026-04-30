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

### F&B Enhancements + Subdomain Live Email (✅ 2026-04-30)

#### F&B Enhancements (`schedule_utils.py` rewrite + new endpoint)
- **Snooze Buka 30 menit**: new field `shop.snooze_until` (ISO datetime). New endpoint `POST /api/shops/me/snooze {minutes}` — sets snooze for N minutes (0=cancel, max 480). Snooze overrides any open-state, including auto-schedule and `sells_by="always"`. Auto-expires when timestamp passes.
- **Pre-order cutoff**: new field `shop.last_order_minutes_before_close` (int). When current time within active shift but past `(close - cutoff)`, `accepting_orders=false` is set. Storefront shows yellow banner "Pesanan hari ini sudah ditutup. Last order tadi pukul HH:MM WIB". Add-to-cart disabled.
- **Multi-shift schedules**: schedule entry now supports `{shifts: [{open, close}, ...]}` format (max 2 shifts/day in UI). Backward-compatible with legacy `{open, close}` single-shift entries — old shops Just Work. Storefront's `closes_at` and `opens_at` correctly reflect the active or next shift.
- **Frontend**:
  - `Dashboard.jsx`: new amber Snooze card with 15/30/60 min buttons + "Buka lagi N menit lagi" + Batalkan. Snooze state shown above stats grid.
  - `Storefront.jsx`: snooze banner (amber ☕), pre-order cutoff banner (yellow), last-order hint inline with closes-at chip.
  - `ShopSettings.jsx`: schedule editor refactored to support per-day "+ Tambah shift kedua (mis. dinner)" with remove button. New "Last Order Sebelum Tutup" pill picker (0/15/30/45/60 menit).
- **Tests**: `tests/test_fb_enhancements.py` — 10 unit tests covering snooze active/expired/override, multi-shift open/closed/between, legacy single-shift compat, cutoff reached/not-reached/disabled. All passing.

#### Subdomain Live Email (one-shot delight)
- New email template `email_templates.subdomain_live(name, shop_name, subdomain_url)` — terracotta dashed-border CTA card with the subdomain URL, IG bio tip.
- `share-health` endpoint now fires this email **once** when `dns_resolves=True` AND `og_valid=True` AND `user.subdomain_live_notified_at` is unset. Sets the timestamp atomically so no duplicate sends.
- Returns `subdomain.just_notified=True` in the response so frontend could optionally show toast (not wired yet — kept email-only for first version).


### Share Health Widget + Cloudflare SSL Auto-Renew Guide (✅ 2026-04-30)
- **Backend**: new `GET /api/shops/me/share-health` (in `routes/shops.py`). Returns:
  - `apex`: `/toko/<slug>` URL on current host
  - `subdomain`: `<slug>.lapakin.my.id` URL + `dns_resolves` (via `socket.gethostbyname`) + `reachable` (via `httpx` with FB UA) + `og_valid` (checks `og:title` & `og:image` in body)
  - `can_use_subdomain` (from `tiers.get_limits(tier).custom_subdomain`) — false for free, true for pro/business
  - `og_image_url` for dashboard preview
- **Tests**: `tests/test_share_health.py` — 4 cases (auth, no-shop, free upsell, pro DNS probe). All passing.
- **Frontend**: new `src/components/ShareHealthCard.jsx` — dashboard widget with apex link + subdomain link + health badges (green/yellow/red) + FB Debugger / LinkedIn Post Inspector quick-links. Free tier shows upsell with Lock icon linking to `/pricing`. Inserted at top of Quick-Actions column in `Dashboard.jsx`.
- **Docs**: `/app/docs/CLOUDFLARE_SSL_AUTORENEW.md` — comprehensive guide for Rumahweb users to transfer DNS management to Cloudflare (free) and enable Certbot `dns-cloudflare` plugin for auto-renewal every 60 days. Includes: nameserver change steps, API token creation, plugin install, dry-run verification, Cloudflare bonus features, troubleshooting.


## What's Been Implemented (✅ 2026-04-30)

### Wildcard Subdomain Routing for Pro/Bisnis Tiers (✅ 2026-04-30)
- **Frontend**:
  - `src/lib/tenant.js` — `detectTenantSlug()` parses `window.location.hostname` and returns slug when host matches `<slug>.lapakin.my.id`. Reserved prefixes (`www`, `admin`, `api`, `cdn`, `static`, `assets`) and multi-level / apex domains return `null`. Slug is validated against `^[a-z0-9][a-z0-9-]{0,40}$`.
  - `src/App.js` — `AppRouter` calls `detectTenantSlug()` once; when truthy, the `/` route renders `<Storefront tenantSlug={slug} />` instead of `<Landing />`. All other routes (login, dashboard, admin, `/toko/:slug`) remain intact.
  - `src/pages/Storefront.jsx` — now accepts `tenantSlug` prop and resolves effective slug as `useParams().slug || tenantSlug`. No other code path changes.
  - `src/lib/__tests__/tenant.test.js` — 11 regression cases (tenant hosts, reserved prefixes, apex, localhost, IP, preview domain). All pass.
- **NGINX** (`deploy/nginx-lapakin.conf`): second `server` block with regex `server_name ~^(?<tenant_slug>(?!www|admin|api|cdn|static)[a-z0-9-]+)\.lapakin\.my\.id$`. At `location = /` with bot UA, rewrites to internal `/_og_proxy` → `http://127.0.0.1:8001/api/og/shop/$tenant_slug` so IG/FB/WA previews show the dynamic OG card even on subdomains. Human traffic falls through to SPA (`/index.html`) which boots React → `detectTenantSlug()` → storefront.
- **DNS/SSL requirement** (user-side): wildcard `*.lapakin.my.id` A-record + Certbot DNS-01 challenge for wildcard cert. Documented earlier in `/app/docs/VPS_REINSTALL_GUIDE.md`.
- **Verified**: `/toko/warung-bu-sari` (regression — still renders) + `/` with spoofed hostname `warung-bu-sari.lapakin.my.id` (shows storefront, not landing).


## What's Been Implemented (✅ 2026-04-29)

### Iteration 15 (✅ 2026-04-29 — Midtrans Snap Payment Gateway + Receipt Email)
- **Receipt email (iter15b)**: New `payment_receipt(name, order_id, plan_label, amount_idr, cycle, payment_type, paid_at_iso, next_billing_iso)` template in `email_templates.py` — invoice-style HTML with order_id, plan, cycle, payment method, paid date, active-until date, total amount (terracotta emphasis). `_activate_subscription` now accepts `payment_type` + `amount_idr` params and fires receipt email best-effort after successful activation. Wired through webhook: Midtrans payment_type flows → receipt email → user's inbox.
- **New modules**:
  - `payment_service.py` — Midtrans Snap wrapper using `midtransclient` SDK, PLANS catalog (pro_monthly/pro_yearly/business_monthly/business_yearly matching tiers.py prices), `verify_webhook_signature` (SHA512), no-op 503 when keys empty.
  - `routes/payment.py` (5 endpoints): `GET /payment/config` (public — plans + snap_url + client_key for frontend loader), `POST /payment/create-transaction` (auth — returns snap_token), `POST /payment/webhook` (public — SHA512 signature verification + idempotent tier activation), `GET /payment/status/{order_id}` (auth), `GET /payment/history` (auth — user's paid orders).
  - Frontend `lib/midtransSnap.js` — dynamic Snap.js loader + `openSnapCheckout(planId, handlers)` + `pollPaymentStatus(orderId)`.
- **Webhook security**:
  - SHA512 of `order_id + status_code + gross_amount + server_key` compared with `hmac.compare_digest` against `signature_key` field.
  - Idempotency: activate tier only when `existing.status != "success"`.
  - Midtrans retries tolerated — webhook always returns 200 (logs "ignored" reason).
- **Tier activation** (`_activate_subscription`):
  - Upgrade `tier` (pro/business), cancel `trial`, set `subscription_plan_id`, `subscription_cycle`, `subscription_started_at`, `subscription_expires_at` (+ duration_days from plan), `subscription_last_order_id`.
  - **Stacking**: if user renews same tier before expiry, new period starts from current expiry (not from now) — fair for customers who pay early.
- **Auto-downgrade**: `require_user` middleware now checks both trial expiry AND paid subscription expiry — expires back to `free` when `subscription_expires_at < now`.
- **Frontend updates**:
  - `Pricing.jsx`: "Upgrade ke Pro/Bisnis" button now opens Snap popup directly (with auth gate + monthly/yearly toggle). Loading spinner per-plan.
  - `Billing.jsx`: Replaced yellow "pembayaran belum aktif" banner with **4 upgrade cards** (pro monthly/yearly, business monthly/yearly, contextually filtered based on current tier). Added **Payment History** section showing order_id, amount, status badge (success/pending/failed/refunded), date, payment_type.
  - `/api/auth/me` + `/api/billing/me` now expose `subscription_expires_at`, `subscription_plan_id`, `subscription_cycle`.
- **`.env` vars added**: `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION`. All empty by default → backend runs in "pembayaran belum aktif" mode, returns 503 on create-transaction attempt.
- **MongoDB indexes**: `payments.order_id` unique, `payments.(user_id, created_at desc)`, `payments.status`.
- **Docs**: `/app/docs/MIDTRANS_SETUP.md` — full 4-step signup + sandbox keys + webhook URL config + test credentials (sandbox cards, e-wallet, VA simulator) + Midtrans fee reference for Indonesia.
- **Tests**: 9 new in `tests/test_iter15_midtrans.py` (config plans, 503 when unconfigured, 401 no auth, 403 invalid signature, SHA512 algorithm correctness, PLANS match tiers.py, `_activate_subscription` sets fields correctly). Regression: **174/174 backend pytest PASS** (was 165 → +9).
- **User status**: Waiting for user to (1) register at dashboard.midtrans.com, (2) copy sandbox Server + Client key, (3) set Payment Notification URL, (4) paste keys in chat. Until then, app runs with "Pembayaran belum aktif" toast on upgrade attempts.

### Iteration 14 (✅ 2026-04-29 — Resend Email Service)
- **New modules**: `email_service.py` (async wrapper over Resend SDK with no-op logging fallback) + `email_templates.py` (4 branded HTML+text templates in Bahasa Indonesia: password_reset, welcome, trial_expiring, product_created_via_wa).
- **Wired into flows**:
  - `POST /api/auth/register` → welcome email (+ Trial Pro 14 hari CTA)
  - `POST /api/auth/forgot-password` → reset link email with 60-min expiry. Simple-mode fallback (token in response) still works when `RESEND_API_KEY` empty — preserves backward-compat with existing tests + dev flow.
  - `require_user` middleware → trial expiring reminder at H-3 (once per user via `trial_reminder_sent_at` flag)
  - WhatsApp webhook → notify owner email when product created via WA
- **`.env` added**: `RESEND_API_KEY`, `SENDER_EMAIL=noreply@lapakin.my.id`, `SENDER_NAME=Lapakin`, `PUBLIC_APP_URL=https://lapakin.my.id`
- **No-op logging mode** when `RESEND_API_KEY` is empty — backend never crashes, emails logged with `[EMAIL-NOOP→recipient]` lines. Perfect for local dev + CI without keys.
- **Frontend**: `ForgotPassword.jsx` toast message updated to "Cek inbox kamu 📬" when no token returned (email-mode); still shows reset-link card when simple-mode active.
- **Docs**: `/app/docs/RESEND_EMAIL_SETUP.md` — step-by-step signup + SPF/DKIM/DMARC DNS setup for `lapakin.my.id` + troubleshooting.
- **Tests**: 3 new in `tests/test_iter14_email.py` (no-op flow, privacy for unknown email, templates render). Regression: **165/165 backend pytest PASS**.
- **User status**: Waiting for user to (1) sign up at resend.com, (2) add DNS records, (3) paste API key. Until then, app runs in no-op mode.

### Iteration 13 (✅ 2026-04-29 — Modular backend refactor)
- **`server.py` split**: 2104 → 93 lines (95% reduction). Thin aggregator — mounts routers, middleware, startup indexes, admin seeding.
- **New modules** (`/app/backend/`):
  - `deps.py` (169 lines) — db client, JWT/auth helpers, `require_user`/`require_admin`, `log_admin_action`, `track_ai_usage`, Twilio env, logger, `slugify`, `asyncio_gather_safe`
  - `models.py` (160 lines) — all Pydantic request/response models
  - `schedule_utils.py` (80 lines) — `compute_schedule_status`, `_now_jakarta`, `_parse_hhmm`
  - `og_render.py` (253 lines) — Pillow rendering: fallback OG, shop cover, product card post/story; `OG_PNG_CACHE` shared state
- **Route modules** (`/app/backend/routes/`):
  - `auth.py` (177) — register, login, logout, me, Google OAuth, forgot/reset password
  - `shops.py` (184) — shop CRUD, toggle-open, by-slug (+ live schedule), custom-domain set/verify/remove (BISNIS tier)
  - `products.py` (77) — product CRUD with tier limit enforcement
  - `ai.py` (221) — enhance-image, generate-content, suggest-theme, generate-about, generate-cover (all quota-gated)
  - `og.py` (193) — OG shop PNG (cached), OG HTML (no meta-refresh), product IG post/story PNGs, bulk-pack ZIP (PRO+)
  - `whatsapp.py` (234) — Twilio webhook, pairing flow, product-from-text parser (`_parse_product_text` re-exported from `server` for legacy test)
  - `public.py` (187) — health, featured-shops, broadcast banner, billing/tiers, billing/me, analytics track + shop stats
  - `admin.py` (265) — stats, shops/users list, suspend/feature toggle, product moderation, tier manager, audit log, broadcasts, AI usage
  - `routes/__init__.py` — exports `ALL_ROUTERS` list, `server.py` iterates and mounts
- **Zero behavior change** — all endpoints keep same URLs, request/response shapes, cookies, and side-effects. Shared state (OG PNG cache) lives in `og_render.py` so both `og.py` (read) and `shops.py` (invalidate on update) reference the same dict.
- **Test results**: **162/162 backend pytest PASS** (was 161/162 before refactor; I also fixed a stale iter10 test `test_og_share.py::test_meta_refresh_present` → `test_meta_refresh_absent` that asserted the opposite of the iter10 spec — it was obsolete, not a regression). Frontend smoke screenshot verified landing page renders identically.
- **Why now?** Agreed with user to refactor BEFORE implementing Midtrans payment gateway — so the new `routes/billing.py` (for Snap checkout + webhook) lands cleanly without polluting the monolith further.

### Iteration 12 (✅ 2026-04-29 — Trial Pro + Custom Domain + Analytics + Bulk Card Pack)
- **Trial Pro 14 hari**: new users registered via `/api/auth/register` auto-receive `tier=pro, trial=true, trial_expires_at=now+14d`. `require_user` auto-downgrades expired trials to `free`. Dashboard shows yellow countdown banner; Billing page shows "TRIAL" badge + expiry date.
- **Custom Domain** (Bisnis tier only, `require_feature(user, 'custom_domain')`):
  - `POST /api/shops/me/custom-domain` — save `tokokamu.com`, returns DNS CNAME instructions
  - `POST /api/shops/me/custom-domain/verify` — best-effort DNS lookup, marks verified=true if resolves to same IP as `lapakin.my.id`
  - `DELETE /api/shops/me/custom-domain` — unset
  - UI: `CustomDomainSection` in ShopSettings — LOCKED state for non-Bisnis with upgrade CTA; input + save + verify + DNS instructions panel for Bisnis
- **Analytics** (Pro+ tier, `require_feature(user, 'analytics')`):
  - `POST /api/analytics/track` public (view_shop, view_product, click_order, share_wa) — called from Storefront client-side
  - `GET /api/shops/by-slug` auto-inserts to `storefront_visits`
  - `GET /api/analytics/shop?days=7` returns {total_visits, events, conversion_rate_percent, top_products, daily[]}
  - New page `/dashboard/analytics` with 4 stat cards + CSS bar chart (daily visits) + top-5 products list. Locked state for free tier.
  - Nav: "Analitik" link added
- **Bulk Card Pack** (Pro+ tier):
  - `GET /api/og/bulk-pack.zip` — streams ZIP with `<slug>-post-1080x1080.png` + `<slug>-story-1080x1920.png` for every product + README.txt
  - Products page: "Bulk Card Pack" button for paid users (direct download with auth cookie); "Bulk Pack 🔒" for free users → /pricing
- Tested: **56/56 backend tests passing** (all iter8-12 green after fixture fix). Full E2E verified — trial banner, tier gating, analytics locked/unlocked states, bulk pack download for pro tier.

### Iteration 11 (✅ 2026-04-29 — 3-Tier Subscription System)
- **3 tiers**: `free` (Rp 0, 5 produk, 5 AI/bulan), `pro` (Rp 49.000/bulan, 100 produk, AI generous, custom subdomain, no Lapakin branding), `business` (Rp 149.000/bulan, unlimited semua + custom domain + IG autopost + API access + multi-toko).
- **Module `tiers.py`** — `TIER_LIMITS` dict, helpers `get_tier`, `get_limits`, `current_month_bucket` (YYYY-MM in Asia/Jakarta), `get_usage`/`increment_usage`/`check_quota`/`require_feature`. Mini-refactor — full `server.py` split deferred.
- **Backend gating**:
  - Product create — counts existing products vs `max_products`, returns 402 with helpful message
  - `/api/ai/enhance-image` (`ai_photo` bucket), `/api/ai/generate-content` + `/api/ai/generate-about` (`ai_copy`), `/api/ai/generate-cover` (`ai_cover`) — each checks monthly quota, returns 402 when exceeded
  - `track_ai_usage` extended to also auto-increment `monthly_usage` collection (user_id, year_month, kind)
  - MongoDB unique index `(user_id, year_month, kind)` on `monthly_usage`
- **Backend endpoints**:
  - `GET /api/billing/tiers` public — list all tiers with limits + prices
  - `GET /api/billing/me` auth — current tier + month-to-date usage with limits
  - `POST /api/admin/users/{user_id}/tier` admin — manual tier change (PUT also supported for legacy)
  - `GET /api/shops/by-slug/{slug}` now injects `shop.owner_tier` and `shop.remove_branding`
- **Frontend new pages**:
  - `/pricing` public — 3 tier cards with "PALING POPULER" PRO highlight, monthly/annual toggle (annual saves ~2 months), full comparison table
  - `/dashboard/billing` — current tier card, usage progress bars (red when ≥80%), feature highlights with active/inactive states, "Pembayaran belum aktif" notice
- **Frontend gating UI**:
  - Tier badge in DashboardLayout top-right (GRATIS/Pro/Bisnis colors), clicks → /dashboard/billing
  - "Akun" nav link added
  - Storefront "Powered by Lapakin" footer hidden when `shop.remove_branding=true` (Pro/Business owner) — replaced with `© Shop Name`
  - Landing nav has new "Paket" link → /pricing
- Tested: **145/145 backend pytest passing** (16 new in `test_iter11_billing_tiers.py` + 129 prior; flaky timing test passed too). Full E2E verified — quota gates trigger at exact limit, admin tier change works, conditional footer responds to tier change live. Zero JS pageerrors.
- **Payment provider integration DEFERRED** — admin manually upgrades tier for now. Next iteration: Midtrans/Stripe integration with subscription webhook + auto-renew.

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
- [x] Email service (Resend) — iter14 done. User needs to paste API key + verify DNS.
- [ ] Real Twilio creds + signature verification (X-Twilio-Signature HMAC) on `/api/whatsapp/webhook`
- [ ] Direct Instagram posting via Meta Graph API (currently Share Pack manual flow)
- [ ] Auto-post to TikTok via TikTok Business API
- [ ] Custom domain support
- [ ] Categories / tags for products

### P2 — Phase 3
- [ ] Marketplace mode (`gou mkm.id`-style hub)
- [x] Midtrans payment integration — iter15 done. User needs Midtrans keys + webhook URL config.
- [ ] Order management & analytics
- [x] Subscription billing (Free / Pro / Bisnis) — iter11-15 done.
- [ ] AI Reels generator (Sora 2)

## Known Code-Review Notes (non-blocking)
- ✅ ~~`server.py` is monolithic~~ — Done in iter13. Now thin aggregator; logic lives in `deps.py`, `models.py`, `schedule_utils.py`, `og_render.py`, `routes/*.py`.
- Tighten CORS allowlist in production (currently `*`)
- Friendly Indonesian error messages for AI failures
- Use `<a target="_blank">` instead of `onClick` for "Lihat Toko" so middle-click works
- Migrate FastAPI `@app.on_event("startup"/"shutdown")` to lifespan context manager (deprecation warning)
