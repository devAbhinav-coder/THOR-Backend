import AppError from '../../utils/AppError';

export type GiftingStatus =
  | 'new'
  | 'price_quoted'
  | 'approved_by_user'
  | 'rejected_by_user'
  | 'cancelled';

const TERMINAL: GiftingStatus[] = ['approved_by_user', 'rejected_by_user', 'cancelled'];

/** Admin status transitions — prevents accidental workflow regression. */
const ADMIN_TRANSITIONS: Record<GiftingStatus, GiftingStatus[]> = {
  new: ['new', 'price_quoted', 'cancelled'],
  price_quoted: ['price_quoted', 'cancelled'],
  approved_by_user: ['approved_by_user', 'cancelled'],
  rejected_by_user: ['rejected_by_user', 'cancelled'],
  cancelled: ['cancelled'],
};

export function assertAdminStatusTransition(
  current: GiftingStatus,
  next: GiftingStatus | undefined
): void {
  if (!next || next === current) return;
  const allowed = ADMIN_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new AppError(
      `Cannot change gifting request status from "${current}" to "${next}".`,
      400
    );
  }
  if (TERMINAL.includes(current) && next !== 'cancelled' && next !== current) {
    throw new AppError(`Request is in terminal state "${current}" and cannot be reopened.`, 400);
  }
}

export function assertCanAcceptQuote(status: GiftingStatus): void {
  if (status !== 'price_quoted') {
    throw new AppError('Only quoted requests can be accepted.', 400);
  }
}

export function assertCanRejectQuote(status: GiftingStatus): void {
  if (status !== 'price_quoted') {
    throw new AppError('Only quoted requests can be rejected.', 400);
  }
}

export function assertQuoteFieldsForStatus(
  status: GiftingStatus | undefined,
  quotedPrice?: number
): void {
  if (status === 'price_quoted' && (quotedPrice === undefined || quotedPrice <= 0)) {
    throw new AppError('quotedPrice is required when setting status to price_quoted.', 400);
  }
}
