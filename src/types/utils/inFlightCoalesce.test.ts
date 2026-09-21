import assert from "node:assert/strict";
import {
  coalesceInFlight,
  resetInFlightCoalesceForTests,
} from "./inFlightCoalesce";

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

resetInFlightCoalesceForTests();

let fetchCount = 0;

async function runCoalesceTest(): Promise<void> {
  fetchCount = 0;
  resetInFlightCoalesceForTests();

  const results = await Promise.all(
    Array.from({ length: 100 }, () =>
      coalesceInFlight("test-key", async () => {
        fetchCount += 1;
        await sleep(20);
        return fetchCount;
      }),
    ),
  );

  assert.equal(fetchCount, 1, "fetchFresh should run exactly once");
  assert.ok(results.every((r) => r === 1), "all callers get same result");
}

void (async () => {
  await runCoalesceTest();
  await runCoalesceTest();
  console.log("inFlightCoalesce.test.ts: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
