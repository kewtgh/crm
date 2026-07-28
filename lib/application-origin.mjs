function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "[::1]";
}

export function secureEndpointOrigin(value) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function configuredApplicationOrigin(environment = process.env) {
  return secureEndpointOrigin(environment.APP_URL);
}

export function configuredObjectStorageOrigin(environment = process.env) {
  return secureEndpointOrigin(environment.S3_ENDPOINT);
}

export function applicationOrigin(requestUrl, environment = process.env) {
  const configured = configuredApplicationOrigin(environment);
  if (configured) return configured;
  if (environment.NODE_ENV === "production") {
    throw new Error("APP_ORIGIN_NOT_CONFIGURED");
  }
  const fallback = secureEndpointOrigin(requestUrl);
  if (!fallback) throw new Error("APP_ORIGIN_NOT_CONFIGURED");
  return fallback;
}
