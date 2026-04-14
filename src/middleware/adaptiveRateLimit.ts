import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { Request } from "express";
import { createHash } from "crypto";
import { redisConnection, redisEnabled } from "../config/redis";

const sendCommand = (...args: string[]) =>
  redisConnection.call(args[0], ...(args.slice(1) as string[])) as Promise<
    string | number | boolean | (string | number | boolean)[]
  >;

function readCredentialIdentity(credentialRaw: string): string | null {
  try {
    const payloadBase64 = credentialRaw.split(".")[1];
    if (!payloadBase64) return null;
    const payloadJson = Buffer.from(payloadBase64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { email?: string; sub?: string };
    if (payload.email) return payload.email.toLowerCase();
    if (payload.sub) return `sub:${payload.sub}`;
    return null;
  } catch {
    return null;
  }
}

function compactHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function keyByUserAndIp(req: Request): string {
  const userId = (req as Request & { user?: { _id?: unknown } }).user?._id;
  const body = (req.body || {}) as {
    email?: string;
    credential?: string;
  };
  const email = String(body.email || "").toLowerCase().trim();
  const credential = String(body.credential || "").trim();
  const credentialIdentity =
    credential ? readCredentialIdentity(credential) || `cred:${compactHash(credential)}` : "";
  const refreshCookie = String((req.cookies as { refreshToken?: string } | undefined)?.refreshToken || "").trim();
  const refreshIdentity = refreshCookie ? `refresh:${compactHash(refreshCookie)}` : "";
  const idPart =
    userId ? String(userId)
    : email || credentialIdentity || refreshIdentity || "anon";
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const routePart = `${req.baseUrl || ""}${req.path || ""}` || req.originalUrl || "route";
  return `${routePart}:${idPart}:${ip}`;
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
