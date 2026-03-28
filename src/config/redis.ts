import IORedis from 'ioredis';
import logger from '../utils/logger';

const redisUrl = process.env.REDIS_URL;

const commonOptions = {
  maxRetriesPerRequest: null as null,
  enableReadyCheck: true,
};

export const redisConnection = redisUrl
  ? new IORedis(redisUrl, commonOptions)
  : new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      ...commonOptions,
    });

redisConnection.on('connect', () => logger.info('Redis connected'));
redisConnection.on('error', (err) => logger.warn(`Redis error: ${err.message}`));

