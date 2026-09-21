# Cache (soft / hard TTL) + env vars - Phases 0–6

## Soft vs hard ( `cachedFetch` )

| Term                      | Meaning                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Soft TTL**              | Data **fresh** - serve from cache, **no DB**                                                          |
| **Hard TTL**              | Max life in Redis; after this the key **expires** → next request = **DB + cache again**               |
| **Between soft and hard** | **Stale-while-revalidate (SWR)** - user gets **old data immediately**; refresh runs **in background** |

Coalesce runs on **cache miss** or refresh (same pod, same key, parallel requests → one DB call).

Most catalog TTLs are **code constants** (not `.env`). Env-tunable ones are listed below.

---

## TTL table (seconds)

| Area                           | Soft      | Hard             | Env override?               | Source                        |
| ------------------------------ | --------- | ---------------- | --------------------------- | ----------------------------- |
| **Shop PLP list**              | 90        | 270              | No                          | `productListService.ts`       |
| **Product count (PLP)**        | 60        | 180              | No                          | `productCountService.ts`      |
| **PDP (detail)**               | 600 (10m) | 1800 (30m)       | No                          | `productController.ts`        |
| **Featured products**          | 120       | 360              | No                          | `productController.ts`        |
| **Shop filters**               | 300       | 900              | No                          | `productController.ts`        |
| **Search results**             | 60        | 180              | No                          | `advancedSearchService.ts`    |
| **Autocomplete**               | 30        | 90               | No                          | `advancedSearchService.ts`    |
| **Active sales**               | 120       | ≥360             | `SALE_ACTIVE_CACHE_TTL_SEC` | `saleCacheService.ts`         |
| **Storefront settings**        | 120       | 360              | No                          | `storefrontController.ts`     |
| **Categories list/stats**      | 300       | 900              | No                          | `categoryListCacheService.ts` |
| **Mega menu**                  | 300       | 900              | No                          | `navigationCacheService.ts`   |
| **Gifting PLP**                | 120       | soft×3           | `GIFTING_PRODUCT_CACHE_TTL` | `giftingQuery.ts`             |
| **Premium PLP/PDP**            | 120       | soft×3           | No (constant)               | `premiumQuery.ts`             |
| **Cart DTO (GET)**             | 45        | 180              | No                          | `cartConstants.ts`            |
| **Orders list/detail/summary** | 300       | 900              | No                          | `orderReadService.ts`         |
| **Admin dashboard analytics**  | 60        | 120              | No                          | `adminAnalyticsService.ts`    |
| **Auth user snapshot (JWT)**   | 60        | same (plain TTL) | `AUTH_USER_CACHE_TTL_SEC`   | `authUserSnapshotService.ts`  |

**Auth snapshot** uses `getCache` + TTL, not soft/hard envelope (no SWR window).

---

## Env vars by phase (copy into `.env`)

### Phase 0 - Foundation (cache, coalesce, pollers)

No required new env. Redis required in production (`REDIS_URL`).

### Phase 1 - Catalog HTTP cache headers

No new env (TTLs in code).

### Phase 2 - Auth

```env
JWT_ADMIN_EXPIRES_IN=5m
AUTH_USER_CACHE_TTL_SEC=60
```

### Phase 3 - Cart / checkout

```env
CHECKOUT_LOCK_TTL_MS=15000
CHECKOUT_LOCK_WAIT_MS=3000
```

Checkout always loads cart with `skipCache: true` on payment path.

### Phase 4 - Infra (Redis down, rate limit, Mongo)

```env
# Production default: strict on (503 /api/health if Redis configured but down)
# REDIS_REQUIRED_STRICT=false

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
# RATE_LIMIT_MEMORY_MAX=50
# RATE_LIMIT_FAIL_CLOSED_WITHOUT_REDIS=false

MONGODB_MAX_POOL=10
# MONGODB_CONNECT_RETRIES=10
# MONGODB_SERVER_SELECTION_TIMEOUT_MS=12000
```

See [MONGODB_POOL.md](./MONGODB_POOL.md).

### Phase 5 - Orders / wishlist / admin reads

Uses same Redis + `cachedFetch` TTLs in code (orders table above). No extra env.

### Phase 6 - Metrics & load tests

```env
# Local k6 only - do NOT set in production
# LOAD_TEST_RELAX_RATE_LIMIT=true

HEALTHCHECK_TOKEN=long-random-string
```

Metrics log as `type: "metric"`; optional Redis keys `metrics:platform:*`. See [OBSERVABILITY_ALERTS.md](./OBSERVABILITY_ALERTS.md).

### Optional catalog tuning

```env
SALE_ACTIVE_CACHE_TTL_SEC=120
GIFTING_PRODUCT_CACHE_TTL=120
USE_ESTIMATED_PRODUCT_COUNT=false
```

---

## Production checklist (minimal)

```env
NODE_ENV=production
REDIS_URL=redis://...
MONGODB_URI=...
MONGODB_MAX_POOL=10
RATE_LIMIT_MAX=100
JWT_ADMIN_EXPIRES_IN=5m
AUTH_USER_CACHE_TTL_SEC=60
CHECKOUT_LOCK_TTL_MS=15000
CHECKOUT_LOCK_WAIT_MS=3000
HEALTHCHECK_TOKEN=...
RUN_MODE=api
QUEUE_WORKERS_ENABLED=false
```

Separate worker service:

```env
RUN_MODE=worker
QUEUE_WORKERS_ENABLED=true
```

Do **not** set `LOAD_TEST_RELAX_RATE_LIMIT` in production.

---

## Development (your machine)

```env
RUN_MODE=all
# or RUN_MODE=api + npm run worker:dev
REDIS_URL=redis://127.0.0.1:6379
MONGODB_MAX_POOL=10
LOAD_TEST_RELAX_RATE_LIMIT=true
RATE_LIMIT_MAX=10000
```

---

## Related docs

- [MONGODB_POOL.md](./MONGODB_POOL.md)
- [OBSERVABILITY_ALERTS.md](./OBSERVABILITY_ALERTS.md)
- Load tests: `scripts/load-tests/README.md`
