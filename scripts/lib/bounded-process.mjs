import { spawn, spawnSync } from "node:child_process";

const MAX_TIMEOUT_SECONDS = 3_600;

export function boundedSeconds(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_SECONDS) {
    throw new Error(`${name} must be between 1 and ${MAX_TIMEOUT_SECONDS} seconds`);
  }
  return parsed;
}

export function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function formatDuration(milliseconds) {
  return `${Math.max(0, Math.round(milliseconds / 1_000))}s`;
}

export function runBounded({
  command,
  args = [],
  label = command,
  timeoutMs,
  idleTimeoutMs,
  heartbeatMs = 15_000,
  env = process.env,
  cwd = process.cwd(),
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error(`${label}: timeoutMs must be positive`);
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 1) throw new Error(`${label}: idleTimeoutMs must be positive`);
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let lastOutputAt = startedAt;
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["inherit", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    const relay = (stream, target) => {
      stream?.on("data", (chunk) => {
        lastOutputAt = Date.now();
        target.write(chunk);
      });
    };
    relay(child.stdout, process.stdout);
    relay(child.stderr, process.stderr);

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      clearInterval(heartbeat);
      if (error) reject(error);
      else resolve(value);
    };
    const terminate = (reason) => {
      if (settled) return;
      stopProcessTree(child);
      finish(new Error(
        `${label} ${reason} after ${formatDuration(Date.now() - startedAt)} `
        + `(last child output ${formatDuration(Date.now() - lastOutputAt)} ago)`,
      ));
    };

    const watchdog = setInterval(() => {
      const now = Date.now();
      if (now - startedAt >= timeoutMs) terminate(`exceeded its ${formatDuration(timeoutMs)} total limit`);
      else if (now - lastOutputAt >= idleTimeoutMs) terminate(`produced no output for ${formatDuration(idleTimeoutMs)}`);
    }, 500);
    watchdog.unref();

    const heartbeat = setInterval(() => {
      const now = Date.now();
      process.stdout.write(
        `[watchdog] ${label}: running ${formatDuration(now - startedAt)}, `
        + `last child output ${formatDuration(now - lastOutputAt)} ago\n`,
      );
    }, heartbeatMs);
    heartbeat.unref();

    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) finish(undefined, { code, elapsedMs: Date.now() - startedAt });
      else finish(new Error(
        `${label} exited with ${code ?? `signal ${signal ?? "unknown"}`} `
        + `after ${formatDuration(Date.now() - startedAt)}`,
      ));
    });
  });
}
