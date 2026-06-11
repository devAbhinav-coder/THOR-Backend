import { Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { AuthRequest } from "../types";
import {
  registerCartSseClient,
  unregisterCartSseClient,
} from "../services/cart/cartSyncHub";

/**
 * SSE stream for multi-device cart sync. Client should call fetchCart() on `cart.changed`.
 */
export const cartSyncStream = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const userId = String(req.user!._id);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    registerCartSseClient(userId, res);
    res.write(`data: ${JSON.stringify({ type: "connected", userId })}\n\n`);

    req.on("close", () => {
      unregisterCartSseClient(userId, res);
    });
  },
);
