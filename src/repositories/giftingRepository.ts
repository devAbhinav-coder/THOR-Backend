import GiftingRequest from "../models/GiftingRequest";

export const giftingRepository = {
  create(payload: Record<string, unknown>) {
    return GiftingRequest.create(payload);
  },
  findByIdWithDetails(id: string) {
    return GiftingRequest.findById(id)
      .populate("user", "name email phone")
      .populate("items.product", "name description images price");
  },
  findById(id: string) {
    return GiftingRequest.findById(id);
  },
  list(filter: Record<string, unknown>, skip: number, limit: number) {
    return GiftingRequest.find(filter)
      .populate("user", "name email phone")
      .populate("items.product", "name description images price")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  },
  count(filter: Record<string, unknown>) {
    return GiftingRequest.countDocuments(filter);
  },
  listForUser(userId: string, skip: number, limit: number) {
    return GiftingRequest.find({ user: userId })
      .populate("items.product", "name description images price")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  },
};
