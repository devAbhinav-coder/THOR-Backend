import { Types } from 'mongoose';

type PopulatedUser = { name?: string; avatar?: string; _id?: Types.ObjectId | string } | undefined;
type UserSnapshot = { name?: string; avatar?: string } | undefined;

type RawReview = {
  toObject?: () => Record<string, unknown>;
  _id?: Types.ObjectId | string;
  user?: PopulatedUser | Types.ObjectId | string;
  userSnapshot?: UserSnapshot;
  product?: { name?: string; slug?: string; _id?: Types.ObjectId | string } | Types.ObjectId | string;
  rating?: number;
  title?: string;
  comment?: string;
  images?: { url: string; publicId: string }[];
  isVerifiedPurchase?: boolean;
  helpfulVotes?: Types.ObjectId[] | string[];
  helpfulCount?: number;
  reports?: unknown[];
  reportCount?: number;
  adminReply?: { text: string; createdAt: Date };
  createdAt?: Date;
  updatedAt?: Date;
  order?: Types.ObjectId | string;
  status?: string;
  [key: string]: unknown;
};

function resolveUserFields(review: RawReview): { name: string; avatar?: string; badge: string } {
  const populated =
    review.user && typeof review.user === 'object' && 'name' in review.user ?
      (review.user as PopulatedUser)
    : undefined;
  const snapshot = review.userSnapshot;
  const rawName =
    typeof populated?.name === 'string' && populated.name.trim().length > 0 ?
      populated.name.trim()
    : typeof snapshot?.name === 'string' && snapshot.name.trim().length > 0 ?
      snapshot.name.trim()
    : 'Verified Buyer';
  const avatar = populated?.avatar ?? snapshot?.avatar;
  return {
    name: rawName,
    ...(avatar ? { avatar } : {}),
    badge: 'Verified Buyer',
  };
}

/**
 * Public review DTO — preserves legacy response shape (user.name, user.badge, spread fields).
 */
export function serializeReviewForPublic(review: RawReview): Record<string, unknown> {
  const raw =
    typeof review.toObject === 'function' ? review.toObject() : ({ ...review } as Record<string, unknown>);
  const userFields = resolveUserFields(review as RawReview);
  const helpfulCount =
    typeof review.helpfulCount === 'number' ?
      review.helpfulCount
    : Array.isArray(review.helpfulVotes) ?
      review.helpfulVotes.length
    : 0;

  return {
    ...raw,
    helpfulCount,
    user: {
      ...(typeof review.user === 'object' && review.user !== null ? review.user : {}),
      ...userFields,
    },
  };
}

export function serializeReviewsForPublic(reviews: RawReview[]): Record<string, unknown>[] {
  return reviews.map(serializeReviewForPublic);
}

/** Owner-facing review (create/update) — same fields, no extra badge requirement beyond public rules. */
export function serializeReviewForOwner(review: RawReview): Record<string, unknown> {
  const raw =
    typeof review.toObject === 'function' ? review.toObject() : ({ ...review } as Record<string, unknown>);
  return {
    ...raw,
    helpfulCount:
      typeof review.helpfulCount === 'number' ?
        review.helpfulCount
      : Array.isArray(review.helpfulVotes) ?
        review.helpfulVotes.length
      : 0,
  };
}
