import mongoose from "mongoose";
import {
  isRedisOperational,
  redisConnection,
  redisEnabled,
  reconnectRedisIfNeeded,
} from "./redis";
import { smtpConfigured } from "../services/emailService";
import {
  getRunMode,
  shouldRunBackgroundJobs,
  shouldRunQueueWorkers,
} from "./runMode";
import logger from "../types/utils/logger";

export type ReadinessStatus = "ok" | "degraded" | "missing" | "disabled";

export type InfrastructureCheck = {
  status: ReadinessStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type InfrastructureReport = {
  timestamp: string;
  runMode: string;
  jobsEnabled: boolean;
  queueWorkersEnabled: boolean;
  ready: boolean;
  checks: {
    mongodb: InfrastructureCheck;
    redis: InfrastructureCheck;
    email: InfrastructureCheck;
    razorpay: InfrastructureCheck;
    workerProcess: InfrastructureCheck;
    abandonedCartRecovery: InfrastructureCheck;
    paymentRecovery: InfrastructureCheck;
  };
};

function envEnabled(name: string, defaultEnabled = true): boolean {
  const val = process.env[name];
  if (val === "false") return false;
  if (val === "true") return true;
  return defaultEnabled;
}

export function emailConfigured(): boolean {
  return (
    smtpConfigured() || Boolean(process.env.RESEND_API_KEY?.trim())
  );
}

export function razorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() &&
      process.env.RAZORPAY_KEY_SECRET?.trim(),
  );
}

async function pingRedis(): Promise<boolean> {
  if (!isRedisOperational()) return false;
  try {
    const pong = await Promise.race([
      redisConnection.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), 2500),
      ),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

/** Try to restore Redis after a transient outage (API/worker health ticks). */
export async function ensureRedisReady(): Promise<boolean> {
  if (!redisEnabled) return false;
  return reconnectRedisIfNeeded();
}

export async function verifyEmailTransport(): Promise<InfrastructureCheck> {
  if (!emailConfigured()) {
    return {
      status: "missing",
      message:
        "No email provider configured (set SMTP_HOST or RESEND_API_KEY)",
    };
  }

  if (process.env.WORKER_VERIFY_EMAIL === "false") {
    return {
      status: "ok",
      message: "Email provider configured (transport verify skipped)",
      details: {
        smtp: smtpConfigured(),
        resend: Boolean(process.env.RESEND_API_KEY?.trim()),
      },
    };
  }

  if (smtpConfigured()) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
      });
      await Promise.race([
        transporter.verify(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("SMTP verify timeout")), 12000),
        ),
      ]);
      return {
        status: "ok",
        message: "SMTP transport verified",
        details: { host: process.env.SMTP_HOST },
      };
    } catch (err: unknown) {
      return {
        status: "degraded",
        message: `SMTP configured but verify failed: ${(err as Error).message}`,
        details: { host: process.env.SMTP_HOST },
      };
    }
  }

  return {
    status: "ok",
    message: "Resend API key configured",
    details: { resend: true },
  };
}

export async function buildInfrastructureReport(): Promise<InfrastructureReport> {
  const runMode = getRunMode();
  const jobsEnabled = shouldRunBackgroundJobs();
  const queueWorkersEnabled = shouldRunQueueWorkers();

  const mongoOk = mongoose.connection.readyState === 1;
  const redisPingOk = await pingRedis();

  const redisCheck: InfrastructureCheck =
    !redisEnabled
      ? {
          status: "missing",
          message:
            "Redis not configured — auth rate limits, cart sync, and jobs use in-memory fallbacks (single instance only)",
        }
    : !isRedisOperational()
      ? {
          status: "degraded",
          message:
            "Redis configured but unreachable — using in-memory fallbacks until reconnect succeeds",
        }
    : redisPingOk
      ? {
          status: "ok",
          message: "Redis connected",
        }
      : {
          status: "degraded",
          message: "Redis client up but ping failed",
        };

  const emailCheck: InfrastructureCheck = emailConfigured()
    ? {
        status: "ok",
        message: "Email provider configured",
        details: {
          smtp: smtpConfigured(),
          resend: Boolean(process.env.RESEND_API_KEY?.trim()),
        },
      }
    : {
        status: "missing",
        message:
          "Email not configured — abandoned cart, OTP, and order emails will fail",
      };

  const razorpayCheck: InfrastructureCheck = razorpayConfigured()
    ? { status: "ok", message: "Razorpay credentials configured" }
    : {
        status: "missing",
        message: "Razorpay not configured — online payments and recovery disabled",
      };

  const workerCheck: InfrastructureCheck =
    runMode === "worker" || runMode === "all"
      ? queueWorkersEnabled
        ? {
            status: "ok",
            message: "Worker process role with BullMQ workers enabled",
          }
        : {
            status: "degraded",
            message: "Worker role but QUEUE_WORKERS_ENABLED=false — emails/jobs may not process",
          }
      : jobsEnabled
        ? {
            status: "degraded",
            message:
              "API-only mode — run `npm run worker:dev` (or RUN_MODE=worker) for background jobs",
          }
        : {
            status: "disabled",
            message: "Background jobs disabled on this process",
          };

  const cartAbandonEnabled = envEnabled("CART_ABANDON_JOB_ENABLED");
  const cartAbandonCheck: InfrastructureCheck =
    !cartAbandonEnabled
      ? {
          status: "disabled",
          message: "Abandoned cart recovery disabled (CART_ABANDON_JOB_ENABLED=false)",
        }
    : !jobsEnabled
      ? {
          status: "degraded",
          message: "Abandoned cart job enabled but no worker process running jobs",
        }
    : !emailConfigured()
      ? {
          status: "degraded",
          message:
            "Abandoned cart job will enqueue emails but no SMTP/Resend configured",
        }
    : !redisPingOk && redisEnabled
      ? {
          status: "degraded",
          message:
            "Abandoned cart needs Redis + worker for reliable email delivery",
        }
      : {
          status: "ok",
          message: "Abandoned cart recovery ready",
          details: {
            inactiveMs: Number(
              process.env.CART_ABANDON_INACTIVE_MS || 2 * 60 * 60 * 1000,
            ),
            intervalMs: Number(
              process.env.CART_ABANDON_JOB_MS || 60 * 60 * 1000,
            ),
          },
        };

  const paymentRecoveryEnabled = envEnabled("PAYMENT_RECOVERY_ENABLED");
  const paymentRecoveryCheck: InfrastructureCheck =
    !paymentRecoveryEnabled
      ? {
          status: "disabled",
          message: "Payment recovery disabled (PAYMENT_RECOVERY_ENABLED=false)",
        }
    : !jobsEnabled
      ? {
          status: "degraded",
          message: "Payment recovery enabled but no worker process running jobs",
        }
    : !razorpayConfigured()
      ? {
          status: "missing",
          message: "Payment recovery requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET",
        }
    : {
          status: "ok",
          message: "Payment recovery job ready",
          details: {
            intervalMs: Number(
              process.env.PAYMENT_RECOVERY_MS || 30 * 60 * 1000,
            ),
          },
        };

  const criticalOk =
    mongoOk &&
    (!process.env.NODE_ENV ||
      process.env.NODE_ENV !== "production" ||
      redisPingOk);

  const ready =
    criticalOk &&
    (cartAbandonCheck.status === "ok" ||
      cartAbandonCheck.status === "disabled") &&
    (paymentRecoveryCheck.status === "ok" ||
      paymentRecoveryCheck.status === "disabled");

  return {
    timestamp: new Date().toISOString(),
    runMode,
    jobsEnabled,
    queueWorkersEnabled,
    ready,
    checks: {
      mongodb: mongoOk
        ? { status: "ok", message: "MongoDB connected" }
        : { status: "degraded", message: "MongoDB not connected" },
      redis: redisCheck,
      email: emailCheck,
      razorpay: razorpayCheck,
      workerProcess: workerCheck,
      abandonedCartRecovery: cartAbandonCheck,
      paymentRecovery: paymentRecoveryCheck,
    },
  };
}

export function logInfrastructureReport(report: InfrastructureReport): void {
  const lines = [
    `Infrastructure (${report.runMode}) — ready=${report.ready}`,
    `  MongoDB: ${report.checks.mongodb.status} — ${report.checks.mongodb.message}`,
    `  Redis: ${report.checks.redis.status} — ${report.checks.redis.message}`,
    `  Email: ${report.checks.email.status} — ${report.checks.email.message}`,
    `  Worker: ${report.checks.workerProcess.status} — ${report.checks.workerProcess.message}`,
    `  Abandoned cart: ${report.checks.abandonedCartRecovery.status} — ${report.checks.abandonedCartRecovery.message}`,
    `  Payment recovery: ${report.checks.paymentRecovery.status} — ${report.checks.paymentRecovery.message}`,
  ];
  logger.info(lines.join("\n"));
}

/** Worker startup — fail fast in production when critical infra is missing. */
export async function assertWorkerInfrastructure(): Promise<void> {
  await ensureRedisReady();
  const report = await buildInfrastructureReport();
  logInfrastructureReport(report);

  const isProd = process.env.NODE_ENV === "production";
  const failures: string[] = [];

  if (isProd && report.checks.redis.status !== "ok") {
    failures.push("Redis must be connected in production worker");
  }
  if (
    report.checks.abandonedCartRecovery.status === "degraded" &&
    report.checks.abandonedCartRecovery.message.includes("no SMTP")
  ) {
    failures.push("Abandoned cart recovery requires email (SMTP or Resend)");
  }
  if (
    report.checks.paymentRecovery.status === "missing" &&
    envEnabled("PAYMENT_RECOVERY_ENABLED")
  ) {
    failures.push("Payment recovery requires Razorpay credentials");
  }

  if (process.env.WORKER_VERIFY_EMAIL !== "false") {
    const emailVerify = await verifyEmailTransport();
    if (emailVerify.status === "degraded") {
      logger.warn(`Email transport verify: ${emailVerify.message}`);
    } else if (emailVerify.status === "missing" && isProd) {
      failures.push(emailVerify.message);
    }
  }

  if (failures.length) {
    throw new Error(`Worker infrastructure check failed:\n- ${failures.join("\n- ")}`);
  }
}
