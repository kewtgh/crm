export const REQUIRED_NODE_VERSION = ">=24.22.0 <25";

export function deploymentRuntime(version = process.version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const compatible = Boolean(match && Number(match[1]) === 24
    && (Number(match[2]) > 22 || (Number(match[2]) === 22 && Number(match[3]) >= 0)));
  return { HOST_NODE_VERSION: version, REQUIRED_NODE_VERSION,
    COMPATIBILITY_RESULT: compatible ? "COMPATIBLE" : "INCOMPATIBLE" };
}

export function assertDeploymentRuntime(version = process.version) {
  const diagnostic = deploymentRuntime(version);
  if (diagnostic.COMPATIBILITY_RESULT !== "COMPATIBLE") {
    throw Object.assign(new Error(Object.entries(diagnostic).map(([key, value]) => `${key}=${value}`).join(" ")
      + " NODE_RUNTIME_INCOMPATIBLE: run the Lumina toolchain pinned in .nvmrc"),
    { code: "NODE_RUNTIME_INCOMPATIBLE" });
  }
  return diagnostic;
}
