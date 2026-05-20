/** Max server-side wait for inventory read aggregates (ms). */
export const INVENTORY_QUERY_MAX_MS = Number(process.env.INVENTORY_QUERY_MAX_MS || 15_000);

/** Max server-side wait for inventory summary cache rebuild (ms). */
export const INVENTORY_SUMMARY_AGG_MAX_MS = Number(process.env.INVENTORY_SUMMARY_AGG_MAX_MS || 20_000);
