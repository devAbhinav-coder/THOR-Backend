import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { Request } from "express";
import { redisConnection, redisEnabled } from "../config/redis";

const sendCommand = (...args: string[]) =>
  redisConnection.call(args[0], ...(args.slice(1) as string[])) as Promise<
    string | number | boolean | (string | number | boolean)[]
  >;

function keyByUserAndIp(req: Request): string {
  const userId = (req as Request & { user?: { _id?: unknown } }).user?._id;
  const idPart = userId ? String(userId) : String((req.body as { email?: string })?.email || "anon").toLowerCase();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${idPart}:${ip}`;
}

export function createAdaptiveLimiter(options: { windowMs: number; max: number; prefix: string; message: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    keyGenerator: keyByUserAndIp,
    message: { status: "error", message: options.message },
    standardHeaders: true,
    legacyHeaders: false,
    ...(redisEnabled
      ? {
          store: new RedisStore({
            prefix: options.prefix,
            sendCommand,
          }),
        }
      : {}),
  });
}
