/**
 * OpenTelemetry full configuration
 * ─────────────────────────────────
 * Traces  → OTLP/HTTP  (default: http://localhost:4318/v1/traces)
 * Metrics → OTLP/HTTP  (default: http://localhost:4318/v1/metrics)
 *
 * Environment variables (all optional — safe to omit):
 *   OTEL_ENABLED              = true | false          (default: true when OTEL_EXPORTER_OTLP_ENDPOINT set, else false)
 *   OTEL_SERVICE_NAME         = house-of-rani-backend (default)
 *   OTEL_EXPORTER_OTLP_ENDPOINT = http://localhost:4318 (OTLP HTTP base)
 *   OTEL_TRACES_ENDPOINT      override traces endpoint (falls back to OTEL_EXPORTER_OTLP_ENDPOINT + /v1/traces)
 *   OTEL_METRICS_ENDPOINT     override metrics endpoint
 *   OTEL_TRACES_SAMPLE_RATE   = 1.0 (float 0–1, default 1.0 in dev / 0.2 in production)
 *   OTEL_METRICS_INTERVAL_MS  = 30000 (export interval for metrics, default 30 s)
 *   OTEL_LOG_LEVEL            = info | debug | warn | error (default: warn)
 *   OTEL_HEADERS              = key=value,key2=value2 (added to all OTLP requests — useful for tokens)
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";
import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";

// ─── Config helpers ──────────────────────────────────────────────────────────

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  return Object.fromEntries(
    raw
      .split(",")
      .map((pair) => {
        const index = pair.indexOf("=");
        if (index === -1) return ["", ""];
        return [pair.substring(0, index).trim(), pair.substring(index + 1).trim()];
      })
      .filter((kv): kv is [string, string] => kv[0].length > 0),
  );
}

function parseLogLevel(raw: string | undefined): DiagLogLevel {
  switch ((raw || "").toLowerCase()) {
    case "debug": return DiagLogLevel.DEBUG;
    case "info":  return DiagLogLevel.INFO;
    case "warn":  return DiagLogLevel.WARN;
    case "error": return DiagLogLevel.ERROR;
    case "none":  return DiagLogLevel.NONE;
    default:      return DiagLogLevel.WARN;
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

let sdk: NodeSDK | null = null;
let started = false;

// ─── isOtelEnabled ───────────────────────────────────────────────────────────

export function isOtelEnabled(): boolean {
  const explicit = process.env.OTEL_ENABLED?.trim().toLowerCase();
  if (explicit === "true")  return true;
  if (explicit === "false") return false;
  // Auto-enable if an OTLP endpoint is configured
  return !!(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    process.env.OTEL_TRACES_ENDPOINT?.trim()
  );
}

// ─── initOtel ────────────────────────────────────────────────────────────────

export function initOtel(): void {
  if (!isOtelEnabled()) {
    return;
  }
  if (started) return;
  started = true;

  // Diagnostic logging
  diag.setLogger(
    new DiagConsoleLogger(),
    parseLogLevel(process.env.OTEL_LOG_LEVEL),
  );

  const serviceName =
    process.env.OTEL_SERVICE_NAME?.trim() || "house-of-rani-backend";
  const serviceVersion = process.env.npm_package_version || "1.0.0";
  const environment = process.env.NODE_ENV || "development";

  const baseEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim().replace(/\/$/, "") ||
    "http://localhost:4318";

  const tracesEndpoint =
    process.env.OTEL_TRACES_ENDPOINT?.trim() || `${baseEndpoint}/v1/traces`;
  const metricsEndpoint =
    process.env.OTEL_METRICS_ENDPOINT?.trim() || `${baseEndpoint}/v1/metrics`;

  const headers = parseHeaders(process.env.OTEL_HEADERS);

  const rawSampleRate = parseFloat(
    process.env.OTEL_TRACES_SAMPLE_RATE ||
      (environment === "production" ? "0.2" : "1.0"),
  );
  const sampleRate = Math.min(1, Math.max(0, isNaN(rawSampleRate) ? 1 : rawSampleRate));

  const metricsIntervalMs = parseInt(
    process.env.OTEL_METRICS_INTERVAL_MS || "30000",
    10,
  );

  // ── Resource attributes ──────────────────────────────────────────────────
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment,
    "host.name": process.env.HOSTNAME || require("os").hostname(),
    "process.pid": process.pid,
    "process.runtime.name": "nodejs",
    "process.runtime.version": process.version,
  });

  // ── Trace exporter ───────────────────────────────────────────────────────
  const traceExporter = new OTLPTraceExporter({
    url: tracesEndpoint,
    headers,
  });

  // ── Metrics exporter + reader ────────────────────────────────────────────
  const metricExporter = new OTLPMetricExporter({
    url: metricsEndpoint,
    headers,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: metricsIntervalMs,
  });

  // ── Sampler ──────────────────────────────────────────────────────────────
  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(sampleRate),
  });

  // ── Auto-instrumentations ────────────────────────────────────────────────
  const instrumentations = getNodeAutoInstrumentations({
    // HTTP / Express – trace all inbound requests
    "@opentelemetry/instrumentation-http": {
      enabled: true,
      // Don't trace health checks – avoid noise
      ignoreIncomingRequestHook: (req) =>
        req.url === "/api/health" || req.url === "/api/docs" || (req.url?.startsWith("/api/docs/") ?? false),
    },
    "@opentelemetry/instrumentation-express": { enabled: true },

    // Database & cache
    "@opentelemetry/instrumentation-mongoose": { enabled: true },
    "@opentelemetry/instrumentation-ioredis": { enabled: true },

    // Outbound HTTP calls (nodemailer, razorpay, cloudinary, etc.)
    "@opentelemetry/instrumentation-undici": { enabled: true },

    // Disable noisy / irrelevant ones
    "@opentelemetry/instrumentation-fs": { enabled: false },
    "@opentelemetry/instrumentation-dns": { enabled: false },
    "@opentelemetry/instrumentation-net": { enabled: false },
  });

  // ── Build & start SDK ────────────────────────────────────────────────────
  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    sampler,
    instrumentations,
  });

  sdk.start();

  console.log(
    `[OTel] Started — service="${serviceName}" env="${environment}" ` +
    `traces="${tracesEndpoint}" metrics="${metricsEndpoint}" sampleRate=${sampleRate}`,
  );
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

export async function shutdownOtel(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
    console.log("[OTel] SDK shut down cleanly.");
  } catch (err) {
    console.error("[OTel] Error during shutdown:", (err as Error).message);
  }
}
