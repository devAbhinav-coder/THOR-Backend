import "dotenv/config";

/** Worker entry always runs jobs — override .env RUN_MODE=api from the API terminal. */
process.env.RUN_MODE = "worker";
process.env.QUEUE_WORKERS_ENABLED = "true";

import "./instrumentation/register";
import { assertRequiredEnv } from "./config/env";
import logger from "./types/utils/logger";
import {
  bootstrapWorkerProcess,
  shutdownWorkerProcess,
} from "./jobs/jobBootstrap";

assertRequiredEnv();

void bootstrapWorkerProcess().catch((err: Error) => {
  logger.error(`Worker bootstrap failed: ${err.message}`);
  process.exit(1);
});

process.on("SIGTERM", () => void shutdownWorkerProcess("SIGTERM"));
process.on("SIGINT", () => void shutdownWorkerProcess("SIGINT"));

process.on("unhandledRejection", (err: Error) => {
  logger.error(`Worker unhandled rejection: ${err.message}`);
  process.exit(1);
});
