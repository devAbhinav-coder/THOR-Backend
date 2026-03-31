import mongoose from "mongoose";
import Order from "../models/Order";
import Cart from "../models/Cart";
import Product from "../models/Product";
import User from "../models/User";

export const orderRepository = {
  findCartForCheckout(userId: string) {
    return Cart.findOne({ user: userId }).populate("items.product");
  },
  findProductsByIds(productIds: string[]) {
    return Product.find({ _id: { $in: productIds } });
  },
  createOrder(payload: Record<string, unknown>) {
    return Order.create(payload);
  },
  createOrderInSession(payload: Record<string, unknown>, session: mongoose.ClientSession) {
    return Order.create([payload], { session });
  },
  deleteCartById(cartId: mongoose.Types.ObjectId | string) {
    return Cart.findByIdAndDelete(cartId);
  },
  deleteCartByIdInSession(cartId: mongoose.Types.ObjectId | string, session: mongoose.ClientSession) {
    return Cart.deleteOne({ _id: cartId }, { session });
  },
  findActiveAdminEmails() {
    return User.find({ role: "admin", isActive: true }).select("email");
  },
  findOrderForUser(orderId: string, userId: string) {
    return Order.findOne({ _id: orderId, user: userId });
  },
  findOrderWithItems(orderId: string) {
    return Order.findById(orderId).populate("items.product", "name images");
  },
  findUserOrders(query: Record<string, unknown>, skip: number, limit: number) {
    return Order.find(query)
      .sort("-createdAt")
      .skip(skip)
      .limit(limit)
      .populate("items.product", "name images");
  },
  countOrders(query: Record<string, unknown>) {
    return Order.countDocuments(query);
  },
};
