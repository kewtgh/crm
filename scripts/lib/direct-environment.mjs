const PROXY_ENVIRONMENT_KEY = /(?:PROXY|PROXY_COMMAND)$/i;
const PROXY_PRELOAD_PATTERN = /(?:register-proxy|proxyagent|--use-env-proxy)/i;

export function directRuntimeEnvironment(environment = {}) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => (
    !PROXY_ENVIRONMENT_KEY.test(key) && key.toUpperCase() !== "NODE_OPTIONS"
  )));
}

export function assertProxyFreeEnvironment(environment = {}, label = "Runtime environment") {
  const forbidden = Object.entries(environment).filter(([key, value]) => (
    PROXY_ENVIRONMENT_KEY.test(key)
    || (key.toUpperCase() === "NODE_OPTIONS" && PROXY_PRELOAD_PATTERN.test(String(value ?? "")))
  )).map(([key]) => key);
  if (forbidden.length) {
    throw new Error(`${label} contains proxy environment: ${[...new Set(forbidden)].sort().join(", ")}`);
  }
  return true;
}

export function assertProxyFreeSystemdEnvironment(value, label) {
  const environment = String(value ?? "");
  const forbiddenKeys = [...environment.matchAll(/(?:^|\s|")([A-Za-z_][A-Za-z0-9_]*)=/g)]
    .map((match) => match[1])
    .filter((key) => PROXY_ENVIRONMENT_KEY.test(key));
  if (forbiddenKeys.length || PROXY_PRELOAD_PATTERN.test(environment)) {
    throw new Error(`${label} must not contain proxy variables or a proxy preload`);
  }
  return true;
}
