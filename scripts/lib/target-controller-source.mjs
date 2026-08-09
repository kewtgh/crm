const FULL_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function parseTargetControllerArguments(argumentsList, controllerPid = process.pid) {
  const values = new Map();
  let sourceAlreadyUpdated = false;
  for (const argument of argumentsList) {
    if (argument === "--source-already-updated") sourceAlreadyUpdated = true;
    else if (argument.startsWith("--") && argument.includes("=")) {
      const separator = argument.indexOf("=");
      values.set(argument.slice(2, separator), argument.slice(separator + 1));
    } else {
      throw new Error("TARGET_CONTROLLER_SOURCE_CHANGED");
    }
  }
  const expectedTarget = values.get("expected-target") ?? "";
  const bootstrapSource = values.get("bootstrap-source") ?? "";
  const bootstrapPid = Number(values.get("bootstrap-pid"));
  if (!sourceAlreadyUpdated || !FULL_SHA.test(expectedTarget) || !FULL_SHA.test(bootstrapSource)
    || !Number.isSafeInteger(bootstrapPid) || bootstrapPid < 1 || bootstrapPid === controllerPid) {
    throw new Error("TARGET_CONTROLLER_SOURCE_CHANGED");
  }
  return { expectedTarget, bootstrapSource, bootstrapPid };
}

export async function verifyTargetControllerSource({
  launch,
  git,
  readPackageVersion,
  expectedBranch = "main",
  allowedOrigins,
}) {
  const branch = await git(["branch", "--show-current"]);
  const origin = await git(["remote", "get-url", "origin"]);
  const head = await git(["rev-parse", "HEAD"]);
  const status = await git(["status", "--porcelain"]);
  const version = String(readPackageVersion() ?? "");
  if (branch !== expectedBranch || !allowedOrigins.has(origin) || head !== launch.expectedTarget
    || status || !VERSION.test(version)) {
    throw new Error("TARGET_CONTROLLER_SOURCE_CHANGED");
  }
  return { commit: head, version };
}
