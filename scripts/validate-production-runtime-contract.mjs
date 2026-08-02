#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

import {
  inspectCoreRuntimeEnvironment,
  inspectWorkerRuntimeEnvironment,
} from "../lib/runtime-environment-core.mjs";
import {
  TargetRuntimeContractError,
  validateTargetRuntimeContract,
} from "./lib/target-runtime-contract.mjs";

export async function validateProductionRuntimeContractFiles({
  secretsRoot = "/etc/lumina-crm/secrets",
  enforceProductionPath = true,
} = {}) {
  if (enforceProductionPath && path.resolve(secretsRoot) !== "/etc/lumina-crm/secrets") {
    throw new TargetRuntimeContractError(
      "TARGET_RUNTIME_ENVIRONMENT_INVALID",
      "host",
      ["LUMINA_SECRETS_DIR"],
    );
  }
  const [webText, workerText] = await Promise.all([
    readFile(path.join(secretsRoot, "production.env"), "utf8"),
    readFile(path.join(secretsRoot, "worker.env"), "utf8"),
  ]);
  const web = parseEnv(webText);
  const worker = parseEnv(workerText);
  return validateTargetRuntimeContract({
    web,
    worker,
    webStatus: inspectCoreRuntimeEnvironment(web),
    workerStatus: inspectWorkerRuntimeEnvironment(worker),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await validateProductionRuntimeContractFiles({
      secretsRoot: process.argv[2] || "/etc/lumina-crm/secrets",
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error instanceof TargetRuntimeContractError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write("TARGET_RUNTIME_ENVIRONMENT_INVALID:host:production.env,worker.env\n");
    }
    process.exitCode = 1;
  }
}
