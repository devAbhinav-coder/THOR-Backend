# Inventory Management Architecture

Production-grade inventory layer for the House of Rani ecommerce backend. All **HTTP routes, response shapes, pagination, GST math, stock flows, and cache keys** remain compatible with the existing admin frontend.

## Layering

| Layer | Responsibility |
|-------|----------------|
| `inventoryController.ts` | Validate (Zod middleware), orchestrate, serialize responses |
| `services/inventory/*` | Business logic, transactions, bulk writes, reporting |
| `utils/financialMath.ts` | Paise-based GST/totals (legacy `Math.round` compatible) |
| `utils/mongoTransaction.ts` | `withTransaction` wrapper + structured errors |
| `models/*` | PurchaseInvoice (status/void/idempotency), InventoryEventOutbox |
| `jobs/*` | Outbox poller, totalStock reconciliation |

## Critical flows (transaction-safe)

### Stock adjustment (`PATCH .../stock`)

1. Mongo transaction: load product → mutate variant → recompute `totalStock` → `syncProductTotalStock` → ledger insert.
2. Admin audit + metrics + async summary cache invalidation + PDP invalidation (unchanged UX).

### Purchase invoice (`POST .../purchase-invoices`)

1. Idempotency-Key header (optional) → return existing invoice if key matches.
2. Duplicate `invoiceNumber` guard (409).
3. Single transaction: create invoice → `bulkWrite` stock increments → validate `matchedCount` → ledger with **accurate** `stockAfter` reads.
4. On any failure: full rollback (no invoice/stock/ledger drift).
5. PDP invalidation remains immediate; summary invalidation also enqueued to outbox.

### Invoice delete (`DELETE`)

- **Soft void** (`status: voided`) — preserves audit trail; does **not** reverse stock (same as legacy hard delete from an inventory perspective).
- Excluded from list + GST aggregates (same UX as removal).

## Financial precision

`financialMath.ts` uses integer **paise** internally. `calcPurchaseLineItem` mirrors prior rounding so existing invoices and GST reports stay consistent.

## Observability

- Structured logs: `requestId`, `productId`, `sku`, `invoiceId`, `actorId` via `getRequestContext()`.
- Metrics prefix: `metrics:inventory:*` (Redis counters when Redis enabled).
- Query guard: `INVENTORY_QUERY_MAX_MS` (default 15s) on heavy reads/aggregates.

## Background jobs

| Env | Default | Job |
|-----|---------|-----|
| `INVENTORY_OUTBOX_POLL_ENABLED` | on | Retry cache/PDP side effects |
| `INVENTORY_RECONCILE_ENABLED` | on | Fix `totalStock` drift (batch of 50 products/hour by default) |

Disable in dev with `=false`.

## Mongo indexes (PurchaseInvoice)

- `{ invoiceNumber: 1 }` unique partial `status: active`
- `{ status: 1, invoiceDate: -1 }`
- `{ idempotencyKey: 1 }` sparse unique

## Zero-breaking migration

1. Deploy backend — existing documents without `status` behave as active (`$ne: voided` queries).
2. Ensure MongoDB replica set for transactions (required for `withTransaction`).
3. If duplicate `invoiceNumber` exist in DB, resolve before unique index builds.
4. Optional: send `Idempotency-Key` from frontend on invoice create for retry safety.

## Production recommendations

- Run MongoDB as replica set; enable `retryWrites`.
- Set `INVENTORY_QUERY_MAX_MS` and monitor `inventory.bulk_write.mismatch` / `inventory.reconciliation.drift`.
- Use `Idempotency-Key` on purchase invoice POST from admin UI.
- Prefer **void** over manual DB deletes; stock reversal (if needed) should be a separate audited adjustment flow.
- Scale reads: keep summary cache (60s TTL); plan materialized GST rollups when invoice volume grows.

## Frontend alignment

- No API path or response envelope changes.
- Stock adjustment now accepts **price/cost-only** updates (Zod aligned with UI).
- Retry-safe invoice creation: pass `Idempotency-Key` header (already allowed in CORS).
