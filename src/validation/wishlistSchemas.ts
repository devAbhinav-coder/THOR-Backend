import { z } from 'zod';

const mongoObjectId = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid product id');

export const toggleWishlistSchema = z.object({
  params: z.object({
    productId: mongoObjectId,
  }),
});

const wishlistQueryBase = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const getWishlistQuerySchema = z.object({
  query: wishlistQueryBase,
});

export type WishlistListQuery = {
  paginated: boolean;
  page: number;
  limit: number;
};

export function parseWishlistListQuery(query: z.infer<typeof wishlistQueryBase>): WishlistListQuery {
  const paginated = query.page !== undefined || query.limit !== undefined;
  return {
    paginated,
    page: query.page ?? 1,
    limit: query.limit ?? 20,
  };
}
