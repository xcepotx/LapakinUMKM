# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LapakinUMKM is a multi-tenant SaaS platform for Indonesian SMB (UMKM) storefront management. Each shop gets a subdomain (`<slug>.lapakin.my.id`) or custom domain. The stack is FastAPI (Python) + React 19 (CRA/Craco) + MongoDB.

## Commands

### Backend

```bash
cd backend
source venv/bin/activate
uvicorn server:app --reload --port 8000   # Dev server (http://localhost:8000)
pytest                                     # Run all tests
pytest tests/test_admin.py                 # Run a single test file
pytest -v -k "test_name"                  # Run a specific test by name
```

### Frontend

```bash
cd frontend
yarn start                                 # Dev server (http://localhost:3000)
yarn build                                 # Production build
yarn test                                  # Run tests (watch mode)
```

### Environment

Backend reads from `backend/.env`. Key variables: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `EMERGENT_API_KEY`, `RESEND_API_KEY`, `MIDTRANS_SERVER_KEY`, `TWILIO_*`.

Frontend reads `REACT_APP_BACKEND_URL` (defaults to `https://dev.lapakin.my.id` in `.env`; override to `http://localhost:8000` for local dev).

## Architecture

### Backend (`backend/`)

- `server.py` — FastAPI app entry point; sets up CORS, MongoDB indexes on startup, seeds admin user
- `deps.py` — Shared dependencies: DB client (Motor async), JWT auth, password hashing, `get_current_user` / `require_admin`, AI usage tracking
- `models.py` — All Pydantic request/response models
- `tiers.py` — Subscription tier limits (free/pro/business); consulted before creating products, using AI features, etc.
- `llm_service.py` — Unified LLM client with automatic fallback chain: **Gemini → OpenAI → Emergent**. All AI routes must use this service, not call provider SDKs directly.
- `routes/` — One file per feature domain, all registered in `routes/__init__.py`

Key route files:
| File | Responsibility |
|------|---------------|
| `auth.py` | JWT login, Google OAuth, password reset |
| `shops.py` | Shop CRUD, settings, custom domains, analytics |
| `products.py` | Product CRUD with tier-gated limits |
| `ai.py` | Image enhance, content/theme/cover/about generation |
| `payment.py` | Midtrans payment lifecycle, subscription upgrades |
| `whatsapp.py` | Twilio WhatsApp order integration |
| `admin.py` | Admin-only: users, shops, broadcasts, audit logs |
| `content_studio.py` | Cerita (stories) and daily tips generation |
| `og.py` | Open Graph image generation for social sharing |
| `public.py` | Unauthenticated storefront/product endpoints |
| `tips.py` | Daily business tips system |

### Frontend (`frontend/src/`)

- `App.js` — React Router config; handles protected routes, admin routes, and tenant slug detection
- `lib/api.js` — Axios instance; resolves backend URL per tenant (uses `lib/tenant.js` to extract slug from hostname)
- `contexts/AuthContext.jsx` — Global auth state: `checkAuth`, `logout`, `refreshUser`; consumed by most pages
- `pages/` — Page-level components (one per route)
- `components/` — Shared layout (`DashboardLayout`, `AdminLayout`) and reusable UI components
- `components/ui/` — shadcn/Radix UI primitives (button, dialog, input, tabs, etc.)

### Database (MongoDB)

Collections: `users`, `shops`, `products`, `user_sessions` (TTL), `password_reset_tokens` (TTL), `wa_pair_codes`, `wa_links`, `audit_logs`, `broadcasts`, `ai_usage`, `monthly_usage`, `storefront_visits`, `analytics_events`, `payments`.

Unique indexes: `users.email`, `users.user_id`, `shops.slug`, `shops.shop_id`, `products.product_id`, `payments.order_id`.

## Key Patterns

**Auth flow**: JWT stored in HTTP-only cookie + `Authorization: Bearer` header fallback. `deps.py:get_current_user` handles both. Sessions tracked in `user_sessions` collection.

**Tier enforcement**: Before any feature that has limits (AI calls, product count, etc.), check `tiers.py` limits and `ai_usage` / `monthly_usage` collections. The `deps.py:track_ai_usage` dependency handles per-request AI tracking.

**LLM calls**: Always go through `llm_service.py`. Never call `openai` or `google.generativeai` directly in route files.

**Multi-tenancy**: Shop slug is resolved from subdomain or custom domain in `lib/tenant.js`. The `public.py` routes are unauthenticated and serve tenant storefronts.

**Payments**: Indonesian-specific — uses Midtrans (not Stripe). `payment_service.py` handles the Midtrans Snap token flow; frontend uses `lib/midtransSnap.js`.

## Design System

Defined in `design_guidelines.json`. Key rules:
- Primary: `#C04A3B` (terracotta), Secondary: `#2D5A27` (earthy green)
- Fonts: Plus Jakarta Sans (headings), Manrope (body)
- Border radius: cards `rounded-2xl`, buttons/inputs `rounded-xl`, images `rounded-3xl`
- Icons: `lucide-react` only
- Component library: shadcn UI + Radix UI primitives

## Testing Notes

- Backend tests use `pytest-asyncio` with `asyncio_mode = auto` (set in `pytest.ini`)
- Test fixtures for authenticated sessions are in `tests/backend_test.py`
- Integration tests named `test_iter*.py` cover end-to-end feature flows
