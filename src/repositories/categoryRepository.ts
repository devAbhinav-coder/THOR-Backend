import Category from "../models/Category";

export const categoryRepository = {
  list(filter: Record<string, unknown>) {
    return Category.find(filter).sort({ name: 1 }).select("name slug description image isActive isGiftCategory giftType minOrderQty");
  },
};
