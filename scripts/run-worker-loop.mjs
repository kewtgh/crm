import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const intervalSeconds = Number(process.env.WORKER_LOOP_INTERVAL_SECONDS ?? 300);
if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 3600) {
  throw new Error("WORKER_LOOP_INTERVAL_SECONDS_MUST_BE_60_TO_3600");
}

const cycleScript = fileURLToPath(new URL("./process-worker-cycle.mjs", import.meta.url));
const schemaScript = fileURLToPath(new URL("./worker-schema-check.mjs", import.meta.url));
let stopping = false;
let activeChild;
let wake;

function stop() {
  stopping = true;
  activeChild?.kill("SIGTERM");
  wake?.();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

function runScript(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: process.env,
      stdio: "inherit",
    });
    activeChild = child;
    const deadline = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(deadline);
      activeChild = undefined;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(deadline);
      activeChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(`WORKER_CYCLE_EXITED_${code ?? signal ?? "UNKNOWN"}`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  }).finally(() => {
    wake = undefined;
  });
}

while (!stopping) {
  const startedAt = Date.now();
  try {
    await runScript(schemaScript, 30_000);
    await runScript(cycleScript, 240_000);
    process.stdout.write(`[worker-loop] cycle completed in ${Date.now() - startedAt}ms\n`);
  } catch (error) {
    process.stderr.write(
      `[worker-loop] cycle failed: ${String(error instanceof Error ? error.message : error).slice(0, 300)}\n`,
    );
  }
  if (!stopping) await delay(intervalSeconds * 1_000);
}
