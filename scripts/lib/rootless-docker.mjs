export const LUMINA_ROOTLESS_DOCKER_DATA_ROOT = "/var/lib/lumina-crm/docker";

export function expectedRootlessDockerHost(uid) {
  if (!Number.isSafeInteger(uid) || uid <= 0) {
    throw new Error("LUMINA_ROOTLESS_DOCKER_UID_INVALID");
  }
  return `unix:///run/user/${uid}/docker.sock`;
}

export function assertRootlessDockerHost(
  environment = process.env,
  uid = typeof process.getuid === "function" ? process.getuid() : 0,
) {
  const expected = expectedRootlessDockerHost(uid);
  if (environment.DOCKER_HOST?.trim() !== expected) {
    throw new Error(`LUMINA_ROOTLESS_DOCKER_HOST_REQUIRED:${expected}`);
  }
  return expected;
}

export function assertRootlessDockerInfo({
  securityOptions,
  cgroupDriver,
  dockerRoot,
  expectedDockerRoot = LUMINA_ROOTLESS_DOCKER_DATA_ROOT,
}) {
  let options;
  try {
    options = Array.isArray(securityOptions)
      ? securityOptions
      : JSON.parse(String(securityOptions));
  } catch {
    throw new Error("LUMINA_DOCKER_SECURITY_OPTIONS_INVALID");
  }
  if (!options.some((value) => String(value).toLowerCase().includes("rootless"))) {
    throw new Error("LUMINA_ROOTLESS_DOCKER_REQUIRED");
  }
  if (String(cgroupDriver).trim() !== "systemd") {
    throw new Error("LUMINA_ROOTLESS_CGROUP_V2_SYSTEMD_REQUIRED");
  }
  const resolvedRoot = String(dockerRoot).trim().replace(/\/+$/, "");
  if (resolvedRoot !== expectedDockerRoot) {
    throw new Error(
      `LUMINA_ROOTLESS_DOCKER_DATA_ROOT_MISMATCH:${resolvedRoot}:${expectedDockerRoot}`,
    );
  }
  return {
    rootless: true,
    cgroupDriver: "systemd",
    dockerRoot: resolvedRoot,
  };
}
