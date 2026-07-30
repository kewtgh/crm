import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function verifyPublicHealthConfig({
  environment = process.env,
  readFile = readFileSync,
  root = sourceRoot,
} = {}) {
  const hostname = environment.LUMINA_PUBLIC_HOSTNAME?.trim().toLowerCase();
  if (!hostname
    || hostname.length > 253
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
    throw new Error("LUMINA_PUBLIC_HOSTNAME_MUST_BE_A_DNS_HOSTNAME");
  }

  const caddyPath = environment.LUMINA_CADDYFILE?.trim()
    || path.join(root, "deploy", "caddy", "Caddyfile");
  const tunnelPath = environment.LUMINA_TUNNEL_CONFIG_FILE?.trim()
    || path.join(root, "deploy", "cloudflare-tunnel", "config.yml.example");
  const caddy = readFile(caddyPath, "utf8");
  const tunnel = readFile(tunnelPath, "utf8");
  const escapedHostname = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (!/^http:\/\/127\.0\.0\.1:3211 \{/m.test(caddy)
    || !/@public_host host \{\$LUMINA_PUBLIC_HOSTNAME\}/.test(caddy)
    || !/@detailed_readiness \{[\s\S]*path \/api\/health[\s\S]*query mode=ready[\s\S]*\}[\s\S]*respond @detailed_readiness 404[\s\S]*reverse_proxy 127\.0\.0\.1:3200/.test(caddy)
    || !/handle @public_host \{[\s\S]*reverse_proxy 127\.0\.0\.1:3200[\s\S]*\}\s*\n\s*respond 404/.test(caddy)
    || !/header_up -Forwarded/.test(caddy)
    || !/header_up -X-Forwarded-\*/.test(caddy)
    || !/header_up -X-Real-IP/.test(caddy)
    || !/header_up X-Forwarded-For \{http\.request\.header\.CF-Connecting-IP\}/.test(caddy)
    || !/header_up X-Real-IP \{http\.request\.header\.CF-Connecting-IP\}/.test(caddy)
    || !/header_up X-Forwarded-Host \{\$LUMINA_PUBLIC_HOSTNAME\}/.test(caddy)
    || !/header_up X-Forwarded-Proto https/.test(caddy)
    || /Origin-Auth|ORIGIN_AUTH_SECRET/.test(caddy)) {
    throw new Error("CADDY_TUNNEL_CONTRACT_INVALID");
  }
  if (!new RegExp(`^\\s*- hostname:\\s*${escapedHostname}\\s*$`, "m").test(tunnel)
    || !/^\s*service:\s*http:\/\/127\.0\.0\.1:3211\s*$/m.test(tunnel)
    || !new RegExp(`^\\s*httpHostHeader:\\s*${escapedHostname}\\s*$`, "m").test(tunnel)
    || !/\n\s*-\s*service:\s*http_status:404\s*$/.test(tunnel)) {
    throw new Error("CLOUDFLARE_TUNNEL_INGRESS_INVALID");
  }

  return {
    hostname,
    publicHealthUrl: `https://${hostname}/api/health`,
  };
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  const verified = verifyPublicHealthConfig();
  process.stdout.write(
    `[public-health-config] valid Cloudflare Tunnel route for ${verified.publicHealthUrl}; no request sent.\n`,
  );
}
