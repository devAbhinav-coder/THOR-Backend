/**
 * Fail fast on missing or weak secrets in production.
 * Call once at process startup (after dotenv loads).
 */
export function assertRequiredEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const required = ['MONGODB_URI', 'JWT_SECRET'];

  if (isProd) {
    required.push(
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'JWT_REFRESH_SECRET',
      'REDIS_URL',
    );
  }

  const missing = required.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const jwt = process.env.JWT_SECRET ?? '';
  if (isProd && jwt.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }

  const refreshSecret = process.env.JWT_REFRESH_SECRET ?? '';
  if (isProd && refreshSecret.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters in production.');
  }
}

/**
 * Environment configuration with defaults.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Pagination
  pagination: {
    maxLimit: parseInt(process.env.PAGINATION_MAX_LIMIT || '100', 10),
    defaultLimit: parseInt(process.env.PAGINATION_DEFAULT_LIMIT || '12', 10),
  },
  
  // Redis
  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  
  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  
  // Frontend
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:3000',
    urls: process.env.FRONTEND_URLS?.split(',').map(url => url.trim()) || [],
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
} as const;
