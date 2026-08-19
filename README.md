# House of Rani Backend

Production-grade Node.js + TypeScript backend for ecommerce APIs.

## Quick Start (local)

1. Install dependencies: `npm install`
2. Copy env: `cp .env.example .env` and fill MongoDB, Razorpay, SMTP (or Resend)
3. Start Redis: `npm run redis:up`
4. Run API + worker together: `npm run dev:stack`

Or run separately:

```bash
npm run redis:up      # once
npm run dev           # terminal 1 — API
npm run worker:dev    # terminal 2 — jobs (abandoned cart, payment recovery, emails)
```

## Critical infrastructure

| Component | Why it matters | Local command |
|-----------|----------------|---------------|
| **Redis** | Auth rate limits, cart sync (multi-tab), BullMQ email/job queues | `npm run redis:up` |
| **Worker process** | Abandoned cart emails, payment recovery, review invites, outbox | `npm run worker:dev` or `dev:stack` |
| **SMTP or Resend** | Abandoned cart recovery, order/OTP emails | Set in `.env` |

### Health check

`GET /api/health` returns MongoDB, Redis, email, worker, abandoned-cart, and payment-recovery status.

Admin: `/admin/system/jobs` (includes `infrastructure` block from `/api/admin/jobs/health`).

## Abandoned cart recovery

- Job: `abandoned-cart-recovery` (default every 60 min)
- Triggers when cart inactive for `CART_ABANDON_INACTIVE_MS` (default 2h)
- Sends email + push; requires **worker + Redis + SMTP/Resend**
- Cooldown: `CART_ABANDON_COOLDOWN_MS` (default 24h per user)

## Payment recovery

- Job: `payment-recovery` (default every 30 min)
- Reconciles Razorpay payments captured at gateway but still `pending` locally
- Requires **worker + Redis + Razorpay keys**
- Enable: `PAYMENT_RECOVERY_ENABLED=true` (default)

## Production

- **API pod:** `RUN_MODE=api`, `QUEUE_WORKERS_ENABLED=false`, `JOBS_ENABLED=true` optional off on API
- **Worker pod:** `RUN_MODE=worker`, `QUEUE_WORKERS_ENABLED=true`, `JOBS_ENABLED=true`
- **Redis:** `REDIS_URL` required; use `noeviction` maxmemory policy
- Worker fails fast in production if Redis or email (when cart recovery enabled) is missing

```bash
npm run build
npm start          # API
npm run worker     # Worker (separate process/container)
```

## Core endpoints

- Health: `/api/health`
- Swagger: `/api/docs` (non-production or `ENABLE_API_DOCS=true`)

## Environment variables (essential)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | yes | MongoDB connection |
| `JWT_SECRET` | yes | 32+ chars in production |
| `REDIS_URL` | prod | Redis for limits, cart sync, queues |
| `SMTP_HOST` or `RESEND_API_KEY` | prod worker | Transactional + recovery emails |
| `RAZORPAY_KEY_ID` / `SECRET` | prod | Online payments + recovery |
| `RUN_MODE` | no | `api` \| `worker` \| `all` |
| `QUEUE_WORKERS_ENABLED` | worker | `true` on worker pod |

See `.env.example` for full list (cart abandon tuning, payment recovery interval, etc.).
