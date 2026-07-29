import assert from "node:assert/strict";
import test from "node:test";
import {
  createLuminaProxy,
  validateProxyEnvironment,
} from "../deploy/cloudflare-worker/src/index.mjs";

const environment = {
  PUBLIC_HOSTNAME: "crm.ewaya.com",
  ORIGIN_URL: "https://origin.crm-internal.example/",
  ORIGIN_AUTH_SECRET: "s".repeat(40),
};

test("forces no-store and replaces client origin authentication", async () => {
  let captured;
  const proxy = createLuminaProxy(async (request, options) => {
    captured = { request, options };
    return new Response("ok", { headers: { "cache-control": "public, max-age=3600" } });
  });
  const response = await proxy(new Request("https://crm.ewaya.com/api/health", {
    headers: {
      "x-lumina-origin-auth": "client-forgery",
      "x-forwarded-for": "198.51.100.9",
      "cf-connecting-ip": "203.0.113.7",
    },
  }), environment);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(captured.options.cf.cacheEverything, false);
  assert.equal(captured.request.headers.get("x-lumina-origin-auth"), environment.ORIGIN_AUTH_SECRET);
  assert.equal(captured.request.headers.get("x-forwarded-for"), null);
  assert.equal(captured.request.headers.get("x-lumina-client-ip"), "203.0.113.7");
});

test("rejects public/origin loops and misdirected public hosts", async () => {
  assert.throws(() => validateProxyEnvironment({
    ...environment,
    ORIGIN_URL: "https://crm.ewaya.com/",
  }), /LOOP/);
  const proxy = createLuminaProxy(async () => new Response("unexpected"));
  const response = await proxy(new Request("https://other.example/api/health"), environment);
  assert.equal(response.status, 421);
});

test("forwards POST method, query, body, content headers and cookies", async () => {
  let captured;
  const proxy = createLuminaProxy(async (request) => {
    captured = request;
    return new Response("created", {
      status: 201,
      headers: { "set-cookie": "crm_session=server; Secure; HttpOnly; Path=/" },
    });
  });
  const response = await proxy(new Request("https://crm.ewaya.com/api/items?view=full", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "crm_csrf=client",
    },
    body: JSON.stringify({ name: "Lumina" }),
  }), environment);
  assert.equal(captured.method, "POST");
  assert.equal(captured.url, "https://origin.crm-internal.example/api/items?view=full");
  assert.equal(captured.headers.get("content-type"), "application/json");
  assert.equal(captured.headers.get("cookie"), "crm_csrf=client");
  assert.deepEqual(await captured.json(), { name: "Lumina" });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /crm_session=server/);
});

test("returns origin 4xx and 5xx status/body unchanged", async () => {
  for (const status of [401, 503]) {
    const proxy = createLuminaProxy(async () => new Response(`origin-${status}`, { status }));
    const response = await proxy(new Request("https://crm.ewaya.com/api/example"), environment);
    assert.equal(response.status, status);
    assert.equal(await response.text(), `origin-${status}`);
  }
});

test("never exposes detailed readiness on the public route", async () => {
  let called = false;
  const proxy = createLuminaProxy(async () => {
    called = true;
    return new Response("unexpected");
  });
  const response = await proxy(
    new Request("https://crm.ewaya.com/api/health?mode=ready"),
    environment,
  );
  assert.equal(response.status, 404);
  assert.equal(called, false);
});
