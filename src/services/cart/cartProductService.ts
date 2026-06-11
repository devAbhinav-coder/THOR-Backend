import mongoose from "mongoose";
import Product from "../../models/Product";
import AppError from "../../types/utils/AppError";
import {
  CART_QUERY_MAX_MS,
  PRODUCT_FOR_CART_SELECT,
  PRODUCT_MIN_QTY_SELECT,
} from "./cartConstants";

export type CartProductRecord = Record<string, unknown>;

export const cartProductService = {
  async findForAddToCart(productId: string): Promise<CartProductRecord> {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError("Invalid product ID.", 400);
    }
    const product = await Product.findById(productId)
      .select(PRODUCT_FOR_CART_SELECT)
      .maxTimeMS(CART_QUERY_MAX_MS)
      .lean<CartProductRecord>();
    if (!product) {
      throw new AppError("Product not found or unavailable.", 404);
    }
    return product;
  },

  async findMinQtyFields(productId: string): Promise<CartProductRecord | null> {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return null;
    }
    return Product.findById(productId)
      .select(PRODUCT_MIN_QTY_SELECT)
      .maxTimeMS(CART_QUERY_MAX_MS)
      .lean<CartProductRecord>();
  },
};
