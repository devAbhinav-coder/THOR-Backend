/**
 * Process role: api (HTTP only), worker (background jobs), all (monolith dev).
 *
 * Production default: api (jobs run in separate worker process).
 * Set RUN_MODE=worker on worker pods, RUN_MODE=all only for single-node dev.
 */
export type RunMode = "api" | "worker" | "all";

export function getRunMode(): RunMode {
  const explicit = (process.env.RUN_MODE || "").toLowerCase().trim();
  if (explicit === "api" || explicit === "worker" || explicit === "all") {
    return explicit;
  }
  if (process.env.NODE_ENV === "production") {
    return "api";
  }
  // Dev default: API-only so storefront SSR stays fast. Use RUN_MODE=all or a worker
  // process when testing cron jobs locally.
  return "api";
}

/** Background schedulers, pollers, and maintenance jobs. */
export function shouldRunBackgroundJobs(): boolean {
  if (process.env.JOBS_ENABLED === "false") return false;
  const mode = getRunMode();
  return mode === "all" || mode === "worker";
}

/** Express HTTP server (storefront + admin API). */
export function shouldRunHttpServer(): boolean {
  const mode = getRunMode();
  return mode === "all" || mode === "api";
}

/** BullMQ workers (email, push, order, image). */
export function shouldRunQueueWorkers(): boolean {
  if (process.env.QUEUE_WORKERS_ENABLED === "false") return false;
  const mode = getRunMode();
  // Local API dev should stay HTTP-only; run workers via npm run worker:dev.
  if (process.env.NODE_ENV !== "production" && mode === "api") return false;
  return mode === "all" || mode === "worker";
}
