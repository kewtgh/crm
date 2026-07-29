export function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const match = /^(\d{1,3})(?:\.(\d{1,3})){3}$/.exec(normalized);
  if (!match) return false;
  const octets = normalized.split(".").map(Number);
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && octets[0] === 127;
}

export function detailedReadinessAllowed(request: Request) {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(url.hostname)) return false;

  const host = request.headers.get("host");
  if (!host) return true;
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
