import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_STDERR_BYTES = 4096;

export function classifyWorkerProcessStderr(stderr) {
  const bounded = String(stderr ?? "").slice(0, MAX_STDERR_BYTES);
  if (/ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/i.test(bounded)) {
    return "WORKER_RUNTIME_MODULE_MISSING";
  }
  return "WORKER_PROCESS_EXITED";
}

export function workerProcessFailure(label, stderr) {
  const errorCode = classifyWorkerProcessStderr(stderr);
  return {
    code: 1,
    errorCode,
    error: new Error(`${errorCode}:${label}`),
  };
}

export function runWorkerScript(scriptUrl, label, environment = process.env) {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = spawn(process.execPath, [fileURLToPath(scriptUrl)], {
        env: environment,
        stdio: ["ignore", "inherit", "pipe"],
      });
    } catch {
      finish({
        code: 1,
        errorCode: "WORKER_PROCESS_SPAWN_FAILED",
        error: new Error(`WORKER_PROCESS_SPAWN_FAILED:${label}`),
      });
      return;
    }
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(0, MAX_STDERR_BYTES);
    });
    child.once("error", () => finish({
      code: 1,
      errorCode: "WORKER_PROCESS_SPAWN_FAILED",
      error: new Error(`WORKER_PROCESS_SPAWN_FAILED:${label}`),
    }));
    child.once("exit", (code) => {
      if (code === 0) return finish({ code: 0, errorCode: null, error: null });
      return finish({ ...workerProcessFailure(label, stderr), code: code ?? 1 });
    });
  });
}
