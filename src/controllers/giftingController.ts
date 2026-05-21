import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';
import { sendPaginated, sendSuccess } from '../utils/response';
import { discoverGiftableProducts, getGiftCategories } from '../services/gifting/giftingProductDiscoveryService';
import {
  getGiftingRequestById,
  listGiftingRequestsAdmin,
  listMyGiftingRequests,
  submitGiftingRequest,
} from '../services/gifting/giftingRequestService';
import { respondToQuote, updateGiftingRequestAdmin } from '../services/gifting/giftingQuoteService';

/** GET /gifting/products */
export const getGiftableProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await discoverGiftableProducts(req.query as Record<string, string>);
  sendPaginated(
    res,
    { products: result.products },
    {
      page: result.page,
      limit: result.limit,
      total: result.total,
      hasNextPage: result.hasNextPage,
    },
  );
});

/** GET /gifting/categories */
export const getGiftCategoriesHandler = catchAsync(async (_req: Request, res: Response) => {
  const categories = await getGiftCategories();
  sendSuccess(res, { categories });
});

export { getGiftCategoriesHandler as getGiftCategories };

/** POST /gifting/requests */
export const submitGiftingRequestHandler = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const uploadedImages = (
      req as Request & { uploadedImages?: { url: string; publicId: string }[] }
    ).uploadedImages;

    try {
      const giftRequest = await submitGiftingRequest(req, {
        ...req.body,
        referenceImages: uploadedImages ?? [],
      });
      sendSuccess(res, { request: giftRequest }, 'Gifting request submitted', 201);
    } catch (err) {
      next(err);
    }
  }
);

export { submitGiftingRequestHandler as submitGiftingRequest };

/** GET /gifting/requests (admin) */
export const getGiftingRequests = catchAsync(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const { requests, total } = await listGiftingRequestsAdmin({
    status: req.query.status ? String(req.query.status) : undefined,
    page,
    limit,
  });
  sendPaginated(res, { requests }, { page, limit, total });
});

/** GET /gifting/requests/:id */
export const getGiftingRequestByIdHandler = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const request = await getGiftingRequestById(req.params.id, req);
      sendSuccess(res, { request });
    } catch (err) {
      next(err);
    }
  }
);

export { getGiftingRequestByIdHandler as getGiftingRequestById };

/** GET /gifting/my-requests */
export const getMyGiftingRequests = catchAsync(async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const { requests, total } = await listMyGiftingRequests(String(req.user?._id), page, limit);
  sendPaginated(res, { requests }, { page, limit, total });
});

/** PATCH /gifting/requests/:id (admin) */
export const updateGiftingRequest = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const request = await updateGiftingRequestAdmin(req.params.id, req.body);
      sendSuccess(res, { request });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /gifting/requests/:id/respond */
export const userRespondToQuote = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { action, shippingAddress } = req.body as {
      action: 'accept' | 'reject';
      shippingAddress?: Record<string, string>;
    };

    try {
      const result = await respondToQuote(req, req.params.id, action, shippingAddress as never);
      if ('orderId' in result) {
        sendSuccess(res, { orderId: result.orderId, orderNumber: result.orderNumber });
        return;
      }
      sendSuccess(res, {}, result.message ?? 'Request rejected and closed.');
    } catch (err) {
      next(err);
    }
  }
);
