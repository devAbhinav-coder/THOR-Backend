import "dotenv/config";
import "./instrumentation/register";
import { assertRequiredEnv } from "./config/env";
assertRequiredEnv();
import { randomUUID } from "crypto";
import express, { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import cors from "cors";
import helmet from "helmet";
import hpp from "hpp";
import morgan from "morgan";
import compression from "compression";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import mongoose from "mongoose";
import swaggerUi from "swagger-ui-express";

import connectDB from "./config/db";
import logger from "./types/utils/logger";
import errorHandler from "./middleware/errorHandler";
import AppError from "./types/utils/AppError";
import {
  closeAllRedisConnections,
  redisConnection,
  bootstrapRedis,
  isRedisOperational,
  shouldUseRedisRateLimit,
  redisEnabled,
} from "./config/redis";

import authRoutes from "./routes/authRoutes";
import productRoutes from "./routes/productRoutes";
import cartRoutes from "./routes/cartRoutes";
import orderRoutes from "./routes/orderRoutes";
import reviewRoutes from "./routes/reviewRoutes";
import reviewInviteRoutes from "./routes/reviewInviteRoutes";
import testimonialRoutes from "./routes/testimonialRoutes";
import wishlistRoutes from "./routes/wishlistRoutes";
import couponRoutes from "./routes/couponRoutes";
import saleCampaignRoutes from "./routes/saleCampaignRoutes";
import promotionRoutes from "./routes/promotionRoutes";
import adminRoutes from "./routes/adminRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import storefrontRoutes from "./routes/storefrontRoutes";
import blogRoutes from "./routes/blogRoutes";
import newsletterRoutes from "./routes/newsletterRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import giftingRoutes from "./routes/giftingRoutes";
import premiumRoutes from "./routes/premiumRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import navigationRoutes from "./routes/navigationRoutes";
import collectionRoutes from "./routes/collectionRoutes";
import raniCareRoutes from "./routes/raniCareRoutes";

import {
  startAllBackgroundWork,
  stopAllBackgroundWork,
} from "./jobs/jobBootstrap";
import { shouldRunHttpServer, getRunMode, shouldRunBackgroundJobs } from "./config/runMode";
import { setupBullBoard } from "./config/bullBoard";
import { requestContext } from "./types/utils/requestContext";
import { botHeuristics } from "./middleware/botHeuristics";
import { xssSanitize } from "./middleware/xssSanitize";
import { responseAdapter } from "./middleware/responseAdapter";
import { paginationGuard } from "./middleware/paginationGuard";
import { openApiSpec } from "./docs/openapi";
import { shutdownOtel } from "./instrumentation/otel";
import {
  getCorsAllowedOriginSet,
  normalizeOriginUrl,
} from "./config/allowedOrigins";
import { csrfOriginGuard } from "./middleware/csrfOriginGuard";
import {
  buildInfrastructureReport,
  ensureRedisReady,
  logInfrastructureReport,
} from "./config/infrastructureReadiness";
const app = express();

if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

const corsAllowSet = getCorsAllowedOriginSet();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (corsAllowSet.has(normalizeOriginUrl(origin))) {
        return callback(null, true);
      }
      logger.warn(
        `CORS blocked request from origin: ${origin} (allowed: ${[...corsAllowSet].join(", ")})`,
      );
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-Client",
      "X-Client-Type",
      "Idempotency-Key",
      "Accept",
      "Cookie",
    ],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  }),
);

app.use(csrfOriginGuard);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },

    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
    },

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        baseUri: ["'self'"],

        frameAncestors: ["'none'"],

        objectSrc: ["'none'"],

        scriptSrc: ["'self'", "'unsafe-inline'"],

        styleSrc: ["'self'", "'unsafe-inline'", "https:"],

        imgSrc: ["'self'", "data:", "https:"],

        fontSrc: ["'self'", "https:", "data:"],

        connectSrc: ["'self'", "https:", "wss:"],

        upgradeInsecureRequests: [],
      },
    },

    ...(process.env.NODE_ENV === "production" ?
      {
        strictTransportSecurity: {
          maxAge: 63072000,
          includeSubDomains: true,
          preload: true,
        },
      }
    : {}),
  }),
);
const windowMs = parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000),
  10,
);

const configuredMax = parseInt(process.env.RATE_LIMIT_MAX || "200", 10);
const max =
  process.env.NODE_ENV === "production" ?
    Math.min(Math.max(100, configuredMax), 2000)
  : configuredMax;
if (process.env.NODE_ENV === "production" && configuredMax > 2000) {
  logger.warn(
    `RATE_LIMIT_MAX=${configuredMax} too high for production; capped to ${max}.`,
  );
}

/** Dev uses in-memory store only when Redis probe failed at startup. */
const useRedisRateLimitStore = shouldUseRedisRateLimit();

const limiter = rateLimit({
  windowMs,
  max,
  skip: (req) => req.method === "OPTIONS",
  message: {
    status: "error",
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(useRedisRateLimitStore ?
    {
      store: new RedisStore({
        prefix: "rl:api:",
        sendCommand: (...args: string[]) =>
          redisConnection.call(
            args[0],
            ...(args.slice(1) as string[]),
          ) as Promise<
            string | number | boolean | (string | number | boolean)[]
          >,
      }),
    }
  : {}),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skip: (req) => req.method === "OPTIONS",
  message: {
    status: "error",
    message:
      "Too many authentication attempts, please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(useRedisRateLimitStore ?
    {
      store: new RedisStore({
        prefix: "rl:auth:",
        sendCommand: (...args: string[]) =>
          redisConnection.call(
            args[0],
            ...(args.slice(1) as string[]),
          ) as Promise<
            string | number | boolean | (string | number | boolean)[]
          >,
      }),
    }
  : {}),
});

/** Protect HMAC verification from flood/DoS (runs before express.json). */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  skip: (req) => req.method === "OPTIONS",
  message: {
    status: "error",
    message: "Too many webhook requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(useRedisRateLimitStore ?
    {
      store: new RedisStore({
        prefix: "rl:webhook:",
        sendCommand: (...args: string[]) =>
          redisConnection.call(
            args[0],
            ...(args.slice(1) as string[]),
          ) as Promise<
            string | number | boolean | (string | number | boolean)[]
          >,
      }),
    }
  : {}),
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  const traceId = (req.headers["x-trace-id"] as string) || undefined;
  res.setHeader("x-request-id", id);
  if (traceId) res.setHeader("x-trace-id", traceId);
  req.requestId = id;
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  requestContext.run({ requestId: id, traceId, ip }, () => next());
});

/** Razorpay webhooks require raw body for HMAC verification (must run before express.json). */
app.use(
  "/api/webhooks",
  webhookLimiter,
  express.raw({
    type: "application/json",
    limit: process.env.JSON_BODY_LIMIT || "512kb",
  }),
  webhookRoutes,
);

const jsonLimit = process.env.JSON_BODY_LIMIT || "512kb";
app.use(express.json({ limit: jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonLimit }));
app.use(responseAdapter);
app.use(paginationGuard);
app.use(cookieParser());
app.use(hpp());
app.use(botHeuristics);
app.use(mongoSanitize());
app.use(xssSanitize);
app.use(compression());

app.use(
  morgan(process.env.NODE_ENV === "development" ? "dev" : "combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  }),
);

app.get("/api/health/live", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    message: "process is up",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health/worker", async (req: Request, res: Response) => {
  const expected = process.env.HEALTHCHECK_TOKEN?.trim();
  const given = String(req.query.token || req.headers["x-healthcheck-token"] || "");
  if (expected && given !== expected) {
    res.status(401).json({ status: "fail", message: "Unauthorized" });
    return;
  }
  const { readWorkerHeartbeat } = await import("./services/workerHeartbeat");
  const beat = await readWorkerHeartbeat();
  res.status(beat.alive ? 200 : 503).json({
    status: beat.alive ? "ok" : "down",
    message: beat.alive ? "Worker heartbeat is fresh" : "Worker heartbeat missing — job process may be down",
    lastBeatAt: beat.lastBeatAt,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Public readiness — Mongo/Redis booleans only (no infra posture leak).
 * Full report: GET /api/health/detailed?token=HEALTHCHECK_TOKEN
 */
app.get("/api/health", async (_req: Request, res: Response) => {
  await ensureRedisReady();
  const mongoOk = mongoose.connection.readyState === 1;
  const isProd = process.env.NODE_ENV === "production";
  const redisRequired = isProd && redisEnabled;
  let redisOk = !redisRequired;
  if (redisEnabled) {
    try {
      const pong = await Promise.race([
        redisConnection.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 2500),
        ),
      ]);
      redisOk = pong === "PONG";
    } catch {
      redisOk = false;
    }
  }
  const ok = mongoOk && (!redisRequired || redisOk);

  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    message:
      !mongoOk ? "Database connection failed"
      : redisRequired && !redisOk ? "Redis connection failed"
      : "API is running",
    timestamp: new Date().toISOString(),
    checks: {
      mongodb: mongoOk,
      redis: redisEnabled ? redisOk : "disabled",
    },
  });
});

/** Detailed infra posture — gated (same token as /api/health/worker). */
app.get("/api/health/detailed", async (req: Request, res: Response) => {
  const expected = process.env.HEALTHCHECK_TOKEN?.trim();
  const given = String(
    req.query.token || req.headers["x-healthcheck-token"] || "",
  );
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !expected) {
    res.status(503).json({
      status: "fail",
      message: "HEALTHCHECK_TOKEN is not configured",
    });
    return;
  }
  if (expected && given !== expected) {
    res.status(401).json({ status: "fail", message: "Unauthorized" });
    return;
  }

  await ensureRedisReady();
  const report = await buildInfrastructureReport();
  const mongoOk = report.checks.mongodb.status === "ok";
  const redisOk = report.checks.redis.status === "ok";
  const redisRequired = isProd && redisEnabled;
  const ok = mongoOk && (!redisRequired || redisOk);

  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    message:
      !mongoOk ? "Database connection failed"
      : redisRequired && !redisOk ? "Redis connection failed"
      : "API is running",
    timestamp: report.timestamp,
    runMode: report.runMode,
    checks: {
      mongodb: mongoOk,
      redis:
        report.checks.redis.status === "disabled" ? "disabled" : redisOk,
      email: report.checks.email.status,
      worker: report.checks.workerProcess.status,
      abandonedCartRecovery: report.checks.abandonedCartRecovery.status,
      paymentRecovery: report.checks.paymentRecovery.status,
    },
    infrastructure: report.checks,
  });
});
app.use(
  "/api/docs",
  (req: Request, res: Response, next: NextFunction) => {
    const enabled =
      process.env.ENABLE_API_DOCS === "true" ||
      process.env.NODE_ENV !== "production";
    if (!enabled) {
      res.status(404).json({ status: "fail", message: "Not found" });
      return;
    }
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec),
);

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api", limiter);

app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/review-invites", reviewInviteRoutes);
app.use("/api/testimonials", testimonialRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/sales", saleCampaignRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/storefront", storefrontRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/gifting", giftingRoutes);
app.use("/api/premium", premiumRoutes);
app.use("/api/navigation", navigationRoutes);
app.use("/api/rani-care", raniCareRoutes);

app.all("*", (req, _res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server.`, 404));
});

if (process.env.SENTRY_DSN?.trim()) {
  Sentry.setupExpressErrorHandler(app);
}
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "5000", 10);
let server: ReturnType<typeof app.listen> | null = null;

async function bootstrap(): Promise<void> {
  await bootstrapRedis();
  await connectDB();
  startAllBackgroundWork();
  await setupBullBoard(app);

  const infraReport = await buildInfrastructureReport();
  logInfrastructureReport(infraReport);
  if (
    infraReport.checks.workerProcess.status === "degraded" &&
    process.env.NODE_ENV !== "production"
  ) {
    logger.warn(
      "Background jobs need a worker: run `npm run worker:dev` or `npm run dev:stack` in another terminal.",
    );
  }

  if (process.env.NODE_ENV === "production") {
    const mode = getRunMode();
    if (mode === "all") {
      logger.warn(
        "RUN_MODE=all in production: API and all background jobs share one process. Prefer RUN_MODE=api on API pods + npm run worker on a job pod.",
      );
    } else if (mode === "api" && shouldRunBackgroundJobs()) {
      logger.warn(
        "Unexpected: RUN_MODE=api but background jobs started — check JOBS_ENABLED.",
      );
    } else if (mode === "api") {
      logger.info(
        "Production API mode: background jobs disabled (use worker process for jobs).",
      );
    }
  }

  if (process.env.NODE_ENV === "production" && isRedisOperational()) {
    const pong = await redisConnection.ping();
    if (pong !== "PONG") {
      logger.error("Redis ping failed in production");
      process.exit(1);
    }
  }

  if (shouldRunHttpServer()) {
    server = app.listen(PORT, "0.0.0.0", () => {
      logger.info(
        `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`,
      );
    });

    server.headersTimeout = parseInt(
      process.env.HEADERS_TIMEOUT_MS || "65000",
      10,
    );
    server.requestTimeout = parseInt(
      process.env.REQUEST_TIMEOUT_MS || "120000",
      10,
    );
    server.keepAliveTimeout = parseInt(
      process.env.KEEP_ALIVE_TIMEOUT_MS || "65000",
      10,
    );
    const maxConnections = parseInt(process.env.MAX_CONNECTIONS || "0", 10);
    if (maxConnections > 0) {
      server.maxConnections = maxConnections;
    }
  } else {
    logger.info("HTTP server disabled (RUN_MODE=worker)");
  }
}

void bootstrap().catch((err: unknown) => {
  logger.error(`Startup failed: ${(err as Error).message}`);
  process.exit(1);
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);

  const forceTimer = setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  const closeHttp = () =>
    new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });

  try {
    await closeHttp();
    if (process.env.SENTRY_DSN?.trim()) {
      await Sentry.close(2000);
    }
    await stopAllBackgroundWork();
    await mongoose.connection.close();
    await closeAllRedisConnections();
    await shutdownOtel();
    logger.info("Connections closed.");
  } catch (e) {
    logger.error(`Shutdown error: ${(e as Error).message}`);
  } finally {
    clearTimeout(forceTimer);
    process.exit(0);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (err: Error) => {
  logger.error(`UNHANDLED REJECTION: ${err.message}`);
  if (process.env.SENTRY_DSN?.trim()) {
    Sentry.captureException(err);
  }
  const redisNoise =
    process.env.NODE_ENV !== "production" &&
    /redis|max retries per request|command timed out|connection is closed|econnrefused/i.test(
      err.message,
    );
  if (redisNoise) {
    logger.warn("Ignoring Redis rejection in development — API continues with fallbacks.");
    return;
  }
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

export default app;
