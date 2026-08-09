import { parseEnv } from "node:util";

const releaseModes = new Set(["deploy", "initialize"]);
const sensitiveEnvironmentKey = /(?:PASSWORD|SECRET|TOKEN|DATABASE.*URL|EMAIL_DELIVERY_WEBHOOK_URL|ACCESS_KEY|ENCRYPTION_KEY|HMAC|CREDENTIAL)/;

export class ProductionReleaseWorkflowError extends Error {
  constructor(cause, { migrationMayHaveChanged, switched }) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ProductionReleaseWorkflowError";
    this.migrationMayHaveChanged = migrationMayHaveChanged;
    this.switched = switched;
  }
}

export function assertReleaseModeAllowed({
  mode,
  acceptedStateExists,
  acceptedRelease,
}) {
  if (!releaseModes.has(mode)) throw new Error(`Unsupported production release mode: ${mode}`);
  if (mode === "initialize" && acceptedStateExists) {
    throw new Error(
      "Production initialization is refused because last-success.json already exists; "
      + "use npm run deploy:production for future releases",
    );
  }
  if (mode === "deploy" && (!acceptedStateExists || !acceptedRelease)) {
    throw new Error(
      "No accepted production release exists; "
      + "run npm run deploy:production:initialize first",
    );
  }
}

export function acceptedReleaseMatchesRequest({ request, priorLatest, acceptedRelease }) {
  if (!request?.requestId || !acceptedRelease?.currentImage) return false;
  if (acceptedRelease.requestId === request.requestId) {
    return acceptedRelease.mode === request.mode
      && acceptedRelease.currentImage === priorLatest?.targetImage;
  }
  return priorLatest?.requestId === request.requestId
    && priorLatest.applicationAccepted === true
    && acceptedRelease.currentImage === priorLatest.targetImage;
}

export function extractSensitiveEnvironmentValues(contents) {
  const parsed = parseEnv(contents);
  const values = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!sensitiveEnvironmentKey.test(key) || !value) continue;
    values.push(value);
    if (/DATABASE.*URL/.test(key)) {
      try {
        const password = decodeURIComponent(new URL(value).password);
        if (password) values.push(password);
      } catch {
        // The complete configured value remains protected.
      }
    }
  }
  return values;
}

export function redactDeploymentSecrets(value, secretValues) {
  let safe = String(value);
  const orderedSecrets = [...new Set(secretValues.filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  for (const secret of orderedSecrets) {
    safe = safe.replaceAll(secret, "[REDACTED]");
    try {
      const encoded = encodeURIComponent(secret);
      if (encoded !== secret) safe = safe.replaceAll(encoded, "[REDACTED]");
    } catch {
      // The literal replacement remains in effect.
    }
  }
  return safe;
}

export function createAcceptedRelease({
  deploymentId,
  request,
  target,
  previousAccepted,
  acceptedAt,
  releaseHealth,
}) {
  return {
    deploymentId,
    requestId: request.requestId,
    mode: request.mode,
    commit: target.commit,
    version: target.version,
    currentImage: target.currentImage,
    operationsImage: target.operationsImage,
    rollbackCommit: previousAccepted?.commit ?? null,
    rollbackVersion: previousAccepted?.version ?? null,
    rollbackImage: previousAccepted?.currentImage ?? null,
    rollbackOperationsImage: previousAccepted?.operationsImage ?? null,
    rollbackDeploymentId: previousAccepted?.deploymentId ?? null,
    recentImages: [...new Set([
      target.currentImage,
      target.operationsImage,
      ...(previousAccepted?.recentImages ?? []),
    ])].slice(0, 10),
    acceptedAt,
    database: "FORWARD_ONLY",
    ...(releaseHealth ? { releaseHealth } : {}),
  };
}

export function releaseFailureRollbackPlan({ switched, previousAccepted }) {
  if (!switched) return null;
  if (!previousAccepted?.currentImage || !previousAccepted?.operationsImage) {
    return { status: "UNAVAILABLE", reason: "No accepted application image exists" };
  }
  return { status: "REQUIRED" };
}

export async function runProductionReleaseWorkflow({
  mode,
  operations,
  targetCommit = operations?.targetCommit,
}) {
  if (!releaseModes.has(mode)) throw new Error(`Unsupported production release mode: ${mode}`);
  if (!/^[0-9a-f]{40}$/.test(targetCommit ?? "")) {
    throw new Error("Target controller commit must be a full SHA");
  }
  let migrationMayHaveChanged = false;
  let switched = false;
  try {
    const commit = targetCommit;
    const target = await operations.resolveTarget(commit);
    await operations.preflightSecretSources();
    await operations.preflightTargetRuntimeContract();
    await operations.prepare();
    await operations.buildImages(target);
    const candidateEnvironment = await operations.writeCandidateEnvironment(target);
    await operations.startPostgres(candidateEnvironment);
    if (mode === "initialize") {
      await operations.bootstrapDatabase(candidateEnvironment);
    }
    await operations.verifyMigrations(candidateEnvironment);
    migrationMayHaveChanged = true;
    await operations.markMigrationMayHaveChanged?.();
    await operations.migrate(candidateEnvironment);
    if (mode === "initialize") {
      await operations.bootstrapAdmin(candidateEnvironment);
    }
    const releaseHealthBaseline = await operations.captureReleaseHealthBaseline(
      candidateEnvironment,
    );
    switched = true;
    await operations.switchApplication(candidateEnvironment);
    const releaseHealth = await operations.acceptRuntime(candidateEnvironment, {
      baseline: releaseHealthBaseline,
      acceptanceMode: "release",
    });
    return {
      candidateEnvironment,
      commit,
      migrationMayHaveChanged,
      switched,
      target,
      releaseHealth,
    };
  } catch (error) {
    throw new ProductionReleaseWorkflowError(error, {
      migrationMayHaveChanged,
      switched,
    });
  }
}
