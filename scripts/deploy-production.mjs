#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const help = process.argv.includes("--help") || process.argv.includes("-h");

if (help) {
  process.stdout.write(`Lumina CRM bounded production deployment

Usage:
  npm run deploy:production

Required server layout:
  Linux, Node.js 24, systemd, a clean Git checkout, production environment loaded,
  and an already linked production Supabase project.

Default hard limits:
  total 900s; git 60s; install/build 240s each; checks/migration 180s each;
  systemd 60s; liveness 60s; readiness 120s.

Configuration:
  DEPLOY_ROOT=/opt/lumina-crm
  DEPLOY_BRANCH=main
  DEPLOY_REMOTE=origin
  DEPLOY_WEB_SERVICE=lumina-crm.service
  DEPLOY_WORKER_SERVICE=lumina-crm-workers.service
  DEPLOY_WORKER_TIMER=lumina-crm-workers.timer
  DEPLOY_HEALTH_URL=http://127.0.0.1:3200/api/health
  DEPLOY_TOTAL_TIMEOUT_SECONDS=900
  DEPLOY_*_TIMEOUT_SECONDS (PULL, INSTALL, CHECK, BUILD, MIGRATION, SYSTEMD,
                            LIVENESS, READINESS)

Every duration is bounded to 1–3600 seconds. A timeout terminates the child
process tree, identifies the failed stage, exits non-zero, and never switches
an unverified release into service.
`);
  process.exit(0);
}

if (process.platform !== "linux") {
  throw new Error("Production deployment is supported only on the documented Linux + systemd target");
}

function seconds(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3600) {
    throw new Error(`${name} must be an integer between 1 and 3600 seconds`);
  }
  return value;
}

const limits = {
  total: seconds("DEPLOY_TOTAL_TIMEOUT_SECONDS", 900),
  pull: seconds("DEPLOY_PULL_TIMEOUT_SECONDS", 60),
  install: seconds("DEPLOY_INSTALL_TIMEOUT_SECONDS", 240),
  check: seconds("DEPLOY_CHECK_TIMEOUT_SECONDS", 180),
  build: seconds("DEPLOY_BUILD_TIMEOUT_SECONDS", 240),
  migration: seconds("DEPLOY_MIGRATION_TIMEOUT_SECONDS", 180),
  systemd: seconds("DEPLOY_SYSTEMD_TIMEOUT_SECONDS", 60),
  liveness: seconds("DEPLOY_LIVENESS_TIMEOUT_SECONDS", 60),
  readiness: seconds("DEPLOY_READINESS_TIMEOUT_SECONDS", 120),
};
const startedAt = Date.now();
const deadline = startedAt + limits.total * 1000;
const deployRoot = path.resolve(process.env.DEPLOY_ROOT ?? "/opt/lumina-crm");
const releasesRoot = path.join(deployRoot, "releases");
const currentLink = path.join(deployRoot, "current");
const remote = process.env.DEPLOY_REMOTE ?? "origin";
const branch = process.env.DEPLOY_BRANCH ?? "main";
const webService = process.env.DEPLOY_WEB_SERVICE ?? "lumina-crm.service";
const workerService = process.env.DEPLOY_WORKER_SERVICE ?? "lumina-crm-workers.service";
const workerTimer = process.env.DEPLOY_WORKER_TIMER ?? "lumina-crm-workers.timer";
const healthUrl = (process.env.DEPLOY_HEALTH_URL ?? "http://127.0.0.1:3200/api/health").replace(/[?&]mode=ready$/, "");
const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error("npm_execpath is missing; invoke this script with npm run deploy:production");
if (!existsSync(path.join(sourceRoot, ".git"))) throw new Error(`Source checkout is not a Git repository: ${sourceRoot}`);
if (!path.isAbsolute(deployRoot) || deployRoot === path.parse(deployRoot).root) throw new Error("DEPLOY_ROOT must be a specific absolute directory");

let activeChild;
let releaseDir;
let previousRelease;
let switched = false;

function remainingMs() {
  return deadline - Date.now();
}

function terminate(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  const force = setTimeout(() => {
    if (child.exitCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  }, 5_000);
  force.unref();
}

function run(label, command, args, { cwd = sourceRoot, timeoutSeconds, capture = false } = {}) {
  const budget = Math.min((timeoutSeconds ?? limits.check) * 1000, remainingMs());
  if (budget <= 0) return Promise.reject(new Error(`Total deployment limit (${limits.total}s) expired before ${label}`));
  process.stdout.write(`\n[deploy] ${label} (limit ${Math.ceil(budget / 1000)}s)\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NODE_ENV: "production", DO_NOT_TRACK: "1", SUPABASE_TELEMETRY_DISABLED: "1" },
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      detached: true,
    });
    activeChild = child;
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, budget);
    const finish = (error, result) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = undefined;
      if (error) reject(error);
      else resolve(result);
    };
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (timedOut) return finish(new Error(`${label} exceeded its ${Math.ceil(budget / 1000)}s hard limit`));
      if (code !== 0) return finish(new Error(`${label} failed (${signal ?? `exit ${code}`}): ${stderr.trim().slice(0, 500)}`));
      finish(undefined, { stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

const runNpm = (label, args, options) => run(label, process.execPath, [npmCli, ...args], options);
const runSupabase = (label, args, options) => runNpm(label, ["exec", "--", "supabase", ...args], options);

async function waitForHealth(label, url, timeoutSeconds, expectedVersion) {
  const end = Math.min(deadline, Date.now() + timeoutSeconds * 1000);
  process.stdout.write(`\n[deploy] ${label} (limit ${Math.ceil((end - Date.now()) / 1000)}s)\n`);
  let last = "no response";
  while (Date.now() < end) {
    try {
      const requestLimit = Math.max(1, Math.min(5_000, end - Date.now()));
      const response = await fetch(url, { signal: AbortSignal.timeout(requestLimit), headers: { accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      last = `HTTP ${response.status}`;
      if (response.ok && body.version === expectedVersion) return;
      if (response.ok) last = `version ${String(body.version ?? "missing")} (expected ${expectedVersion})`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, Math.max(0, end - Date.now()))));
  }
  throw new Error(`${label} exceeded its ${timeoutSeconds}s hard limit (${last})`);
}

async function pointCurrent(target) {
  const temporary = `${currentLink}.next-${process.pid}`;
  rmSync(temporary, { force: true });
  symlinkSync(target, temporary, "dir");
  renameSync(temporary, currentLink);
}

async function rollback(cause) {
  if (!switched || !previousRelease) return;
  process.stderr.write(`\n[deploy] cutover failed; restoring ${previousRelease}\n`);
  await pointCurrent(previousRelease);
  await run("restart previous web release", "systemctl", ["restart", webService], { timeoutSeconds: limits.systemd });
  switched = false;
  process.stderr.write(`[deploy] rollback completed after: ${cause instanceof Error ? cause.message : String(cause)}\n`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    terminate(activeChild);
    process.stderr.write(`\n[deploy] interrupted by ${signal}; active child process was terminated\n`);
    process.exitCode = 130;
  });
}

try {
  const status = await run("verify clean production checkout", "git", ["status", "--porcelain", "--untracked-files=no"], { timeoutSeconds: limits.pull, capture: true });
  if (status.stdout) throw new Error("Production checkout has tracked changes; deployment refused");
  const currentBranch = await run("verify deployment branch", "git", ["branch", "--show-current"], { timeoutSeconds: limits.pull, capture: true });
  if (currentBranch.stdout !== branch) throw new Error(`Expected branch ${branch}, found ${currentBranch.stdout || "detached HEAD"}`);

  await run("fast-forward source", "git", ["pull", "--ff-only", remote, branch], { timeoutSeconds: limits.pull });
  const revision = (await run("resolve release revision", "git", ["rev-parse", "HEAD"], { timeoutSeconds: limits.pull, capture: true })).stdout;
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Could not resolve the pulled Git revision");

  mkdirSync(releasesRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  releaseDir = path.join(releasesRoot, `${stamp}-${revision.slice(0, 12)}`);
  await run("create immutable release worktree", "git", ["worktree", "add", "--detach", releaseDir, revision], { timeoutSeconds: limits.pull });

  await runNpm("install locked dependencies", ["ci", "--no-audit", "--no-fund"], { cwd: releaseDir, timeoutSeconds: limits.install });
  await runNpm("typecheck", ["run", "typecheck"], { cwd: releaseDir, timeoutSeconds: limits.check });
  await runNpm("lint", ["run", "lint"], { cwd: releaseDir, timeoutSeconds: limits.check });
  await run("Node contracts", process.execPath, ["--test", "--test-isolation=none", "tests/rendered-html.test.mjs"], { cwd: releaseDir, timeoutSeconds: limits.check });
  await runNpm("dependency audit", ["audit", "--audit-level=moderate"], { cwd: releaseDir, timeoutSeconds: limits.check });
  await runNpm("production build", ["run", "build"], { cwd: releaseDir, timeoutSeconds: limits.build });
  await runSupabase("production database migration", ["db", "push", "--linked"], { cwd: sourceRoot, timeoutSeconds: limits.migration });
  await runSupabase("production schema lint", ["db", "lint", "--linked", "--level", "warning"], { cwd: sourceRoot, timeoutSeconds: limits.migration });

  const releasePackage = JSON.parse(readFileSync(path.join(releaseDir, "package.json"), "utf8"));
  if (existsSync(currentLink)) {
    const currentStat = lstatSync(currentLink);
    if (!currentStat.isSymbolicLink()) throw new Error(`${currentLink} exists but is not a symbolic link; cutover refused`);
    previousRelease = realpathSync(currentLink);
  }
  await pointCurrent(releaseDir);
  switched = true;

  await run("reload systemd units", "systemctl", ["daemon-reload"], { timeoutSeconds: limits.systemd });
  await run("restart web service", "systemctl", ["restart", webService], { timeoutSeconds: limits.systemd });
  await run("enable worker timer", "systemctl", ["enable", "--now", workerTimer], { timeoutSeconds: limits.systemd });
  await run("run bounded worker cycle", "systemctl", ["start", workerService], { timeoutSeconds: limits.systemd });
  await waitForHealth("liveness check", healthUrl, limits.liveness, releasePackage.version);
  const readyUrl = `${healthUrl}${healthUrl.includes("?") ? "&" : "?"}mode=ready`;
  await waitForHealth("readiness check", readyUrl, limits.readiness, releasePackage.version);

  switched = false;
  process.stdout.write(`\n[deploy] SUCCESS v${releasePackage.version} ${revision.slice(0, 12)} in ${Math.ceil((Date.now() - startedAt) / 1000)}s\n`);
  process.stdout.write(`[deploy] release: ${releaseDir}\n[deploy] health: ${readyUrl}\n`);
} catch (error) {
  try { await rollback(error); } catch (rollbackError) {
    process.stderr.write(`[deploy] ROLLBACK FAILED: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}\n`);
  }
  if (releaseDir && !switched && (!existsSync(currentLink) || realpathSync(currentLink) !== releaseDir)) {
    await run("remove failed release worktree", "git", ["worktree", "remove", "--force", releaseDir], { timeoutSeconds: limits.pull }).catch(() => undefined);
  }
  process.stderr.write(`\n[deploy] FAILED after ${Math.ceil((Date.now() - startedAt) / 1000)}s: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
