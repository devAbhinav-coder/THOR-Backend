# MongoDB connection pool sizing

Each API/worker process uses Mongoose with `MONGODB_MAX_POOL` (default **25**).

## Formula

```
total_connections ≈ (api_pods + worker_pods) × MONGODB_MAX_POOL
```

Keep **total_connections** below your Atlas/cluster limit (leave ~20% headroom for migrations, BI, shells).

## Examples

| API pods | Worker pods | `MONGODB_MAX_POOL` | ≈ Total |
|----------|-------------|--------------------|---------|
| 3        | 1           | 25                 | 100     |
| 6        | 2           | 20                 | 160     |
| 10       | 2           | 15                 | 180     |

## Tuning

- Raise pool only when p95 latency shows wait queueing, not by default.
- Every hot path should use `maxTimeMS` so slow queries release connections.
- Env: `MONGODB_MAX_POOL`, `MONGODB_SERVER_SELECTION_TIMEOUT_MS`, `MONGODB_CONNECT_RETRIES`.
