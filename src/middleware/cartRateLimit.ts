import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisConnection, redisEnabled } from "../config/redis";
import AppError from "../types/utils/AppError";

const baseOptions = {
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: () => {
    throw new AppError("Too many cart requests. Please wait a moment.", 429);
  },
};

function redisStore(prefix: string) {
  if (!redisEnabled) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redisConnection.call(args[0], ...(args.slice(1) as string[])) as Promise<
        string | number | boolean | (string | number | boolean)[]
      >,
  });
}

/** Throttle high-frequency cart mutations (add, update qty, coupon). */
export const cartMutationLimiter = rateLimit({
  ...baseOptions,
  limit: Number(process.env.CART_MUTATION_RATE_LIMIT || 30),
  ...(redisStore("rl:cart:mutation:") ?
    { store: redisStore("rl:cart:mutation:") }
  : {}),
});

export const cartCouponLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: Number(process.env.CART_COUPON_RATE_LIMIT || 12),
  ...(redisStore("rl:cart:coupon:") ?
    { store: redisStore("rl:cart:coupon:") }
  : {}),
});
