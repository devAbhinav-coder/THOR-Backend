import { redisConnection } from "../config/redis";

export async function getCache<T>(key: string): Promise<T | null> {
  const raw = await redisConnection.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await redisConnection.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function deleteCache(key: string): Promise<void> {
  await redisConnection.del(key);
}
