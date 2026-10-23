#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assertDeploymentRuntime } from "./lib/deployment-runtime.mjs";
import { classifyGitFailure, fetchWithRetry } from "./lib/deployment-git.mjs";
import { assertEarlyRequestRecoverable, assertPendingAcceptance } from "./lib/deployment-recovery.mjs";
import { durableDeploymentWrite } from "./lib/deployment-state-write.mjs";
import {readStaticHostTarget,assertHostPreflight} from "./lib/host-preflight.mjs";
import {controllerEntryIdentity,controllerEntryPath,validateEarlyRejection} from "./lib/controller-entry.mjs";
import {sha256} from "../deploy/libexec/lumina-host-contract.mjs";
import {hostLocksHeld} from "../deploy/libexec/lumina-host-upgrade.mjs";
import {HOST_PATHS} from "../deploy/libexec/lumina-host-contract.mjs";

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
  durableDeploymentWrite(file, `${JSON.stringify(value, null, 2)}\n`);
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

function runGit(args, { environment = process.env, timeoutMs = 20_000, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: PRODUCTION_SOURCE_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-1024 * 1024); });
    child.stderr.on("data", chunk => { stderr = `${stderr}${chunk}`.slice(-65_536); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(Object.assign(new Error("BOOTSTRAP_GIT_COMMAND_FAILED"),
        { stderr: timedOut ? "connection timed out" : stderr }));
      else resolve(raw ? stdout : stdout.trim());
    });
  });
}

export async function updateSourceAndResolveTarget({
  git = runGit,
  environment = process.env,
  configuredProxy = "",
  expectedBranch = PRODUCTION_BRANCH,
  allowedOrigins = PRODUCTION_ALLOWED_ORIGINS,
  stage = () => {},
  attempts = Number(process.env.LUMINA_GIT_FETCH_ATTEMPTS ?? 3),
  delay,
  expectedTarget = null,
  requestedTarget = null,
  planOnly = false,
  verifyTarget = async (commit,reader) => assertHostPreflight({target:await readStaticHostTarget(reader,commit),executionLockHeld:!planOnly}),
} = {}) {
  stage("source-validation");
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
  if (expectedTarget) {
    if (bootstrapCommit !== expectedTarget) throw new Error("BOOTSTRAP_SOURCE_INVALID");
    await verifyTarget(expectedTarget,git);
    return { bootstrapCommit, targetCommit: expectedTarget };
  }
  if(requestedTarget){if(!FULL_SHA.test(requestedTarget)||await git(["cat-file","-t",requestedTarget])!=="commit")throw new Error("BOOTSTRAP_TARGET_INVALID");}
  else{stage("git-fetch");
   await fetchWithRetry(options => git(["fetch", "--prune", "origin", expectedBranch],
    { ...options, environment: fetchEnvironment }), { attempts, delay, proxy: Boolean(proxy) });}
  const targetCommit = requestedTarget ?? await git(["rev-parse", `origin/${expectedBranch}`]);
  if (!FULL_SHA.test(targetCommit)) throw new Error("BOOTSTRAP_TARGET_INVALID");
  if(requestedTarget)await git(["merge-base","--is-ancestor",requestedTarget,`origin/${expectedBranch}`]);
  stage("host-preflight");
  await verifyTarget(targetCommit,git);
  if(planOnly)return {bootstrapCommit,targetCommit};
  stage("fast-forward");
  try { await git(["merge", "--ff-only", targetCommit]); }
  catch (error) { throw classifyGitFailure(error, { operation: "fast-forward" }); }
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
  nodePath = process.execPath,
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
  const latestPath = path.join(path.dirname(requestPath), "latest.json");
  const prior = readJson(latestPath);
  const resuming = request.resumePublicAcceptance === true;
  if (resuming) assertPendingAcceptance({ request, latest: prior });
  else if (prior?.requestId === request.requestId) assertEarlyRequestRecoverable({ request, latest: prior, mode: request.mode });
  const attempts = prior?.requestId === request.requestId ? [...(prior.attempts ?? prior.bootstrapAttempts ?? [])] : [];
  const attempt = { attemptId: randomUUID(), startedAt: new Date().toISOString(), controllerStarted: false, stage: "source-validation" };
  attempts.push(attempt);
  let currentStage = "source-validation";
  let controllerStarted = false;
  let sourceEvidence = {};
  let handoffEvidence = {};
  const record = (result, error = null) => ({ requestId: request.requestId, mode: request.mode,
    launchId: request.launchId, deploymentId: null, result, applicationResult: "NOT_STARTED",
    stage: currentStage, error, controllerStarted, attempts, migrationState: "NOT_STARTED",
    migrationMayHaveChanged: false, webSwitch: "NOT_STARTED", workerSwitch: "NOT_STARTED",
    applicationAccepted: false, finalizationComplete: false, requestArchived: false,
    ...sourceEvidence,
    ...handoffEvidence,
    recoverySafe: ["BOOTSTRAP_FAILED", "BOOTSTRAP_RUNNING"].includes(result) && !controllerStarted
      && ["source-validation", "git-fetch", "target-asset"].includes(currentStage) });
  const save = value => {
    // A pending candidate is authoritative; never replace it with bootstrap-only state.
      try {
        atomicWrite(path.join(path.dirname(requestPath), `bootstrap-${request.requestId}-${attempt.attemptId}.json`), value);
        if (!resuming) atomicWrite(latestPath, value);
      } catch {
        const failure = { ...value, result: "CONTROL_PLANE_FINALIZATION_FAILED", recoverySafe: false,
          stage: "bootstrap-state-persistence-failed", error: "CONTROL_PLANE_FINALIZATION_FAILED" };
        try { if (!resuming) atomicWrite(latestPath, failure); } catch { /* Emit a stable failure even when storage is unavailable. */ }
        throw Object.assign(new Error("CONTROL_PLANE_FINALIZATION_FAILED"),
          { code: "CONTROL_PLANE_FINALIZATION_FAILED", bootstrapRecorded: true });
      }
  };
  try {
  process.stdout.write(`${Object.entries(assertDeploymentRuntime()).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
  const { bootstrapCommit, targetCommit } = await updateSource({
    configuredProxy: process.env.LUMINA_GIT_PROXY,
    expectedTarget: resuming ? prior.targetCommit : null,
    requestedTarget: request.targetCommit??null,
    stage: value => { currentStage = value; attempt.stage = value; },
  });
  sourceEvidence = { bootstrapCommit, targetCommit };
  process.stdout.write(`BOOTSTRAP_SOURCE_COMMIT=${bootstrapCommit}\n`);
  process.stdout.write(`TARGET_SOURCE_COMMIT=${targetCommit}\n`);
  currentStage = "target-asset";
  const target = validateTargetControllerAsset(sourceRoot, targetCommit);
  process.stdout.write(`TARGET_APPLICATION_VERSION=${target.version}\n`);
  let latestBefore = null;
  try { latestBefore = readFileSync(latestPath, "utf8"); } catch { /* No prior controller state. */ }
  currentStage = "target-controller-start";
  // Intent is durable before handoff; a crash here cannot be replayed as a source failure.
  controllerStarted = true;
  attempt.controllerStarted = true;
  handoffEvidence={handoffNonce:randomUUID()};
  save(record("BOOTSTRAP_RUNNING"));
  const result = await spawnController({
    runnerPath: target.runnerPath,
    targetCommit,
    bootstrapCommit,
    sourceRoot,
    environment:{...process.env,LUMINA_BOOTSTRAP_ATTEMPT_ID:attempt.attemptId,LUMINA_HOST_HANDOFF_NONCE:handoffEvidence.handoffNonce},
  });
  if (result.code !== 0) {
    let rejection=null;
    try{const identity=controllerEntryIdentity(request,{LUMINA_BOOTSTRAP_ATTEMPT_ID:attempt.attemptId,LUMINA_HOST_HANDOFF_NONCE:handoffEvidence.handoffNonce,LUMINA_TARGET_SOURCE_COMMIT:targetCommit});const file=controllerEntryPath(identity,path.dirname(requestPath));rejection=validateEarlyRejection(readJson(file),identity);if(!Number.isSafeInteger(result.pid)||result.pid<1||rejection.controllerPid!==result.pid||rejection.nodeExecutable!==process.execPath)throw new Error("EARLY_REJECTION_PROCESS_MISMATCH");handoffEvidence={...handoffEvidence,controllerExitCode:result.code,controllerPid:result.pid,earlyRejection:{file:path.basename(file),sha256:sha256(JSON.stringify(rejection))}};}catch{ /* Missing or ambiguous entry evidence never permits recovery. */ }
    if(rejection&&result.code===1){currentStage="target-controller-rejected";attempt.finishedAt=new Date().toISOString();save(record("CONTROLLER_REJECTED",rejection.code));return result.code;}
    let latestAfter = null;
    try { latestAfter = readFileSync(latestPath, "utf8"); } catch { /* The controller did not persist state. */ }
    const latest = readJson(latestPath);
    if (latest?.requestId !== request.requestId || latestAfter === latestBefore || latest.result === "BOOTSTRAP_RUNNING") {
      currentStage = "target-controller-exit";
      save(record("BOOTSTRAP_FAILED", "TARGET_CONTROLLER_EXIT_FAILED"));
    }
  }
  return result.code;
  } catch (error) {
    if(error?.code==="HOST_PREFLIGHT_FAILED"){process.stderr.write(`${JSON.stringify(error.diagnostics)}\n`);throw Object.assign(error,{bootstrapRecorded:true});}
    if (error?.code === "CONTROL_PLANE_FINALIZATION_FAILED") throw error;
    const code = controllerStarted ? "TARGET_CONTROLLER_START_FAILED"
      : currentStage === "target-asset" ? "BOOTSTRAP_TARGET_ASSET_INVALID"
        : /^(?:BOOTSTRAP_[A-Z_]+|NODE_RUNTIME_INCOMPATIBLE)$/.test(error?.code ?? "") ? error.code
          : currentStage === "fast-forward" ? "BOOTSTRAP_GIT_FAST_FORWARD_FAILED" : "BOOTSTRAP_SOURCE_INVALID";
    attempt.finishedAt = new Date().toISOString();
    attempt.error = code;
    save(record("BOOTSTRAP_FAILED", code));
    if (code === "NODE_RUNTIME_INCOMPATIBLE") process.stderr.write(`${error.message}\n`);
    throw Object.assign(new Error(code,{cause:error}), { code, bootstrapRecorded: true });
  }
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
    result: "BOOTSTRAP_FAILED",
    applicationResult: "NOT_STARTED",
    stage: "bootstrap-preflight-failed",
    finalizationComplete: false,
    requestArchived: false,
    recoverySafe: false,
    finishedAt: now,
    error: "BOOTSTRAP_SOURCE_INVALID",
  };
  try {
    // Never erase an existing application's migration/switch or terminal evidence.
    if (readJson(path.join(stateRoot, "latest.json"))?.requestId !== request?.requestId) {
      atomicWrite(path.join(stateRoot, "latest.json"), state);
    }
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
  if(!hostLocksHeld([HOST_PATHS.deployLock]))throw new Error("BOOTSTRAP_DEPLOYMENT_LOCK_REQUIRED");
  const sourceMetadata = lstatSync(PRODUCTION_SOURCE_ROOT);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()
    || realpathSync(PRODUCTION_SOURCE_ROOT) !== PRODUCTION_SOURCE_ROOT) {
    throw new Error("BOOTSTRAP_SOURCE_ROOT_INVALID");
  }
  try {
    process.exitCode = await runBootstrap();
  } catch (error) {
    if (!error?.bootstrapRecorded) persistBootstrapFailure(error);
    process.stderr.write(`${error?.code ?? "BOOTSTRAP_FAILED"}\n`);
    process.exitCode = 1;
  }
}

if (isEntrypoint) await main();
