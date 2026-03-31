import { IOrderItem } from "../types";
import { Types } from "mongoose";

type GiftingProductRef = { _id: unknown; images?: { url?: string }[] };
type GiftingItem = {
  product: GiftingProductRef;
  name: string;
  quantity: number;
  customFieldAnswers?: { label: string; value: string }[];
};
type GiftingRequestLike = { items: GiftingItem[]; quotedPrice?: number };

export function buildCustomOrderItems(request: GiftingRequestLike): IOrderItem[] {
  const totalQty = request.items.reduce((acc, i) => acc + i.quantity, 0);
  return request.items.map((item) => {
    const prod = item.product;
    return {
      product: prod._id as unknown as Types.ObjectId,
      name: item.name,
      image: prod.images?.[0]?.url || "",
      variant: { sku: `CUSTOM-GIFT-${Date.now()}-${Math.floor(Math.random() * 1000)}` },
      quantity: item.quantity,
      price: Math.round(((request.quotedPrice as number) / totalQty) * 100) / 100,
      customFieldAnswers: item.customFieldAnswers?.map((a) => ({ label: a.label, value: a.value })),
    };
  });
}
