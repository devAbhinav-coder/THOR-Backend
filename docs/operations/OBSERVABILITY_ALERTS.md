# Observability & alert hints (Phase 6)

Structured logs emit `type: "metric"` with names below. Redis counters (when Redis is operational) live under `metrics:platform:{name}:{date}:*`.

## Cache metrics

| Metric                          | Meaning                           |
| ------------------------------- | --------------------------------- |
| `cache.fetch.hit`               | Envelope within soft TTL          |
| `cache.fetch.miss`              | DB/compute path                   |
| `cache.fetch.stale`             | SWR served stale while refreshing |
| `cache.fetch.coalesced`         | In-flight dedupe                  |
| `cache.fetch.lock_wait`         | Redis mutex acquired after retry  |
| `cache.fetch.lock_fail`         | Mutex lost - peer poll / fallback |
| `auth.user_cache.hit` / `.miss` | JWT hydration snapshot            |

**Suggested alerts**

- Spike in `cache.fetch.miss` with `keyPrefix` matching `cache:v*` or product PDP keys → stampede or TTL too low.
- `cache.fetch.lock_fail` rate ↑ → Redis latency or lock contention.

## Infra

- **`/api/health` 503** with message containing `strict readiness` → Redis outage under `REDIS_REQUIRED_STRICT` (drain pod).
- Log line `Redis configured but unreachable` + flip of `isRedisOperational` → page on-call.

## Mongo

- Sampled `db.query.sample` with `collection` + `operation` - correlate with Atlas slow query log.
- Pool sizing: see [MONGODB_POOL.md](./MONGODB_POOL.md).

## Load tests

See [../../scripts/load-tests/README.md](../../scripts/load-tests/README.md).
