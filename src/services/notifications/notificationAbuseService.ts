import { redisEnabled, redisConnection } from "../../config/redis";
import AppError from "../../types/utils/AppError";

const SUBSCRIBE_WINDOW_SEC = 60;
const SUBSCRIBE_MAX = 15;
const TEST_PUSH_WINDOW_SEC = 300;
const TEST_PUSH_MAX = 3;

function key(userId: string, action: string): string {
  return `notif:abuse:${action}:${userId}`;
}

async function assertUnderLimit(
  userId: string,
  action: string,
  max: number,
  windowSec: number,
  message: string,
): Promise<void> {
  if (!redisEnabled) return;
  const k = key(userId, action);
  const count = await redisConnection.incr(k);
  if (count === 1) {
    await redisConnection.expire(k, windowSec);
  }
  if (count > max) {
    throw new AppError(message, 429);
  }
}

export async function assertSubscribeAllowed(userId: string): Promise<void> {
  await assertUnderLimit(
    userId,
    "subscribe",
    SUBSCRIBE_MAX,
    SUBSCRIBE_WINDOW_SEC,
    "Too many subscription attempts. Please try again later.",
  );
}

export async function assertTestPushAllowed(userId: string): Promise<void> {
  await assertUnderLimit(
    userId,
    "test_push",
    TEST_PUSH_MAX,
    TEST_PUSH_WINDOW_SEC,
    "Test push rate limit exceeded.",
  );
}
