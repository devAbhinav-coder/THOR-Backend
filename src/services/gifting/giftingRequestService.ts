import { AuthRequest } from '../../types';
import AppError from '../../utils/AppError';
import { giftingRepository } from '../../repositories/giftingRepository';
import { safeJsonParse } from '../../utils/safeJson';
import { serializeGiftingRequest, serializeGiftingRequestList } from '../../utils/giftingDto';
import { scheduleNewRequestNotifications } from './giftingNotificationService';
import { recordGiftingMetric } from './giftingMetricsService';
import { GIFTING_QUERY_MAX_MS } from '../../constants/giftingQuery';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';

const extractObjectIdString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
};

export interface SubmitGiftingRequestInput {
  name: string;
  email: string;
  phone?: string;
  occasion: string;
  items: unknown;
  recipientMessage?: string;
  customizationNote?: string;
  packagingPreference?: string;
  customPackagingNote?: string;
  proposedPrice?: number;
  referenceImages?: { url: string; publicId: string }[];
}

export async function submitGiftingRequest(req: AuthRequest, input: SubmitGiftingRequestInput) {
  const itemsParsed = safeJsonParse<unknown[]>(input.items, [], 'items');
  if (!itemsParsed?.length) {
    throw new AppError('Please add at least one item to your request.', 400);
  }

  const giftRequest = await giftingRepository.create({
    user: req.user?._id,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim(),
    occasion: input.occasion.trim(),
    items: itemsParsed,
    recipientMessage: input.recipientMessage?.trim(),
    customizationNote: input.customizationNote?.trim(),
    packagingPreference: input.packagingPreference || 'standard',
    customPackagingNote: input.customPackagingNote?.trim(),
    referenceImages: input.referenceImages ?? [],
    proposedPrice: input.proposedPrice ? Number(input.proposedPrice) : undefined,
    status: 'new',
  });

  const ctx = getRequestContext();
  recordGiftingMetric('gifting.request.created', { giftingRequestId: String(giftRequest._id) });

  scheduleNewRequestNotifications({
    requestId: String(giftRequest._id),
    name: input.name,
    email: input.email,
    phone: input.phone,
    occasion: input.occasion,
    itemCount: itemsParsed.length,
    proposedPrice: input.proposedPrice,
  });

  logger.info({
    msg: 'gifting_request_created',
    giftingRequestId: String(giftRequest._id),
    userId: req.user?._id ? String(req.user._id) : undefined,
    requestId: ctx?.requestId,
  });

  return giftRequest;
}

export async function listGiftingRequestsAdmin(params: {
  status?: string;
  page: number;
  limit: number;
}) {
  const filter: Record<string, unknown> = {};
  if (params.status) filter.status = params.status;
  const skip = (params.page - 1) * params.limit;

  const [requests, total] = await Promise.all([
    giftingRepository.list(filter, skip, params.limit),
    giftingRepository.count(filter),
  ]);

  return {
    requests: serializeGiftingRequestList(requests.map((r) => r.toObject?.() ?? r)),
    total,
  };
}

export async function listMyGiftingRequests(userId: string, page: number, limit: number) {
  const skip = (page - 1) * limit;
  const [requests, total] = await Promise.all([
    giftingRepository.listForUser(userId, skip, limit),
    giftingRepository.count({ user: userId }),
  ]);

  return {
    requests: serializeGiftingRequestList(requests.map((r) => r.toObject?.() ?? r)),
    total,
  };
}

export async function getGiftingRequestById(id: string, req: AuthRequest) {
  const isAdmin = req.user?.role === 'admin';
  const request = await giftingRepository.findByIdWithDetails(id);
  if (!request) throw new AppError('Gifting request not found', 404);

  const requestUserId = extractObjectIdString(request.user);
  if (!isAdmin && requestUserId !== req.user?._id.toString()) {
    throw new AppError('You are not authorized to view this request.', 403);
  }

  return serializeGiftingRequest(request.toObject?.() ?? request);
}
