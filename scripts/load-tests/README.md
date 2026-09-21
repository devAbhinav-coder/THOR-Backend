# Load test scenarios (k6)

Prerequisites: [k6](https://k6.io/docs/get-started/installation/), staging URL, optional auth token for cart/checkout.

### Local dev - avoid 429

Without Redis, API rate limit drops to **~50 req / 15 min per IP** (`RATE_LIMIT_MEMORY_MAX`). k6 will show **100% failed** (HTTP 429).

1. Restart `npm run dev` (clears in-memory counters).
2. In `.env` for k6 runs only:
   ```env
   LOAD_TEST_RELAX_RATE_LIMIT=true
   RATE_LIMIT_MAX=10000
   ```
3. Or run Redis so limits use `RATE_LIMIT_MAX` via Redis store.

### `connection refused` on 127.0.0.1:5000

k6 is fine - **API is not listening** (or restarted mid-test):

- Keep **`npm run dev` running in a separate terminal**; do not Ctrl+C while k6 runs.
- `ts-node-dev` **respawn** (file save) drops connections for a few seconds - wait, then re-run k6.
- Local laptop: use **`VUS=5`** smoke, not 30–500 (dev runs API + BullMQ + cron in one process).

```bash
export BASE_URL=https://staging.example.com
k6 run scripts/load-tests/k6/pdp-single-slug.js
```

## Acceptance targets

| Scenario               | VUs | Pass criteria                                         |
| ---------------------- | --- | ----------------------------------------------------- |
| PDP same slug          | 500 | ≤1–2 Mongo `Product.findOne`/sec (check logs/metrics) |
| PLP homepage           | 200 | Coalesced list + count; stable p95                    |
| Cart GET same user     | 100 | ~1 cart read per soft TTL window per pod              |
| Redis kill mid-test    | -   | `/api/health` → 503; Mongo QPS does not 10×           |
| Checkout double-submit | 2   | Single payment intent (409 or idempotent replay)      |

## Scripts

- `k6/pdp-single-slug.js` - hammer one public PDP slug.
- `k6/plp-home.js` - storefront product list / homepage feed.
- `k6/cart-get.js` - authenticated cart GET (set `AUTH_TOKEN`).

Tune `BASE_URL`, slug, and durations in each file before production-like runs.
