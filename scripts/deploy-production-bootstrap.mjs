#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PRODUCTION_SOURCE_ROOT = "/opt/lumina-crm/source";
export const PRODUCTION_STATE_ROOT = "/var/lib/lumina-crm/deployments";
export const PRODUCTION_BRANCH = "main";
export const PRODUCTION_ALLOWED_ORIGINS = new Set([
  "git@github.com:kewtgh/crm.git",
  "https://github.com/kewtgh/crm.git",
]);

const REQUEST_MODES = new Set(["deploy", "initialize", "rollback", "recover"]);
const FULL_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const isEntrypoint = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

function atomicWrite(file, value) {
  const temporary = `${file}.next-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
  renameSync(temporary, file);
}

export function validateBootstrapRequest(request, sourceRoot = PRODUCTION_SOURCE_ROOT) {
  if (!/^[0-9a-f-]{36}$/i.test(request?.requestId ?? "")
    || !REQUEST_MODES.has(request?.mode)
    || path.resolve(request?.sourceRoot ?? "") !== sourceRoot) {
    throw new Error("Deployment request is invalid");
  }
  return request;
}

export function targetControllerArguments(targetCommit, bootstrapCommit) {
  if (!FULL_SHA.test(targetCommit) || !FULL_SHA.test(bootstrapCommit)) {
    throw new Error("Bootstrap commits must be full lowercase SHA values");
  }
  return [
    "--source-already-updated",
    `--expected-target=${targetCommit}`,
    `--bootstrap-source=${bootstrapCommit}`,
    `--bootstrap-pid=${process.pid}`,
  ];
}

function runGit(args, { environment = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: PRODUCTION_SOURCE_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-1024 * 1024); });
    child.stderr.on("data", () => {});
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error("BOOTSTRAP_GIT_COMMAND_FAILED"));
      else resolve(stdout.trim());
    });
  });
}

export async function updateSourceAndResolveTarget({
  git = runGit,
  environment = process.env,
  configuredProxy = "",
  expectedBranch = PRODUCTION_BRANCH,
  allowedOrigins = PRODUCTION_ALLOWED_ORIGINS,
} = {}) {
  const branch = await git(["branch", "--show-current"]);
  const origin = await git(["remote", "get-url", "origin"]);
  const cleanBefore = await git(["status", "--porcelain"]);
  const bootstrapCommit = await git(["rev-parse", "HEAD"]);
  if (branch !== expectedBranch || !allowedOrigins.has(origin) || cleanBefore
    || !FULL_SHA.test(bootstrapCommit)) {
    throw new Error("BOOTSTRAP_SOURCE_INVALID");
  }

  const fetchEnvironment = { ...environment };
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] ) {
    delete fetchEnvironment[key];
  }
  const proxy = String(configuredProxy).trim();
  if (proxy) {
    fetchEnvironment.HTTP_PROXY = proxy;
    fetchEnvironment.HTTPS_PROXY = proxy;
  }
  await git(["fetch", "--prune", "origin", expectedBranch], { environment: fetchEnvironment });
  const targetCommit = await git(["rev-parse", `origin/${expectedBranch}`]);
  if (!FULL_SHA.test(targetCommit)) throw new Error("BOOTSTRAP_TARGET_INVALID");
  await git(["merge", "--ff-only", targetCommit]);
  const [head, cleanAfter] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["status", "--porcelain"]),
  ]);
  if (head !== targetCommit || cleanAfter) throw new Error("BOOTSTRAP_SOURCE_CHANGED");
  return { bootstrapCommit, targetCommit };
}

export function validateTargetControllerAsset(sourceRoot, targetCommit) {
  const packagePath = path.join(sourceRoot, "package.json");
  const runnerPath = path.join(sourceRoot, "scripts", "deploy-production-runner.mjs");
  if (!existsSync(packagePath) || !existsSync(runnerPath)) {
    throw new Error("TARGET_CONTROLLER_ASSET_MISSING");
  }
  const metadata = lstatSync(runnerPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(runnerPath) !== runnerPath) {
    throw new Error("TARGET_CONTROLLER_ASSET_INVALID");
  }
  const version = String(JSON.parse(readFileSync(packagePath, "utf8")).version ?? "");
  if (!VERSION.test(version) || !FULL_SHA.test(targetCommit)) {
    throw new Error("TARGET_CONTROLLER_VERSION_INVALID");
  }
  return { runnerPath, version };
}

export function spawnTargetController({
  runnerPath,
  targetCommit,
  bootstrapCommit,
  nodePath = "/usr/bin/node",
  environment = process.env,
  spawnProcess = spawn,
  sourceRoot = PRODUCTION_SOURCE_ROOT,
}) {
  return new Promise((resolve, reject) => {
    let started = false;
    const child = spawnProcess(
      nodePath,
      [runnerPath, ...targetControllerArguments(targetCommit, bootstrapCommit)],
      {
        cwd: sourceRoot,
        env: {
          ...environment,
          LUMINA_BOOTSTRAP_SOURCE_COMMIT: bootstrapCommit,
          LUMINA_TARGET_SOURCE_COMMIT: targetCommit,
        },
        stdio: "inherit",
      },
    );
    child.once("spawn", () => {
      started = true;
      process.stdout.write(`TARGET_CONTROLLER_PID=${child.pid}\n`);
    });
    child.once("error", (error) => reject(Object.assign(error, { targetControllerStarted: started })));
    child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal, pid: child.pid }));
  });
}

export async function runBootstrap({
  requestPath = path.join(PRODUCTION_STATE_ROOT, "request.json"),
  sourceRoot = PRODUCTION_SOURCE_ROOT,
  updateSource = updateSourceAndResolveTarget,
  spawnController = spawnTargetController,
} = {}) {
  const request = validateBootstrapRequest(JSON.parse(readFileSync(requestPath, "utf8")), sourceRoot);
  const { bootstrapCommit, targetCommit } = await updateSource({
    configuredProxy: process.env.LUMINA_GIT_PROXY,
  });
  process.stdout.write(`BOOTSTRAP_SOURCE_COMMIT=${bootstrapCommit}\n`);
  process.stdout.write(`TARGET_SOURCE_COMMIT=${targetCommit}\n`);
  const target = validateTargetControllerAsset(sourceRoot, targetCommit);
  process.stdout.write(`TARGET_APPLICATION_VERSION=${target.version}\n`);
  const latestPath = path.join(path.dirname(requestPath), "latest.json");
  let latestBefore = null;
  try { latestBefore = readFileSync(latestPath, "utf8"); } catch { /* No prior controller state. */ }
  const result = await spawnController({
    runnerPath: target.runnerPath,
    targetCommit,
    bootstrapCommit,
    sourceRoot,
  });
  if (result.code !== 0) {
    let latestAfter = null;
    try { latestAfter = readFileSync(latestPath, "utf8"); } catch { /* The controller did not persist state. */ }
    const latest = readJson(latestPath);
    if (latest?.requestId !== request.requestId || latestAfter === latestBefore) {
      persistBootstrapFailure(
        Object.assign(new Error("TARGET_CONTROLLER_EXIT_FAILED"), { targetControllerStarted: true }),
        { requestPath },
      );
    }
  }
  return result.code;
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export function persistBootstrapFailure(error, {
  requestPath = path.join(PRODUCTION_STATE_ROOT, "request.json"),
} = {}) {
  const stateRoot = path.dirname(requestPath);
  let request = null;
  try { request = JSON.parse(readFileSync(requestPath, "utf8")); } catch { /* No valid request to identify. */ }
  const now = new Date().toISOString();
  const state = {
    deploymentId: null,
    requestId: request?.requestId ?? null,
    mode: request?.mode ?? null,
    result: "CONTROL_PLANE_FINALIZATION_FAILED",
    applicationResult: "NOT_STARTED",
    stage: "target-controller-start-failed",
    finalizationComplete: false,
    requestArchived: false,
    finishedAt: now,
    error: error?.targetControllerStarted ? "TARGET_CONTROLLER_EXIT_FAILED" : "TARGET_CONTROLLER_START_FAILED",
  };
  try {
    atomicWrite(path.join(stateRoot, "latest.json"), state);
    atomicWrite(path.join(stateRoot, `bootstrap-failure-${Date.now()}.json`), state);
  } catch { /* systemd still receives a non-zero exit code. */ }
}

async function main() {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
    throw new Error("Production deployment bootstrap must run as non-root lumina-crm on Linux");
  }
  if (path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") !== PRODUCTION_SOURCE_ROOT) {
    throw new Error(`Bootstrap must execute from ${PRODUCTION_SOURCE_ROOT}`);
  }
  const sourceMetadata = lstatSync(PRODUCTION_SOURCE_ROOT);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()
    || realpathSync(PRODUCTION_SOURCE_ROOT) !== PRODUCTION_SOURCE_ROOT) {
    throw new Error("BOOTSTRAP_SOURCE_ROOT_INVALID");
  }
  try {
    process.exitCode = await runBootstrap();
  } catch (error) {
    persistBootstrapFailure(error);
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (isEntrypoint) await main();
