#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import {
  TargetRuntimeContractError,
  validateTargetRuntimeContract,
} from "./lib/target-runtime-contract.mjs";
import {
  inspectCoreRuntimeEnvironment,
  inspectWorkerRuntimeEnvironment,
} from "../lib/runtime-environment.ts";

const secretsRoot = process.argv[2] || "/etc/lumina-crm/secrets";
if (path.resolve(secretsRoot) !== "/etc/lumina-crm/secrets") {
  throw new Error("TARGET_RUNTIME_ENVIRONMENT_INVALID:host:LUMINA_SECRETS_DIR");
}

try {
  const [webText, workerText] = await Promise.all([
    readFile(path.join(secretsRoot, "production.env"), "utf8"),
    readFile(path.join(secretsRoot, "worker.env"), "utf8"),
  ]);
  const web = parseEnv(webText);
  const worker = parseEnv(workerText);
  const result = validateTargetRuntimeContract({
    web,
    worker,
    webStatus: inspectCoreRuntimeEnvironment(web),
    workerStatus: inspectWorkerRuntimeEnvironment(worker),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  if (error instanceof TargetRuntimeContractError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write("TARGET_RUNTIME_ENVIRONMENT_INVALID:host:production.env,worker.env\n");
    process.exitCode = 1;
  }
}
