/**
 * Fail fast on missing or weak secrets in production.
 * Call once at process startup (after dotenv loads).
 */
export function assertRequiredEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const required = ['MONGODB_URI', 'JWT_SECRET'];

  if (isProd) {
    required.push('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET');
  }

  const missing = required.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const jwt = process.env.JWT_SECRET ?? '';
  if (isProd && jwt.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }
}
