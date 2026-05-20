import { IReview } from '../../types';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';
import { recordReviewMetric } from './reviewMetricsService';

const SPAM_PATTERNS = [
  /\b(viagra|casino|crypto\s*giveaway|click\s*here\s*now)\b/i,
  /(https?:\/\/){2,}/i,
  /(.)\1{8,}/,
];

const TOXIC_PATTERNS = [
  /\b(kill\s+yourself|kys)\b/i,
];

export type ModerationScanResult = {
  flags: string[];
  score: number;
  suggestedStatus: 'visible' | 'pending_moderation' | 'flagged';
};

/**
 * Lightweight heuristic moderation — extensible for AI providers later.
 */
export function scanReviewContent(title: string | undefined, comment: string): ModerationScanResult {
  const text = `${title || ''} ${comment}`.trim();
  const flags: string[] = [];
  let score = 0;

  for (const p of SPAM_PATTERNS) {
    if (p.test(text)) {
      flags.push('spam_pattern');
      score += 2;
    }
  }
  for (const p of TOXIC_PATTERNS) {
    if (p.test(text)) {
      flags.push('toxic_pattern');
      score += 3;
    }
  }
  if (text.length > 0 && text.replace(/\s/g, '').length < 8) {
    flags.push('low_effort');
    score += 1;
  }

  let suggestedStatus: ModerationScanResult['suggestedStatus'] = 'visible';
  if (score >= 3) suggestedStatus = 'flagged';
  else if (score >= 1) suggestedStatus = 'pending_moderation';

  return { flags, score, suggestedStatus };
}

export function applyModerationToReview(
  review: IReview,
  title: string | undefined,
  comment: string
): ModerationScanResult {
  const result = scanReviewContent(title, comment);
  const ctx = getRequestContext();

  if (result.flags.length > 0) {
    (review as IReview & { moderationFlags?: string[] }).moderationFlags = result.flags;
    (review as IReview & { moderationScore?: number }).moderationScore = result.score;
    if (result.suggestedStatus !== 'visible') {
      (review as IReview & { status?: string }).status = result.suggestedStatus;
      recordReviewMetric('review.moderation.flagged', {
        productId: String(review.product),
        reviewId: String(review._id),
        flags: result.flags.join(','),
      });
      logger.info({
        msg: 'review_moderation_flagged',
        reviewId: String(review._id),
        productId: String(review.product),
        flags: result.flags,
        score: result.score,
        requestId: ctx?.requestId,
      });
    }
  }

  return result;
}

/** Queue hook for future workers — logs structured moderation job metadata. */
export function enqueueModerationReview(reviewId: string, productId: string, flags: string[]): void {
  const ctx = getRequestContext();
  logger.info({
    msg: 'review_moderation_queued',
    reviewId,
    productId,
    flags,
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
  });
}
