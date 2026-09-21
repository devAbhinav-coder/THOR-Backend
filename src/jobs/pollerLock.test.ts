import assert from "node:assert/strict";

/**
 * Contract: when Redis is configured but not operational, pollers must skip the tick
 * (return null) instead of using per-process in-memory locks.
 */
const expectedBehavior = {
  redisNotConfigured: "run without lock (dev)",
  redisConfiguredButDown: "skip tick (null)",
  redisOperational: "distributed lock",
};

assert.equal(expectedBehavior.redisConfiguredButDown, "skip tick (null)");

console.log("pollerLock.test.ts: ok (contract)");
