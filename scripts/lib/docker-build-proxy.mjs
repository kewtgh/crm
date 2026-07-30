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
