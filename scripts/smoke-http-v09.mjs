const base = (process.env.APP_URL ?? "http://127.0.0.1:3200").replace(/\/$/, "");

async function request(path, init) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    ...init,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, body, contentType };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const live = await request("/api/health");
assert(live.response.status === 200, `liveness returned ${live.response.status}`);
assert(live.body?.status === "ok", "liveness did not report ok");
assert(live.body?.version === "2.0.0", "liveness version is not 2.0.0");
assert(Boolean(live.response.headers.get("x-request-id")), "liveness omitted x-request-id");

const ready = await request("/api/health?mode=ready");
assert([200, 503].includes(ready.response.status), "readiness returned an invalid status");
assert(
  typeof ready.body?.checks?.database === "boolean",
  "readiness omitted dependency checks",
);

for (const path of [
  "/api/crm/schools?page=1&pageSize=20",
  "/api/admin/users?page=1&pageSize=20",
  "/api/catalog",
  "/api/operations",
]) {
  const result = await request(path);
  assert(result.response.status === 401, `${path} returned ${result.response.status}, expected 401`);
  assert(result.contentType.includes("application/json"), `${path} did not return JSON`);
  assert(result.body?.error?.code === "AUTH_REQUIRED", `${path} omitted the uniform auth error`);
  assert(Boolean(result.body?.error?.requestId), `${path} omitted the error request ID`);
}

const login = await request("/login");
assert(login.response.status === 200, `login returned ${login.response.status}`);
const csp = login.response.headers.get("content-security-policy") ?? "";
assert(csp.includes("strict-dynamic"), "CSP does not use strict-dynamic");
assert(csp.includes("'nonce-"), "CSP does not contain a request nonce");
assert(!/script-src[^;]*unsafe-inline/.test(csp), "script-src still permits unsafe-inline");

const registration = await request("/register");
assert(registration.response.status === 404, "removed public registration route is reachable");

process.stdout.write(
  "v2.0.0 base HTTP smoke passed: liveness, JSON auth errors, request IDs, nonce CSP, and removed registration.\n",
);
