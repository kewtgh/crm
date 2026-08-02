const validationError = /^TARGET_RUNTIME_(?:SECRET_MISSING|ENVIRONMENT_INVALID|SECRET_MISMATCH|SECRET_NOT_INDEPENDENT):[a-z,]+:[A-Za-z0-9_,:-]+$/;

export function classifyTargetRuntimeValidatorResult({ code, stdout = "", stderr = "", spawnFailed = false }) {
  if (spawnFailed) return { valid: false, errorCode: "TARGET_RUNTIME_VALIDATOR_UNAVAILABLE" };
  if (code === 0) {
    try {
      const result = JSON.parse(String(stdout));
      if (result?.status === "VALID"
        && Array.isArray(result.boundaries)
        && result.boundaries.join(",") === "web,worker") {
        return { valid: true, errorCode: null };
      }
    } catch {
      // Invalid validator output is a tool failure, not an environment failure.
    }
    return { valid: false, errorCode: "TARGET_RUNTIME_VALIDATOR_EXECUTION_FAILED" };
  }
  const lines = String(stderr).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const contractError = lines.find((line) => validationError.test(line));
  if (contractError) return { valid: false, errorCode: contractError };
  if (/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:package|module)/i.test(String(stderr))) {
    return { valid: false, errorCode: "TARGET_RUNTIME_VALIDATOR_UNAVAILABLE" };
  }
  return { valid: false, errorCode: "TARGET_RUNTIME_VALIDATOR_EXECUTION_FAILED" };
}

export async function executeTargetRuntimeValidator(run, secretsRoot) {
  let result;
  try {
    result = await run("validate target runtime environment contract", "node", [
      "scripts/validate-production-runtime-contract.mjs",
      secretsRoot,
    ], { timeoutMs: 30_000, quiet: true, allowFailure: true });
  } catch {
    throw new Error("TARGET_RUNTIME_VALIDATOR_UNAVAILABLE");
  }
  const classification = classifyTargetRuntimeValidatorResult(result);
  if (!classification.valid) throw new Error(classification.errorCode);
}

export async function runTargetRuntimePreflight({ run, persist, secretsRoot }) {
  try {
    await executeTargetRuntimeValidator(run, secretsRoot);
    persist({ preflight: "VALID" });
  } catch (error) {
    persist({ preflight: "FAILED" });
    throw error;
  }
}
