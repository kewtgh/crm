import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function tunnelErrorCategory(text) {
  if (/TLS|handshake|certificate/i.test(text)) return "TUNNEL_TLS_FAILED";
  if (/timeout|timed out/i.test(text)) return "TUNNEL_TIMEOUT";
  if (/refused|unreachable|reset|EOF/i.test(text)) return "TUNNEL_CONNECTION_FAILED";
  if (/error|ERR|failed/i.test(text)) return "TUNNEL_ERROR_UNCLASSIFIED";
  return "NONE_OBSERVED";
}

export function ownedListeningPorts(tables, socketInodes) {
  return [...new Set(tables.flatMap(table => table.split("\n").flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (fields[3] !== "0A" || !socketInodes.has(fields[9])) return [];
    const [address, port] = fields[1].split(":");
    // Never probe a remote/listening-all address; access only the local socket's port.
    if (!["0100007F", "00000000", "00000000000000000000000000000000", "00000000000000000000000001000000"].includes(address)) return [];
    return [parseInt(port, 16)];
  })))];
}

export async function diagnoseTunnel({ publicUrl, expectedTunnelId,
  command = async (binary, args) => (await execute(binary, args, { timeout: 5_000, maxBuffer: 256 * 1024 })).stdout,
  read = file => readFile(file, "utf8"), list = readdir, link = readlink, fetchResponse = fetch } = {}) {
  const service = "cloudflared-lumina.service";
  if (expectedTunnelId && !UUID.test(expectedTunnelId)) throw new Error("TUNNEL_ID_INVALID");
  const output = await command("systemctl", ["show", service, "--property=ActiveState,SubState,NRestarts,MainPID,User"]);
  const properties = Object.fromEntries(output.trim().split("\n").map(line => line.split("=")));
  const result = { service, activeState: properties.ActiveState, subState: properties.SubState,
    restartCount: Number(properties.NRestarts), processRunning: false, tunnelId: null,
    registeredEdgeConnections: null, connectionState: "UNKNOWN", publicHttp: "UNKNOWN", recentError: "UNKNOWN" };
  const pid = properties.MainPID;
  if (/^[1-9]\d*$/.test(pid ?? "")) {
    try {
      const executable = await link(`/proc/${pid}/exe`);
      const cgroup = await read(`/proc/${pid}/cgroup`);
      if (!executable.endsWith("/cloudflared") || !cgroup.includes(`/${service}`)) throw new Error("PROCESS_IDENTITY_UNVERIFIED");
      result.processRunning = true;
      const journal = await command("journalctl", ["--unit", service, `_PID=${pid}`, "--boot", "--lines=80", "--no-pager", "--output=cat"]);
      const identity = await command("journalctl", ["--unit", service, `_PID=${pid}`, "--boot",
        "--grep=tunnelID=", "--lines=1", "--no-pager", "--output=cat"]);
      result.tunnelId = identity.match(/tunnelID=([0-9a-f-]{36})/i)?.[1]?.toLowerCase() ?? null;
      result.recentError = tunnelErrorCategory(journal);
      if (expectedTunnelId && result.tunnelId !== expectedTunnelId.toLowerCase()) throw new Error("TUNNEL_IDENTITY_UNVERIFIED");
      const socketInodes = new Set();
      for (const fd of await list(`/proc/${pid}/fd`)) {
        const inode = (await link(`/proc/${pid}/fd/${fd}`).catch(() => "")).match(/^socket:\[(\d+)\]$/)?.[1];
        if (inode) socketInodes.add(inode);
      }
      const ports = ownedListeningPorts(await Promise.all(["tcp", "tcp6"].map(name => read(`/proc/${pid}/net/${name}`))), socketInodes);
      for (const port of ports.slice(0, 16)) {
        try {
          const response = await fetchResponse(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(1_000), redirect: "manual" });
          if (response.status !== 200) { await response.body?.cancel(); continue; }
          const text = await response.text();
          if (text.length > 256 * 1024) continue;
          const values = [...text.matchAll(/^cloudflared_tunnel_ha_connections(?:\{[^\n]*\})?\s+(\d+(?:\.\d+)?)$/gm)].map(match => Number(match[1]));
          if (values.length) {
            result.registeredEdgeConnections = values.reduce((sum, value) => sum + value, 0);
            result.connectionState = result.registeredEdgeConnections > 0 ? "CONNECTED" : "DISCONNECTED";
            break;
          }
        } catch { /* An owned socket may be IPv6-only or not HTTP. */ }
      }
      // PID reuse/restart during collection invalidates the snapshot.
      const after = await command("systemctl", ["show", service, "--property=MainPID", "--value"]);
      if (after.trim() !== pid) throw new Error("TUNNEL_PROCESS_CHANGED");
    } catch {
      result.connectionState = "UNKNOWN";
      result.registeredEdgeConnections = null;
      result.recentError = "TUNNEL_DIAGNOSTIC_ACCESS_OR_IDENTITY_UNVERIFIED";
    }
  }
  if (publicUrl) {
    try {
      const url = new URL(publicUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/api/health" || url.search) throw new Error("PUBLIC_URL_INVALID");
      const response = await fetchResponse(url, { signal: AbortSignal.timeout(5_000), redirect: "manual" });
      result.publicHttp = response.status;
      await response.body?.cancel();
    } catch { result.publicHttp = "PUBLIC_TRANSPORT_FAILED"; }
  }
  return result;
}
