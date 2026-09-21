import assert from "node:assert/strict";
import { cachedFetch } from "./cachedFetch";
import { deleteCache } from "../cacheService";
import { resetInFlightCoalesceForTests } from "../../types/utils/inFlightCoalesce";

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

const TEST_KEY = "test:cachedFetch:coalesce";

async function runParallelCoalesceTest(): Promise<void> {
  await deleteCache(TEST_KEY);
  resetInFlightCoalesceForTests();

  let fetchCount = 0;

  const results = await Promise.all(
    Array.from({ length: 100 }, () =>
      cachedFetch({
        key: TEST_KEY,
        softTtlSec: 60,
        hardTtlSec: 180,
        distributedLock: false,
        fetchFresh: async () => {
          fetchCount += 1;
          await sleep(25);
          return { value: 42 };
        },
      }),
    ),
  );

  assert.equal(fetchCount, 1, "cachedFetch fetchFresh should run once under coalescing");
  assert.ok(
    results.every((r) => r.value === 42),
    "all parallel callers receive the same payload",
  );
}

async function runStaleWhileRevalidateTest(): Promise<void> {
  const swrKey = "test:cachedFetch:swr";
  await deleteCache(swrKey);
  resetInFlightCoalesceForTests();

  let fetchCount = 0;

  const first = await cachedFetch({
    key: swrKey,
    softTtlSec: 0,
    hardTtlSec: 120,
    distributedLock: false,
    fetchFresh: async () => {
      fetchCount += 1;
      return { pass: fetchCount };
    },
  });

  assert.equal(first.pass, 1);

  await sleep(10);

  const second = await cachedFetch({
    key: swrKey,
    softTtlSec: 0,
    hardTtlSec: 120,
    distributedLock: false,
    fetchFresh: async () => {
      fetchCount += 1;
      await sleep(50);
      return { pass: fetchCount };
    },
  });

  assert.equal(second.pass, 1, "SWR should return stale value immediately");
  await sleep(80);
  assert.ok(fetchCount >= 1, "background refresh may run after stale serve");
}

void (async () => {
  await runParallelCoalesceTest();
  await runStaleWhileRevalidateTest();
  console.log("cachedFetch.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
