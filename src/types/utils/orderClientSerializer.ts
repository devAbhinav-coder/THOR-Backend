/**
 * Stable customer-facing order DTOs.
 * v1 — current storefront contract (detail includes statusHistory; list omits it).
 */

export type OrderClientDtoVersion = 'v1';

export type SerializeOrderMode = 'list' | 'detail';

const INTERNAL_OMIT = new Set([
  'razorpaySignature',
  'delhivery',
  'offlineMeta',
  'inventoryReserved',
  '__v',
]);

function normalizeId(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    const id = (value as { _id?: unknown })._id;
    return id != null ? String(id) : undefined;
  }
  return String(value);
}

function toPlainOrder(order: Record<string, unknown>): Record<string, unknown> {
  if (typeof (order as { toJSON?: () => Record<string, unknown> }).toJSON === 'function') {
    return (order as { toJSON: () => Record<string, unknown> }).toJSON();
  }
  if (typeof (order as { toObject?: () => Record<string, unknown> }).toObject === 'function') {
    return (order as { toObject: () => Record<string, unknown> }).toObject();
  }
  return { ...order };
}

/**
 * Lightweight serializer for customer order APIs.
 * Preserves fields the storefront uses; strips admin/integration internals.
 */
export function serializeOrderForClient(
  order: Record<string, unknown>,
  options: { mode?: SerializeOrderMode; version?: OrderClientDtoVersion } = {}
): Record<string, unknown> {
  const mode = options.mode ?? 'detail';
  const plain = toPlainOrder(order);
  const dto: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(plain)) {
    if (INTERNAL_OMIT.has(key)) continue;
    if (mode === 'list' && key === 'statusHistory') continue;
    dto[key] = value;
  }

  dto._id = normalizeId(plain._id) ?? plain._id;
  if (plain.user != null) dto.user = normalizeId(plain.user) ?? plain.user;
  if (plain.coupon != null) dto.coupon = normalizeId(plain.coupon) ?? plain.coupon;
  if (plain.customRequestId != null) {
    dto.customRequestId = normalizeId(plain.customRequestId) ?? plain.customRequestId;
  }

  if (Array.isArray(dto.items)) {
    dto.items = (dto.items as Record<string, unknown>[]).map((item) => ({
      ...item,
      product: item.product != null ? normalizeId(item.product) ?? item.product : item.product,
    }));
  }

  if (mode === 'list' && Array.isArray(plain.statusHistory) && plain.statusHistory.length > 0) {
    const last = plain.statusHistory[plain.statusHistory.length - 1] as Record<string, unknown>;
    dto.latestStatus = last.status;
    dto.latestStatusAt = last.timestamp;
  }

  dto._dtoVersion = options.version ?? 'v1';
  return dto;
}

export function serializeOrdersForClient(
  orders: Record<string, unknown>[],
  options?: { mode?: SerializeOrderMode; version?: OrderClientDtoVersion }
): Record<string, unknown>[] {
  return orders.map((o) => serializeOrderForClient(o, { ...options, mode: options?.mode ?? 'list' }));
}
