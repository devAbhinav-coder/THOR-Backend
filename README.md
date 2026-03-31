# House of Rani Backend

Production-grade Node.js + TypeScript backend for ecommerce APIs.

## Quick Start

1. Install deps:
   - `npm install`
2. Configure environment:
   - copy `.env.example` to `.env`
3. Run in dev:
   - `npm run dev`
4. Build:
   - `npm run build`
5. Start:
   - `npm start`

## Core Endpoints

- Health: `/api/health`
- Swagger docs: `/api/docs`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `development` or `production` |
| `PORT` | yes | API port |
| `MONGODB_URI` | yes | MongoDB connection URI |
| `JWT_SECRET` | yes | JWT signing secret (32+ chars in prod) |
| `JWT_EXPIRES_IN` | no | Access token duration |
| `REFRESH_TOKEN_DAYS` | no | Refresh token validity in days |
| `FRONTEND_URL` / `FRONTEND_URLS` | yes | Allowed CORS origins |
| `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` | yes | Redis for cache/limits/queues |
| `RATE_LIMIT_WINDOW_MS` | no | Global rate limit window |
| `RATE_LIMIT_MAX` | no | Global rate limit max requests |
| `JSON_BODY_LIMIT` | no | Body parser max payload size |
| `PAGINATION_MAX_LIMIT` | no | Hard max page size |
| `PAGINATION_DEFAULT_LIMIT` | no | Default page size |
| `SENTRY_DSN` | no | Error monitoring DSN |
| `RAZORPAY_KEY_ID` | prod | Razorpay API key |
| `RAZORPAY_KEY_SECRET` | prod | Razorpay secret |
| `CLOUDINARY_CLOUD_NAME` | yes | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | yes | Cloudinary API secret |

## Production Runbook

- Validate env and secrets before deploy.
- Enable `TRUST_PROXY` behind reverse proxy/load balancer.
- Ensure Redis is reachable (rate limit, queue, cache).
- Ensure Mongo indexes are created (first boot or migration).
- Monitor:
  - `/api/health`
  - application logs
  - queue health (BullMQ)
- Graceful shutdown is built-in (SIGTERM/SIGINT).

## Caching Strategy

- Redis cache keys:
  - storefront settings: `cache:storefront:settings:default`
  - featured products: `cache:products:featured`
  - gifting catalog (query based): `cache:gifting:products:*`
- Keep TTL short (120s) to balance freshness and DB load.

