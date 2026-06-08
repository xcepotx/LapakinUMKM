# LapakinUMKM

Lapakin is a WhatsApp/web-first CMS for Indonesian UMKM. It helps small businesses create an online storefront, manage products, generate AI-assisted product copy and visuals, take WhatsApp orders, and manage paid subscription tiers.

## Stack

- Frontend: React, CRACO, Tailwind CSS, shadcn/ui, Radix UI, lucide-react
- Backend: FastAPI, Motor, MongoDB, Pydantic, PyJWT, bcrypt
- Payments: Midtrans Snap plus manual QRIS review flow
- Email: Resend integration with no-op development mode
- AI: LLM/image providers configured through backend environment variables

## Repository Layout

- `frontend/` - React single-page app, dashboard, storefront, admin UI
- `backend/` - FastAPI app, route modules, service modules, tests
- `deploy/` - Nginx and VPS deployment helpers
- `docs/` - provider and VPS setup guides
- `scripts/smoke/` - smoke tests for production-like flows
- `memory/PRD.md` - product notes and implementation history

## Local Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # if available, otherwise create .env from the variables below
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Required backend environment variables:

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=lapakin
JWT_SECRET=change-me
EMERGENT_LLM_KEY=
```

Production-only or provider-specific variables include `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_APP_URL`, `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`, `GOOGLE_CLIENT_ID`, `RESEND_API_KEY`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION`, and Twilio WhatsApp settings.

Do not use the legacy default admin password. The backend only seeds an admin when `ADMIN_EMAIL` and `ADMIN_PASSWORD` are explicitly configured together.

## Local Frontend Setup

```bash
cd frontend
yarn install
yarn start
```

Useful frontend environment variable:

```env
REACT_APP_BACKEND_URL=http://localhost:8001
```

## Tests

Backend:

```bash
cd backend
pytest
```

Frontend:

```bash
cd frontend
yarn test --watchAll=false
yarn build
```

Smoke tests live in `scripts/smoke/` and `frontend/scripts/smoke/`.

## Deployment Notes

See `deploy/` and `docs/` for Nginx, Cloudflare SSL, VPS reinstall, Midtrans, and Resend setup. In production, set explicit `CORS_ORIGINS`, strong `JWT_SECRET`, provider keys, and non-default admin credentials before restarting the backend.
