import GiftingRequest from "../models/GiftingRequest";
import { GIFTING_QUERY_MAX_MS } from "../constants/giftingQuery";

const USER_POPULATE = "name email phone";
const PRODUCT_POPULATE = "name description images price";

export const giftingRepository = {
  create(payload: Record<string, unknown>) {
    return GiftingRequest.create(payload);
  },
  findByIdWithDetails(id: string) {
    return GiftingRequest.findById(id)
      .populate("user", USER_POPULATE)
      .populate("items.product", PRODUCT_POPULATE)
      .maxTimeMS(GIFTING_QUERY_MAX_MS);
  },
  findById(id: string) {
    return GiftingRequest.findById(id).maxTimeMS(GIFTING_QUERY_MAX_MS);
  },
  list(filter: Record<string, unknown>, skip: number, limit: number) {
    return GiftingRequest.find(filter)
      .populate("user", USER_POPULATE)
      .populate("items.product", PRODUCT_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .maxTimeMS(GIFTING_QUERY_MAX_MS);
  },
  count(filter: Record<string, unknown>) {
    return GiftingRequest.countDocuments(filter).maxTimeMS(GIFTING_QUERY_MAX_MS);
  },
  listForUser(userId: string, skip: number, limit: number) {
    return GiftingRequest.find({ user: userId })
      .populate("items.product", PRODUCT_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .maxTimeMS(GIFTING_QUERY_MAX_MS);
  },
};
