/**
 * instrumentation/register.ts
 * ─────────────────────────────
 * This file is imported as the very FIRST thing in src/index.ts so that
 * OpenTelemetry monkey-patching happens before any other require/import.
 *
 * Order matters:
 *   1. OTel SDK must start before Express / Mongoose / ioredis are required
 *   2. Sentry runs after OTel so it can attach to OTel traces if both are active
 *   3. Env validation last (it logs, which requires both to be ready)
 */

import { initOtel } from "./otel";
import { initSentry } from "./sentryInit";
import { assertRequiredEnv } from "../config/env";

// ── 1. OpenTelemetry (traces + metrics) ──────────────────────────────────────
initOtel();

// ── 2. Sentry (error tracking, optionally bridged to OTel) ───────────────────
initSentry();

// ── 3. Required env vars ──────────────────────────────────────────────────────
assertRequiredEnv();
