import { Response } from 'express';
import catchAsync from '../utils/catchAsync';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { wishlistService } from '../services/wishlist/wishlistService';
import { parseWishlistListQuery } from '../validation/wishlistSchemas';

export const getWishlist = catchAsync(async (req: AuthRequest, res: Response) => {
  const userId = String(req.user!._id);
  const listQuery = parseWishlistListQuery(
    req.query as { page?: number; limit?: number }
  );

  const result = await wishlistService.getWishlist(userId, listQuery);

  if (result.paginated && result.pagination) {
    sendSuccess(
      res,
      { products: result.products },
      'OK',
      200,
      { pagination: result.pagination }
    );
    return;
  }

  sendSuccess(res, { products: result.products });
});

export const toggleWishlist = catchAsync(async (req: AuthRequest, res: Response) => {
  const userId = String(req.user!._id);
  const { productId } = req.params as { productId: string };

  const { wishlistCount, action } = await wishlistService.toggleProduct(userId, productId);

  sendSuccess(res, { wishlistCount, action });
});
