import {HOST_CONTRACT,componentDiagnostic} from "../../deploy/libexec/lumina-host-contract.mjs";
export const REQUIRED_NODE_VERSION = HOST_CONTRACT.components.node.required;

export function deploymentRuntime(version = process.version) {
  const compatible = !componentDiagnostic("node",version,HOST_CONTRACT.components.node).blocking;
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
