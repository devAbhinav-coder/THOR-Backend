import * as Sentry from "@sentry/node";

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    integrations: [Sentry.expressIntegration(), Sentry.mongooseIntegration(), Sentry.redisIntegration()],
    tracesSampleRate: Math.min(
      1,
      Math.max(0, parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"))
    ),
  });
}

export { Sentry };
