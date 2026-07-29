const INTERNAL_AUTH_HEADER = "x-lumina-origin-auth";
const INTERNAL_CLIENT_IP_HEADER = "x-lumina-client-ip";
const untrustedForwardingHeaders = [
  INTERNAL_AUTH_HEADER,
  INTERNAL_CLIENT_IP_HEADER,
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
];

export function validateProxyEnvironment(environment) {
  const publicHostname = environment.PUBLIC_HOSTNAME?.trim().toLowerCase();
  const secret = environment.ORIGIN_AUTH_SECRET?.trim();
  if (!publicHostname || !secret || secret.length < 32) {
    throw new Error("CLOUDFLARE_PROXY_ENVIRONMENT_INVALID");
  }
  let origin;
  try {
    origin = new URL(environment.ORIGIN_URL);
  } catch {
    throw new Error("CLOUDFLARE_ORIGIN_URL_INVALID");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password
    || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("CLOUDFLARE_ORIGIN_MUST_BE_HTTPS_ORIGIN");
  }
  if (origin.hostname.toLowerCase() === publicHostname) {
    throw new Error("CLOUDFLARE_ORIGIN_PUBLIC_LOOP");
  }
  return { publicHostname, origin, secret };
}

export function createLuminaProxy(fetchImplementation = fetch) {
  return async function proxy(request, environment) {
    const configured = validateProxyEnvironment(environment);
    const incoming = new URL(request.url);
    if (incoming.hostname.toLowerCase() !== configured.publicHostname) {
      return new Response("Misdirected Request", { status: 421 });
    }
    if (incoming.pathname === "/api/health" && incoming.searchParams.get("mode") === "ready") {
      return new Response("Not Found", { status: 404 });
    }

    const clientIp = request.headers.get("cf-connecting-ip")?.trim();
    const headers = new Headers(request.headers);
    for (const header of untrustedForwardingHeaders) headers.delete(header);
    headers.delete("host");
    headers.set(INTERNAL_AUTH_HEADER, configured.secret);
    if (clientIp) headers.set(INTERNAL_CLIENT_IP_HEADER, clientIp);

    const target = new URL(`${incoming.pathname}${incoming.search}`, configured.origin);
    const upstreamRequest = new Request(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      duplex: "half",
      redirect: "manual",
    });
    const upstreamResponse = await fetchImplementation(upstreamRequest, {
      cf: {
        cacheEverything: false,
        cacheTtl: 0,
      },
    });
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set("cache-control", "private, no-store, max-age=0");
    responseHeaders.set("cdn-cache-control", "no-store");
    responseHeaders.set("cloudflare-cdn-cache-control", "no-store");
    responseHeaders.set("expires", "0");
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  };
}

const proxy = createLuminaProxy();

const worker = {
  fetch(request, environment) {
    return proxy(request, environment);
  },
};

export default worker;
