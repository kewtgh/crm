const SECURITY_SECRET_KEYS = [
  "TURNSTILE_SECRET_KEY",
  "ALTCHA_HMAC_SECRET",
  "LOGIN_THROTTLE_HASH_SECRET",
  "TRUSTED_DEVICE_HASH_SECRET",
  "TOTP_ENCRYPTION_KEY",
  "OBJECT_STORAGE_SIGNING_SECRET",
];

export class TargetRuntimeContractError extends Error {
  constructor(code, boundary, variables) {
    super(`${code}:${boundary}:${[...new Set(variables)].sort().join(",")}`);
    this.name = "TargetRuntimeContractError";
    this.code = code;
    this.boundary = boundary;
    this.variables = [...new Set(variables)].sort();
  }
}

export function invitationCredentialKey(value) {
  const configured = String(value ?? "").trim();
  const decoded = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (decoded.length !== 32 || (!/^[a-f0-9]{64}$/i.test(configured) && decoded.toString("base64").replace(/=+$/, "") !== configured.replace(/=+$/, ""))) {
    throw new TargetRuntimeContractError(
      "TARGET_RUNTIME_ENVIRONMENT_INVALID",
      "web,worker",
      ["INVITATION_CREDENTIAL_ENCRYPTION_KEY"],
    );
  }
  return decoded;
}

export function validateTargetRuntimeContract({ web, worker, webStatus, workerStatus }) {
  const missing = [];
  for (const [boundary, environment, status] of [
    ["web", web, webStatus],
    ["worker", worker, workerStatus],
  ]) {
    if (status.valid) continue;
    const absent = status.missing.filter((key) => !environment[key]?.trim());
    if (absent.length) missing.push(...absent.map((key) => `${boundary}:${key}`));
    const invalid = status.missing.filter((key) => environment[key]?.trim());
    if (invalid.length) {
      throw new TargetRuntimeContractError(
        "TARGET_RUNTIME_ENVIRONMENT_INVALID",
        boundary,
        invalid,
      );
    }
  }
  if (missing.length) {
    throw new TargetRuntimeContractError(
      "TARGET_RUNTIME_SECRET_MISSING",
      "web,worker",
      missing,
    );
  }

  const webKey = invitationCredentialKey(web.INVITATION_CREDENTIAL_ENCRYPTION_KEY);
  const workerKey = invitationCredentialKey(worker.INVITATION_CREDENTIAL_ENCRYPTION_KEY);
  if (!webKey.equals(workerKey)) {
    throw new TargetRuntimeContractError(
      "TARGET_RUNTIME_SECRET_MISMATCH",
      "web,worker",
      ["INVITATION_CREDENTIAL_ENCRYPTION_KEY"],
    );
  }
  const invitationValue = web.INVITATION_CREDENTIAL_ENCRYPTION_KEY.trim();
  const reused = SECURITY_SECRET_KEYS.filter((key) => web[key]?.trim() === invitationValue);
  if (reused.length) {
    throw new TargetRuntimeContractError(
      "TARGET_RUNTIME_SECRET_NOT_INDEPENDENT",
      "web",
      ["INVITATION_CREDENTIAL_ENCRYPTION_KEY", ...reused],
    );
  }
  return {
    status: "VALID",
    boundaries: ["web", "worker"],
  };
}
