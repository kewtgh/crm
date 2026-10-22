#!/usr/bin/env node
import { diagnoseTunnel } from "./lib/tunnel-diagnostics.mjs";

// Read-only. Service identity is fixed; credentials and full journal lines are never printed.
const [publicUrl, expectedTunnelId, ...extra] = process.argv.slice(2);
if (extra.length || !publicUrl || !expectedTunnelId) throw new Error("Usage: diagnose-production-tunnel.mjs https://<public-host>/api/health <tunnel-uuid>");
try {
  process.stdout.write(`${JSON.stringify(await diagnoseTunnel({ publicUrl, expectedTunnelId }), null, 2)}\n`);
} catch { process.stderr.write("TUNNEL_DIAGNOSTIC_UNAVAILABLE: verify read access to the Lumina service and its process\n"); process.exitCode = 1; }
