export const DOCKER_BUILD_PROXY_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
];

export function parseDockerBuildProxy(value) {
  const proxy = String(value ?? "").trim();
  if (!proxy) return "";
  let parsed;
  try {
    parsed = new URL(proxy);
  } catch {
    throw new Error("LUMINA_DOCKER_PROXY_INVALID");
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || proxy.includes("?")
    || proxy.includes("#")) {
    throw new Error("LUMINA_DOCKER_PROXY_INVALID");
  }
  return proxy;
}

export function dockerBuildEnvironment(baseEnvironment, proxyValue) {
  const environment = { ...baseEnvironment };
  for (const key of [
    ...DOCKER_BUILD_PROXY_KEYS,
    "ALL_PROXY",
    "all_proxy",
    "LUMINA_DOCKER_PROXY",
  ]) delete environment[key];
  const proxy = parseDockerBuildProxy(proxyValue);
  if (proxy) {
    for (const key of DOCKER_BUILD_PROXY_KEYS) environment[key] = proxy;
  }
  return environment;
}

export function dockerBuildProxyArguments(proxyValue) {
  if (!parseDockerBuildProxy(proxyValue)) return [];
  return DOCKER_BUILD_PROXY_KEYS.flatMap((key) => ["--build-arg", key]);
}

export function validateBuildxInspectContract(output, { builderName, dockerProxy }) {
  if (!new RegExp(`^Name:\\s+${builderName}$`, "m").test(output)
    || !/^Driver:\s+docker-container$/m.test(output)) {
    throw new Error("LUMINA_BUILDKIT_DRIVER_CONFIGURATION_MISMATCH");
  }
  const lines = [...String(output).matchAll(/^Driver Options:\s*(.+)$/gm)];
  if (lines.length !== 1) throw new Error("LUMINA_BUILDKIT_NETWORK_CONFIGURATION_MISMATCH");
  const options = new Map();
  const value = lines[0][1].trim();
  const tokenPattern = /(?:^|\s)([^\s=]+)="([^"]*)"/g;
  let consumed = "";
  for (const match of value.matchAll(tokenPattern)) {
    options.set(match[1], match[2]);
    consumed += match[0];
  }
  if (consumed.trim() !== value || options.get("network") !== "host") {
    throw new Error("LUMINA_BUILDKIT_NETWORK_CONFIGURATION_MISMATCH");
  }
  const proxy = parseDockerBuildProxy(dockerProxy);
  const expectedKeys = new Set([
    "network",
    ...(proxy ? DOCKER_BUILD_PROXY_KEYS.map((key) => `env.${key}`) : []),
  ]);
  if (options.size !== expectedKeys.size
    || [...options.keys()].some((key) => !expectedKeys.has(key))
    || DOCKER_BUILD_PROXY_KEYS.some((key) => (
      proxy ? options.get(`env.${key}`) !== proxy : options.has(`env.${key}`)
    ))) {
    throw new Error("LUMINA_BUILDKIT_PROXY_CONFIGURATION_MISMATCH");
  }
  return true;
}
