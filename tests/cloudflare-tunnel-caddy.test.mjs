import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyPublicHealthConfig } from "../scripts/verify-public-health-config.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (value) => readFile(path.join(sourceRoot, value), "utf8");

test("Caddy proxies public liveness and rejects public detailed readiness", async () => {
  const caddy = await source("deploy/caddy/Caddyfile");
  assert.match(caddy, /^http:\/\/127\.0\.0\.1:3211 \{/m);
  assert.match(caddy, /@public_host host \{\$LUMINA_PUBLIC_HOSTNAME\}/);
  assert.match(
    caddy,
    /@detailed_readiness \{[\s\S]*path \/api\/health[\s\S]*query mode=ready[\s\S]*\}[\s\S]*respond @detailed_readiness 404[\s\S]*reverse_proxy 127\.0\.0\.1:3200/,
  );
});

test("Caddy returns 404 for every Host outside the configured public hostname", async () => {
  const caddy = await source("deploy/caddy/Caddyfile");
  assert.match(
    caddy,
    /handle @public_host \{[\s\S]*reverse_proxy 127\.0\.0\.1:3200[\s\S]*\}\s*\n\s*respond 404/,
  );
});

test("Caddy discards spoofable forwarding headers and rebuilds client IP from Cloudflare", async () => {
  const caddy = await source("deploy/caddy/Caddyfile");
  assert.match(caddy, /header_up -Forwarded/);
  assert.match(caddy, /header_up -X-Forwarded-\*/);
  assert.match(caddy, /header_up -X-Real-IP/);
  assert.match(caddy, /header_up X-Forwarded-For \{http\.request\.header\.CF-Connecting-IP\}/);
  assert.match(caddy, /header_up X-Real-IP \{http\.request\.header\.CF-Connecting-IP\}/);
  assert.match(caddy, /header_up X-Forwarded-Host \{\$LUMINA_PUBLIC_HOSTNAME\}/);
  assert.match(caddy, /header_up X-Forwarded-Proto https/);
  assert.doesNotMatch(caddy, /Origin-Auth|ORIGIN_AUTH_SECRET/);
});

test("Tunnel ingress targets only loopback Caddy with matching Host and a 404 catch-all", async () => {
  const tunnel = await source("deploy/cloudflare-tunnel/config.yml.example");
  assert.match(
    tunnel,
    /- hostname: crm\.example\.invalid[\s\S]*service: http:\/\/127\.0\.0\.1:3211[\s\S]*httpHostHeader: crm\.example\.invalid/,
  );
  assert.match(tunnel, /- service: http_status:404/);
});

test("deployment examples require only the configured public hostname", async () => {
  const [deployEnvironment, caddyEnvironment] = await Promise.all([
    source("deploy/deploy.env.example"),
    source("deploy/caddy/caddy.env.example"),
  ]);
  assert.match(deployEnvironment, /^LUMINA_PUBLIC_HOSTNAME=crm\.example\.invalid$/m);
  assert.match(caddyEnvironment, /^LUMINA_PUBLIC_HOSTNAME=crm\.example\.invalid$/m);
  assert.doesNotMatch(
    `${deployEnvironment}\n${caddyEnvironment}`,
    /LUMINA_PUBLIC_HEALTH_URL|LUMINA_ORIGIN_|AUTH_SECRET/,
  );
});

test("deploy runner requires public Tunnel liveness without any origin secret", async () => {
  const runner = await source("scripts/deploy-production-runner.mjs");
  const acceptance = runner.match(
    /async function acceptRuntime[\s\S]+?\n\}\n\nasync function prepareBuilderAndCapacity/,
  )?.[0] ?? "";
  assert.match(acceptance, /waitForContainerHealth\(envFile, "postgres"/);
  assert.match(acceptance, /loopback readiness/);
  assert.match(acceptance, /Cloudflare Tunnel public liveness/);
  assert.match(acceptance, /`https:\/\/\$\{publicHostname\(\)\}\/api\/health`/);
  assert.match(
    runner,
    /try \{[\s\S]+verifyTargetControllerSource[\s\S]+publicHostname\(\);\s*persist\(\);[\s\S]+runProductionReleaseWorkflow/,
  );
  assert.match(
    runner,
    /acceptRuntime,[\s\S]*atomicWrite\(composeEnvPath,[\s\S]*atomicWrite\(acceptedPath,/,
  );
  assert.doesNotMatch(
    runner,
    /LUMINA_ORIGIN_ENV_FILE|LUMINA_ORIGIN_HEALTH_URL|LUMINA_ORIGIN_AUTH_SECRET|authenticated origin/,
  );
});

test("one-click deployment dry-run validates Tunnel assets and its public gate", async () => {
  const controller = await source("scripts/deploy-production.mjs");
  assert.match(controller, /deploy", "cloudflare-tunnel", "config\.yml\.example"/);
  assert.match(controller, /mandatory Tunnel public liveness/);
  assert.match(controller, /loopback Caddy Tunnel listener/);
  assert.doesNotMatch(controller, /cloudflare-worker|origin authentication|Worker no-cache/);
});

test("Tunnel configuration verification needs no origin hostname or secret", () => {
  const result = verifyPublicHealthConfig({
    environment: { LUMINA_PUBLIC_HOSTNAME: "crm.example.invalid" },
  });
  assert.equal(result.publicHealthUrl, "https://crm.example.invalid/api/health");
});

test("Tunnel configuration verification rejects weakened installed edge contracts", async () => {
  const [caddy, tunnel] = await Promise.all([
    source("deploy/caddy/Caddyfile"),
    source("deploy/cloudflare-tunnel/config.yml.example"),
  ]);
  const verifyWith = (caddySource, tunnelSource = tunnel) => verifyPublicHealthConfig({
    environment: { LUMINA_PUBLIC_HOSTNAME: "crm.example.invalid" },
    readFile: (file) => file.endsWith("Caddyfile") ? caddySource : tunnelSource,
  });
  assert.throws(
    () => verifyWith(caddy.replace("respond @detailed_readiness 404", "")),
    /CADDY_TUNNEL_CONTRACT_INVALID/,
  );
  assert.throws(
    () => verifyWith(caddy.replace("header_up -X-Forwarded-*", "")),
    /CADDY_TUNNEL_CONTRACT_INVALID/,
  );
  assert.throws(
    () => verifyWith(caddy, tunnel.replace(/- service: http_status:404\s*$/, "")),
    /CLOUDFLARE_TUNNEL_INGRESS_INVALID/,
  );
});
