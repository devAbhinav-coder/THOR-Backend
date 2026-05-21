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
import logger from "./utils/logger";
import errorHandler from "./middleware/errorHandler";
import AppError from "./utils/AppError";
import { closeAllRedisConnections, redisConnection, redisEnabled } from "./config/redis";

import authRoutes from "./routes/authRoutes";
import productRoutes from "./routes/productRoutes";
import cartRoutes from "./routes/cartRoutes";
import orderRoutes from "./routes/orderRoutes";
import reviewRoutes from "./routes/reviewRoutes";
import wishlistRoutes from "./routes/wishlistRoutes";
import couponRoutes from "./routes/couponRoutes";
import adminRoutes from "./routes/adminRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import storefrontRoutes from "./routes/storefrontRoutes";
import blogRoutes from "./routes/blogRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import giftingRoutes from "./routes/giftingRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import { runPaymentRecoveryJob } from "./services/paymentRecoveryJob";
import {
  startEmailWorker,
  closeEmailWorker,
  emailQueue,
} from "./queues/emailQueue";
import {
  startPushWorker,
  closePushWorker,
  pushQueue,
} from "./queues/pushQueue";
import {
  startImageWorker,
  closeImageWorker,
  imageQueue,
} from "./queues/imageQueue";
import { startOrderWorker, closeOrderWorker } from "./workers/orderWorker";
import { orderQueue } from "./queues/orderQueue";
import {
  startOrderOutboxPoller,
  stopOrderOutboxPoller,
} from "./jobs/orderOutboxPoller";
import {
  startInventoryOutboxPoller,
  stopInventoryOutboxPoller,
} from "./jobs/inventoryOutboxPoller";
import {
  startCouponOutboxPoller,
  stopCouponOutboxPoller,
} from "./jobs/couponOutboxPoller";
import {
  startInventoryReconciliationJob,
  stopInventoryReconciliationJob,
} from "./jobs/inventoryReconciliationJob";
import {
  startGiftingOutboxPoller,
  stopGiftingOutboxPoller,
} from "./jobs/giftingOutboxPoller";
import {
  startPushOutboxPoller,
  stopPushOutboxPoller,
} from "./jobs/pushOutboxPoller";
import {
  startCartOutboxPoller,
  stopCartOutboxPoller,
} from "./jobs/cartOutboxPoller";
import {
  startCartSyncSubscriber,
  stopCartSyncSubscriber,
} from "./workers/cartSyncSubscriber";
import {
  startNotificationMaintenanceJob,
  stopNotificationMaintenanceJob,
} from "./jobs/notificationMaintenanceJob";
import { requestContext } from "./utils/requestContext";
import { botHeuristics } from "./middleware/botHeuristics";
import { xssSanitize } from "./middleware/xssSanitize";
import { responseAdapter } from "./middleware/responseAdapter";
import { paginationGuard } from "./middleware/paginationGuard";
import { openApiSpec } from "./docs/openapi";
import {
  getCorsAllowedOriginSet,
  normalizeOriginUrl,
} from "./config/allowedOrigins";
import { csrfOriginGuard } from "./middleware/csrfOriginGuard";
import { delhiveryIsConfigured } from "./config/delhivery";
import { runDelhiveryTrackingSyncJob } from "./services/delhiveryTrackingSyncService";
const app = express();

if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

connectDB();
startEmailWorker();
startPushWorker();
startImageWorker();
startOrderWorker();
startOrderOutboxPoller();
startInventoryOutboxPoller();
startCouponOutboxPoller();
startInventoryReconciliationJob();
startGiftingOutboxPoller();
startPushOutboxPoller();
startCartOutboxPoller();
startCartSyncSubscriber();
startNotificationMaintenanceJob();

if (process.env.NODE_ENV === "production" && redisEnabled) {
  redisConnection.ping().catch((err: Error) => {
    logger.error(`Redis ping failed in production: ${err.message}`);
    process.exit(1);
  });
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
  ...(redisEnabled ?
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
  ...(redisEnabled ?
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

app.get("/api/health", async (_req: Request, res: Response) => {
  const mongoOk = mongoose.connection.readyState === 1;
  let redisOk = false;
  try {
    if (redisEnabled) {
      const pong = await redisConnection.ping();
      redisOk = pong === "PONG";
    }
  } catch {
    redisOk = false;
  }

  const ok = mongoOk; // ONLY Mongo decides health

  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    message: ok ? "API is running" : "Database connection failed",
    timestamp: new Date().toISOString(),
    checks: {
      mongodb: mongoOk,
      redis: redisEnabled ? redisOk : "disabled",
    },
  });
});
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api", limiter);

app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/storefront", storefrontRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/gifting", giftingRoutes);

app.all("*", (req, _res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server.`, 404));
});

if (process.env.SENTRY_DSN?.trim()) {
  Sentry.setupExpressErrorHandler(app);
}
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || "5000", 10);
const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

const delhiverySyncMs = parseInt(
  process.env.DELHIVERY_TRACK_SYNC_MS || String(20 * 60 * 1000),
  10,
);
if (delhiveryIsConfigured() && delhiverySyncMs > 0) {
  setInterval(() => {
    runDelhiveryTrackingSyncJob().catch((e) =>
      logger.error(`Delhivery tracking sync: ${(e as Error).message}`),
    );
  }, delhiverySyncMs);
  setTimeout(() => {
    runDelhiveryTrackingSyncJob().catch(() => {});
  }, 20_000);
}

const paymentRecoveryMs = parseInt(
  process.env.PAYMENT_RECOVERY_MS || String(30 * 60 * 1000),
  10,
);
if (paymentRecoveryMs > 0 && process.env.RAZORPAY_KEY_ID?.trim()) {
  setInterval(() => {
    runPaymentRecoveryJob().catch((e) =>
      logger.error(`Payment recovery job: ${(e as Error).message}`),
    );
  }, paymentRecoveryMs);
  setTimeout(() => {
    runPaymentRecoveryJob().catch(() => {});
  }, 60_000);
}

const shutdown = async (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    try {
      if (process.env.SENTRY_DSN?.trim()) {
        await Sentry.close(2000);
      }
      await closeEmailWorker();
      await closePushWorker();
      await closeImageWorker();
      stopOrderOutboxPoller();
      stopInventoryOutboxPoller();
      stopCouponOutboxPoller();
      stopInventoryReconciliationJob();
      stopGiftingOutboxPoller();
      stopPushOutboxPoller();
      stopCartOutboxPoller();
      await stopCartSyncSubscriber();
      stopNotificationMaintenanceJob();
      await closeOrderWorker();
      if (emailQueue) {
        await emailQueue.close();
      }
      if (pushQueue) {
        await pushQueue.close();
      }
      if (imageQueue) {
        await imageQueue.close();
      }
      if (orderQueue) {
        await orderQueue.close();
      }
      await mongoose.connection.close();
      await closeAllRedisConnections();
      logger.info("Connections closed.");
    } catch (e) {
      logger.error(`Shutdown error: ${(e as Error).message}`);
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (err: Error) => {
  logger.error(`UNHANDLED REJECTION: ${err.message}`);
  if (process.env.SENTRY_DSN?.trim()) {
    Sentry.captureException(err);
  }
  server.close(() => process.exit(1));
});

export default app;
