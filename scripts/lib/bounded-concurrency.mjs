export const DEFAULT_WORKER_JOB_CONCURRENCY = 4;
export const MAX_WORKER_JOB_CONCURRENCY = 8;

export function boundedWorkerInteger(value, {
  name,
  defaultValue,
  maximum,
  minimum = 1,
}) {
  const candidate = value === undefined || value === null || String(value).trim() === ""
    ? defaultValue
    : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${name}_MUST_BE_BETWEEN_${minimum}_AND_${maximum}`);
  }
  return candidate;
}

export function workerJobConcurrency(environment = process.env) {
  return boundedWorkerInteger(environment.WORKER_JOB_CONCURRENCY, {
    name: "WORKER_JOB_CONCURRENCY",
    defaultValue: DEFAULT_WORKER_JOB_CONCURRENCY,
    maximum: MAX_WORKER_JOB_CONCURRENCY,
  });
}

export async function mapWithConcurrency(items, concurrency, operation) {
  if (!Array.isArray(items)) throw new TypeError("CONCURRENT_ITEMS_MUST_BE_AN_ARRAY");
  if (typeof operation !== "function") throw new TypeError("CONCURRENT_OPERATION_REQUIRED");
  const limit = boundedWorkerInteger(concurrency, {
    name: "CONCURRENCY",
    defaultValue: DEFAULT_WORKER_JOB_CONCURRENCY,
    maximum: MAX_WORKER_JOB_CONCURRENCY,
  });
  if (!items.length) return [];

  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index], index);
    }
  });
  const settled = await Promise.allSettled(runners);
  const failure = settled.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results;
}
