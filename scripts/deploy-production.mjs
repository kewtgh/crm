#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertPathWithin,
  classifyPersistedDeployment,
  isSystemdServiceInProgress,
  PRODUCTION_LOCAL_URL,
  PRODUCTION_DEPLOY_LOCK_PATH,
  PRODUCTION_PUBLIC_URL,
  validateDeployAssetTexts,
  validateDirectoryMetadata,
  writeExclusiveRequest,
} from "./lib/production-deploy-core.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployRoot = path.resolve("/opt/lumina-crm");
const stateRoot = path.resolve("/var/lib/lumina-crm/deployments");
const logRoot = path.resolve("/var/log/lumina-crm/deployments");
const requestPath = path.join(stateRoot, "request.json");
const latestPath = path.join(stateRoot, "latest.json");
const deployService = "lumina-crm-deploy.service";
const terminalResults = new Set(["SUCCESS", "FAILED", "ROLLBACK_OK", "ROLLBACK_FAILED"]);
const terminalMarkers = {
  SUCCESS: "LUMINA_PRODUCTION_DEPLOY_OK",
  FAILED: "LUMINA_PRODUCTION_DEPLOY_FAILED",
  ROLLBACK_OK: "LUMINA_PRODUCTION_ROLLBACK_OK",
  ROLLBACK_FAILED: "LUMINA_PRODUCTION_ROLLBACK_FAILED",
};

function help() {
  process.stdout.write(`Lumina CRM persistent production deployment controller

Usage:
  npm run deploy:production              Start and follow one safe production update
  npm run deploy:production:detach       Start an update and return after the runner accepts it
  npm run deploy:production:status       Show the persisted deployment state
  npm run deploy:production:logs         Print the latest deployment log
  npm run deploy:production:rollback     Roll back application files to the recorded previous release
  npm run deploy:production:dry-run      Validate repository deployment assets without side effects

The systemd runner continues if SSH disconnects. Re-run the status or logs command
to recover the exact deployment ID and final result. Database migrations are
forward-only and are never represented as rolled back.
`);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function command(commandName, args, { allowFailure = false } = {}) {
  const result = spawnSync(commandName, args, {
    cwd: sourceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = String(result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 500);
    throw new Error(`${commandName} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function deploymentServiceState() {
  const result = command(
    "systemctl",
    ["show", deployService, "--property=ActiveState", "--value", "--no-pager"],
    { allowFailure: true },
  );
  return String(result.stdout ?? "").trim();
}

function isServiceActive() {
  return isSystemdServiceInProgress(deploymentServiceState());
}

function deploymentServiceOutcome() {
  const result = command(
    "systemctl",
    ["show", deployService, "--property=Result,ExecMainStatus", "--no-pager"],
    { allowFailure: true },
  );
  return Object.fromEntries(String(result.stdout ?? "").trim().split(/\r?\n/)
    .map((line) => line.split(/=(.*)/s).slice(0, 2))
    .filter(([key]) => key));
}

function assertProductionController() {
  if (process.platform !== "linux") throw new Error("Production deployment start/status commands require the Linux production server");
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error("Run the deployment controller as lumina-crm, not root");
  }
  if (sourceRoot !== path.join(deployRoot, "source")) {
    throw new Error(`Run this command from ${path.join(deployRoot, "source")}`);
  }
  if (!existsSync(stateRoot)) {
    throw new Error(`Deployment state directory is missing: ${stateRoot}; install the systemd runner first`);
  }
  const stateMetadata = lstatSync(stateRoot);
  validateDirectoryMetadata(stateMetadata, { label: "Deployment state directory" });
  if (stateMetadata.uid !== process.getuid()) throw new Error("Run the deployment controller as the lumina-crm directory owner");
  if (realpathSync(stateRoot) !== stateRoot) throw new Error(`Deployment state directory must resolve exactly to ${stateRoot}`);
}

async function waitForAccepted(requestId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const latest = readJson(latestPath);
    if (latest?.requestId === requestId) return latest;
    if (!isServiceActive() && Date.now() - startedAt >= 2_000) {
      const outcome = deploymentServiceOutcome();
      if (outcome.ExecMainStatus === "73") {
        throw new Error(`Another production deployment already holds ${PRODUCTION_DEPLOY_LOCK_PATH}; request ${requestId} remains recoverable`);
      }
      throw new Error(`The systemd runner stopped before accepting request ${requestId} (result ${outcome.Result ?? "unknown"}, exit ${outcome.ExecMainStatus ?? "unknown"}); the request remains recoverable`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The systemd runner did not accept request ${requestId} within ${timeoutMs / 1000}s`);
}

function printSummary(status) {
  if (!status) {
    process.stdout.write("Lumina production deployment state: IDLE\n");
    return;
  }
  const lines = [
    `state: ${status.result ?? "UNKNOWN"}`,
    `deployment ID: ${status.deploymentId ?? "pending"}`,
    `request ID: ${status.requestId ?? "unknown"}`,
    `stage: ${status.stage ?? "unknown"}`,
    `previous commit: ${status.previousCommit ?? "unknown"}`,
    `target commit: ${status.targetCommit ?? "unknown"}`,
    `application version: ${status.applicationVersion ?? "unknown"}`,
    `release path: ${status.releasePath ?? "not created"}`,
    `started: ${status.startedAt ?? "unknown"}`,
    `finished: ${status.finishedAt ?? "not finished"}`,
    `duration ms: ${status.durationMs ?? "not finished"}`,
    `log: ${status.logPath ?? "not created"}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function followRequest(requestId, initial) {
  let printedLength = 0;
  let latest = initial;
  const deadline = Date.now() + 3_900_000;
  while (Date.now() < deadline) {
    latest = readJson(latestPath) ?? latest;
    if (latest?.requestId !== requestId) throw new Error("Latest deployment state no longer matches this request");
    if (latest.logPath) {
      const safeLog = assertPathWithin(logRoot, latest.logPath, { directChild: true, label: "Deployment log" });
      const content = await readFile(safeLog, "utf8").catch(() => "");
      if (content.length > printedLength) {
        process.stdout.write(content.slice(printedLength));
        printedLength = content.length;
      }
    }
    if (terminalResults.has(latest?.result)) {
      printSummary(latest);
      process.stdout.write(`${terminalMarkers[latest.result]}\n`);
      if (latest.result !== "SUCCESS" && latest.result !== "ROLLBACK_OK") process.exitCode = 1;
      return;
    }
    if (!isServiceActive()) throw new Error("Production runner became inactive without a terminal persisted result");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for the persistent deployment runner; query status and logs");
}

async function start(mode, { detached = false } = {}) {
  assertProductionController();
  if (isServiceActive()) {
    const current = readJson(latestPath);
    throw new Error(`A production deployment is already running${current?.deploymentId ? ` (${current.deploymentId})` : ""}`);
  }

  let request = readJson(requestPath);
  let created = false;
  if (request) {
    const latest = readJson(latestPath);
    if (latest?.requestId === request.requestId && terminalResults.has(latest.result)) {
      throw new Error(`Completed request ${request.requestId} could not be archived; inspect ${requestPath} before starting another deployment`);
    }
    if (request.mode !== mode) {
      throw new Error(`Pending ${request.mode} request ${request.requestId} must be recovered before starting ${mode}`);
    }
    const requestedAt = Date.parse(request.requestedAt ?? "");
    if (!Number.isFinite(requestedAt)) throw new Error(`Pending request ${request.requestId} has an invalid timestamp`);
    if (Date.now() - requestedAt < 5_000) {
      throw new Error(`A production deployment request is already pending (${request.requestId})`);
    }
    process.stdout.write(`Recovering pending request ${request.requestId}\n`);
  } else {
    mkdirSync(stateRoot, { recursive: true, mode: 0o750 });
    request = {
      requestId: randomUUID(),
      mode,
      requestedAt: new Date().toISOString(),
      sourceRoot,
    };
    await writeExclusiveRequest({ writeFile }, requestPath, request);
    created = true;
  }

  const started = command("sudo", ["-n", "/usr/bin/systemctl", "start", "--no-block", deployService], { allowFailure: true });
  if (started.status !== 0) {
    if (created) rmSync(requestPath, { force: true });
    const detail = String(started.stderr || started.stdout || `exit ${started.status}`).trim().slice(0, 500);
    throw new Error(`Could not start ${deployService}: ${detail}`);
  }
  const accepted = await waitForAccepted(request.requestId);
  printSummary(accepted);
  if (detached) {
    process.stdout.write("Deployment is persistent; use npm run deploy:production:status and npm run deploy:production:logs.\n");
    return;
  }
  await followRequest(request.requestId, accepted);
}

function status() {
  assertProductionController();
  const request = readJson(requestPath);
  const latest = readJson(latestPath);
  const classification = classifyPersistedDeployment({ serviceActive: isServiceActive(), request, latest });
  const requestIsNotAccepted = request && latest?.requestId !== request.requestId;
  const displayed = requestIsNotAccepted
    ? {
        requestId: request.requestId,
        result: classification.state,
        stage: "queued",
        startedAt: request.requestedAt,
      }
    : latest;
  process.stdout.write(`controller state: ${classification.state}\n`);
  printSummary(displayed ?? (request ? { requestId: request.requestId, result: "PENDING", stage: "queued" } : null));
}

async function logs({ follow = false } = {}) {
  assertProductionController();
  const request = readJson(requestPath);
  let latest = readJson(latestPath);
  if (request && latest?.requestId !== request.requestId) {
    throw new Error(`Request ${request.requestId} is persisted but has not produced a deployment log yet; query status and retry`);
  }
  if (!latest?.logPath) throw new Error("No deployment log has been recorded");
  const safeLog = assertPathWithin(logRoot, latest.logPath, { directChild: true, label: "Deployment log" });
  let printedLength = 0;
  do {
    const content = await readFile(safeLog, "utf8");
    if (content.length > printedLength) {
      process.stdout.write(content.slice(printedLength));
      printedLength = content.length;
    }
    if (!follow || terminalResults.has(latest?.result) || !isServiceActive()) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    latest = readJson(latestPath) ?? latest;
  } while (true);
}

function dryRun() {
  const packageJson = JSON.parse(readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  validateDeployAssetTexts({
    serviceUnit: readFileSync(path.join(sourceRoot, "deploy", "systemd", "lumina-crm-deploy.service"), "utf8"),
    sudoers: readFileSync(path.join(sourceRoot, "deploy", "sudoers", "lumina-crm-deploy"), "utf8"),
    webUnit: readFileSync(path.join(sourceRoot, "deploy", "systemd", "lumina-crm.service"), "utf8"),
    workerUnit: readFileSync(path.join(sourceRoot, "deploy", "systemd", "lumina-crm-workers.service"), "utf8"),
    productionEnvironment: readFileSync(path.join(sourceRoot, "deploy", "production.env.example"), "utf8"),
    deploymentEnvironment: readFileSync(path.join(sourceRoot, "deploy", "deploy.env.example"), "utf8"),
    runner: readFileSync(path.join(sourceRoot, "scripts", "deploy-production-runner.mjs"), "utf8"),
    packageJson,
  });
  process.stdout.write(`LUMINA_PRODUCTION_DEPLOY_DRY_RUN_OK
source: ${sourceRoot}
release root: ${path.join(deployRoot, "releases")}
current link: ${path.join(deployRoot, "current")}
state root: ${stateRoot}
log root: ${logRoot}
local health: ${PRODUCTION_LOCAL_URL}/api/health
public health: ${PRODUCTION_PUBLIC_URL}/api/health
Database migrations: project-owned PostgreSQL chain in db/migrations
No files, services, symlinks, databases, or network resources were changed.
`);
}

function assertOptions(allowed) {
  const unexpected = options.filter((option) => !allowed.includes(option));
  if (unexpected.length) throw new Error(`Unsupported deployment option(s): ${unexpected.join(", ")}`);
}

const [action = "start", ...options] = process.argv.slice(2);
if (action === "--help" || action === "-h" || action === "help" || options.includes("--help") || options.includes("-h")) {
  help();
} else {
  try {
    if (action === "start") {
      assertOptions(["--detach"]);
      await start("deploy", { detached: options.includes("--detach") });
    } else if (action === "status") {
      assertOptions([]);
      status();
    } else if (action === "logs") {
      assertOptions(["--follow"]);
      await logs({ follow: options.includes("--follow") });
    } else if (action === "rollback") {
      assertOptions(["--detach"]);
      await start("rollback", { detached: options.includes("--detach") });
    } else if (action === "dry-run") {
      assertOptions([]);
      dryRun();
    }
    else throw new Error(`Unknown deployment action: ${action}`);
  } catch (error) {
    process.stderr.write(`LUMINA_PRODUCTION_DEPLOY_FAILED\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
