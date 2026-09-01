import { isRedisOperational, redisConnection } from "../config/redis";
import logger from "../types/utils/logger";

export const WORKER_HEARTBEAT_KEY = "health:worker:heartbeat";
const DEFAULT_TTL_SEC = 180;

let timer: ReturnType<typeof setInterval> | null = null;

export async function writeWorkerHeartbeat(): Promise<void> {
  if (!isRedisOperational()) return;
  const ttl = Number(process.env.WORKER_HEARTBEAT_TTL_SEC || DEFAULT_TTL_SEC);
  await redisConnection.set(
    WORKER_HEARTBEAT_KEY,
    new Date().toISOString(),
    "EX",
    Number.isFinite(ttl) ? Math.max(60, ttl) : DEFAULT_TTL_SEC,
  );
}

export async function readWorkerHeartbeat(): Promise<{
  alive: boolean;
  lastBeatAt: string | null;
}> {
  if (!isRedisOperational()) {
    return { alive: false, lastBeatAt: null };
  }
  const lastBeatAt = await redisConnection.get(WORKER_HEARTBEAT_KEY);
  return { alive: Boolean(lastBeatAt), lastBeatAt };
}

export function startWorkerHeartbeat(): void {
  if (timer) return;
  const ms = Number(process.env.WORKER_HEARTBEAT_MS || 60_000);
  void writeWorkerHeartbeat().catch((e: Error) => {
    logger.warn(`Worker heartbeat write failed: ${e.message}`);
  });
  timer = setInterval(() => {
    void writeWorkerHeartbeat().catch((e: Error) => {
      logger.warn(`Worker heartbeat write failed: ${e.message}`);
    });
  }, Number.isFinite(ms) ? Math.max(15_000, ms) : 60_000);
  timer.unref?.();
}

export function stopWorkerHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
