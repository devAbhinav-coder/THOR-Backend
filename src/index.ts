import "dotenv/config";
import "./instrumentation/register";
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
import { redisConnection, redisEnabled } from "./config/redis";

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
      callback(null, false);
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
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    ...(process.env.NODE_ENV === "production" ?
      {
        strictTransportSecurity: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false,
        },
      }
    : {}),
  }),
);

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "9000", 10);
const configuredMax = parseInt(process.env.RATE_LIMIT_MAX || "100", 10);
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
  max: 100,
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
  res.setHeader("x-request-id", id);
  req.requestId = id;
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  requestContext.run({ requestId: id, ip }, () => next());
});

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
    const pong = await redisConnection.ping();
    redisOk = pong === "PONG";
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

app.use("/api", limiter);

app.use("/api/auth", authLimiter, authRoutes);
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

const shutdown = async (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    try {
      if (process.env.SENTRY_DSN?.trim()) {
        await Sentry.close(2000);
      }
      await closeEmailWorker();
      await closePushWorker();
      if (emailQueue) {
        await emailQueue.close();
      }
      if (pushQueue) {
        await pushQueue.close();
      }
      await mongoose.connection.close();
      await redisConnection.quit();
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
