# Production deployment guide

Deploy **two processes** in production for best reliability: **API** (`RUN_MODE=api`) and **Worker** (`RUN_MODE=worker`). A single `RUN_MODE=all` monolith is fine for small setups.

## Process layout

| Process | Command | Purpose |
|---------|---------|---------|
| API | `npm run start` with `RUN_MODE=api` | HTTP only — no background jobs |
| Worker | `npm run worker` with `RUN_MODE=worker` | Cron jobs, BullMQ consumers, outbox pollers |

Frontend: `npm run build && npm run start` (Next.js) or your host’s equivalent.

## Required environment (backend)

Copy `backend/.env.example` and set at minimum:

```env
NODE_ENV=production
PORT=5000

MONGODB_URI=mongodb+srv://...
JWT_SECRET=<min 32 chars>
JWT_REFRESH_SECRET=<min 32 chars>

FRONTEND_URLS=https://thehouseofrani.com,https://www.thehouseofrani.com
# or FRONTEND_URL= + CORS_MIRROR_WWW_APEX=true

REDIS_URL=rediss://...   # required for BullMQ, job health, refresh limits
```

## Payments & email

```env
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...   # Razorpay Dashboard → Webhooks

SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=The House of Rani <noreply@yourdomain.com>
MAIL_REPLY_TO=support@yourdomain.com
```

## Jobs & workers

Full reference: `backend/.env.example` → **Run mode & background jobs**.

```env
RUN_MODE=api          # on API pods (use all for dev monolith)
RUN_MODE=worker       # on worker pods
JOBS_ENABLED=true
QUEUE_WORKERS_ENABLED=true
BULL_BOARD_ENABLED=true

# Redis memory
BULLMQ_REMOVE_ON_COMPLETE=300
BULLMQ_REMOVE_ON_FAIL=500

# Cron (optional overrides)
INVENTORY_RECONCILE_CRON=0 2 * * *
NOTIFICATION_MAINTENANCE_CRON=0 3 * * *

# Queue-backed jobs
EMBEDDING_BACKFILL_ENABLED=true
DELHIVERY_TRACK_SYNC_ENABLED=true
PAYMENT_RECOVERY_ENABLED=true

# Timing
CART_ABANDON_INACTIVE_MS=7200000
UNPAID_ORDER_CANCEL_AFTER_MS=1800000
REVIEW_INVITE_DELAY_MS=259200000
OUTBOX_DLQ_MIN_ATTEMPTS=5
WISHLIST_PRICE_DROP_MIN_PCT=10
LOW_STOCK_THRESHOLD=3
ORDER_SLA_SHIP_MS=172800000
SITEMAP_OUTPUT_PATH=./public/sitemap.xml
SITEMAP_CLOUDINARY_UPLOAD=true

# Opt-in risky jobs (default off)
RETURN_AUTO_APPROVE_ENABLED=false
REENGAGE_JOB_ENABLED=false
IMAGE_OPTIMIZE_JOB_ENABLED=false
```

Job health: admin only — `GET /api/admin/jobs/health` (requires admin JWT).

DLQ replay: admin UI `/admin/system/outbox` or `GET/POST /api/admin/outbox/:type/...`.

Bull Board: `/api/admin/queues` when `BULL_BOARD_ENABLED=true`.

## Cloudflare Turnstile (production)

```env
TURNSTILE_SECRET=<from Cloudflare>
TURNSTILE_ENFORCE=true
# Native app (Expo): MOBILE_APP_API_KEY + X-App-Key header; no Turnstile skip without it in prod
```

Frontend must use the matching production site key.

## Delhivery (optional)

```env
DELHIVERY_API_TOKEN=...
DELHIVERY_PICKUP_LOCATION_NAME=...
DELHIVERY_ORIGIN_PINCODE=...
DELHIVERY_USE_STAGING=false
```

## Frontend env

```env
NEXT_PUBLIC_API_URL=https://api.thehouseofrani.com/api
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
```

## Health checks

- `GET /api/health` — MongoDB + Redis (both required in production when Redis is enabled)
- `GET /api/admin/jobs/health` — background job metadata (admin auth)

## WAF / edge rules (admin surface)

Prefer writes at `/api/admin/writes/*` (admin JWT + 2FA). Legacy write paths still work — protect both:

- `POST|PATCH|DELETE /api/admin/writes/*`
- `POST|PATCH|DELETE /api/products/*`
- `POST|PATCH|DELETE /api/coupons/*`, `/api/sales/*`, `/api/promotions/*`
- `POST|PATCH|DELETE /api/blogs/*`, `/api/testimonials/*`
- `PATCH /api/gifting/requests/*`

List also: `GET /api/admin/writes/surfaces` (admin auth). Rate-limit and geo-block these at the edge.

## Post-deploy checklist

1. API + worker both running with shared `MONGODB_URI` and `REDIS_URL`
2. Redis `maxmemory-policy noeviction` (BullMQ)
3. Confirm analytics pre-aggregation job runs (`analytics-pre-aggregation` in job health)
4. Smoke test: signup → cart → checkout → admin order status → delivered
5. Admin: `/admin/system/jobs`, `/admin/system/outbox`

## Scaling notes

- Scale API horizontally; scale workers to 1–2 unless queue depth grows
- `RUN_MODE=api` + `JOBS_ENABLED=false` on API prevents duplicate cron in multi-instance API deploys
- Snapshots reduce analytics DB load; profit/marketing panels may still query live orders for same-day data
