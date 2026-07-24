import { spawn } from "node:child_process";
import { boundedSeconds, runBounded, stopProcessTree } from "./lib/bounded-process.mjs";

process.env.DO_NOT_TRACK = "1";
process.env.SUPABASE_TELEMETRY_DISABLED = "1";

const appUrl = (process.env.APP_URL ?? "http://localhost:3200").replace(/\/$/, "");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run this gate through npm run release:gate");

const totalSeconds = boundedSeconds(process.env.RELEASE_GATE_TOTAL_TIMEOUT_SECONDS, 900, "RELEASE_GATE_TOTAL_TIMEOUT_SECONDS");
const defaultIdleSeconds = boundedSeconds(process.env.RELEASE_GATE_IDLE_TIMEOUT_SECONDS, 90, "RELEASE_GATE_IDLE_TIMEOUT_SECONDS");
const gateStartedAt = Date.now();
const gateDeadline = gateStartedAt + totalSeconds * 1_000;

function remainingMilliseconds() {
  return Math.max(0, gateDeadline - Date.now());
}

async function stage(label, command, args, timeoutSeconds, idleSeconds = defaultIdleSeconds, env = process.env) {
  const remaining = remainingMilliseconds();
  if (remaining < 1_000) throw new Error(`Release gate exceeded its ${totalSeconds}s total limit before ${label}`);
  const timeoutMs = Math.min(timeoutSeconds * 1_000, remaining);
  process.stdout.write(
    `\n[release-gate] ${label}: limit=${Math.round(timeoutMs / 1_000)}s, `
    + `idle=${Math.min(idleSeconds * 1_000, timeoutMs) / 1_000}s, `
    + `gate remaining=${Math.round(remaining / 1_000)}s\n`,
  );
  await runBounded({
    command,
    args,
    label,
    timeoutMs,
    idleTimeoutMs: Math.min(idleSeconds * 1_000, timeoutMs),
    heartbeatMs: 15_000,
    env,
  });
}

const npmStage = (label, args, timeoutSeconds, idleSeconds, env) => stage(
  label,
  process.execPath,
  [npmCli, ...args],
  timeoutSeconds,
  idleSeconds,
  env,
);
const supabaseStage = (label, args, timeoutSeconds, idleSeconds) => npmStage(
  label,
  ["exec", "--", "supabase", ...args],
  timeoutSeconds,
  idleSeconds,
);

function assertServerRunning(server) {
  if (server.exitCode !== null) {
    throw new Error(`Application server exited before smoke tests (code ${server.exitCode})`);
  }
}

async function waitForApp(server) {
  const deadline = Math.min(Date.now() + 90_000, gateDeadline);
  while (Date.now() < deadline) {
    assertServerRunning(server);
    try {
      const response = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        assertServerRunning(server);
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Application did not become healthy at ${appUrl} within 90s`);
}

process.stdout.write(
  `[release-gate] bounded execution enabled: total=${totalSeconds}s, `
  + `default idle=${defaultIdleSeconds}s\n`,
);

await npmStage("typecheck", ["run", "typecheck:raw"], 120, 60);
await npmStage("lint", ["run", "lint:raw"], 180, 90);
await npmStage("production build and Node contracts", ["run", "test:raw"], 360, 120);
await npmStage("dependency audit", ["audit", "--audit-level=moderate"], 120, 60);
await supabaseStage("Supabase schema lint", ["db", "lint", "--local", "--level", "warning"], 120, 60);
await supabaseStage("pgTAP database suite", ["test", "db", "--local"], 300, 120);
await npmStage("phase 2 business smoke", ["run", "smoke:phase2:raw"], 180, 90);
await npmStage("v0.9 business smoke", ["run", "smoke:v09:raw"], 180, 90);

const server = spawn(process.execPath, [npmCli, "run", "start", "--", "--port", "3200"], {
  env: { ...process.env, APP_URL: appUrl },
  stdio: "inherit",
  detached: process.platform !== "win32",
  windowsHide: true,
});
try {
  await waitForApp(server);
  await npmStage("production asset QA", ["run", "qa:assets:raw"], 90, 45);
  await npmStage("HTTP v0.9 smoke", ["run", "smoke:http-v09:raw"], 120, 60);
  assertServerRunning(server);
  await npmStage("HTTP v1.0 smoke", ["run", "smoke:http-v10:raw"], 120, 60);
  assertServerRunning(server);
  await npmStage("v1.1 business smoke", ["run", "smoke:v11:raw"], 180, 90);
  await npmStage("export artifact smoke", ["run", "smoke:exports:raw"], 180, 90);
  await npmStage(
    "real device authentication smoke",
    ["run", "smoke:auth-device:raw"],
    240,
    90,
    { ...process.env, AUTH_SMOKE_BASE_URL: appUrl },
  );
  assertServerRunning(server);
  await npmStage("staged Chromium 1228 UI QA", ["run", "qa:chromium-1228:staged"], 480, 45);
} finally {
  stopProcessTree(server);
}

process.stdout.write(
  `\nRelease gate passed in ${Math.round((Date.now() - gateStartedAt) / 1_000)}s: `
  + "types, lint, build, dependency audit, Node, pgTAP, schema lint, smokes, "
  + "production assets, and ms-playwright/chromium-1228 UI QA.\n",
);
