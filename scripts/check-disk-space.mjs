import { statfs } from "node:fs/promises";
import path from "node:path";

const rawThreshold = process.env.DISK_FREE_PERCENT_THRESHOLD?.trim() ?? "15";
if (!/^\d+$/.test(rawThreshold)) throw new Error("DISK_FREE_PERCENT_THRESHOLD_INVALID");
const threshold = Number(rawThreshold);
if (!Number.isSafeInteger(threshold) || threshold < 5 || threshold > 50) {
  throw new Error("DISK_FREE_PERCENT_THRESHOLD_MUST_BE_5_TO_50");
}
const configuredPaths = (process.env.DISK_MONITOR_PATHS
  ?? "/,/var/lib/lumina-crm/docker,/var/lib/lumina-crm/deployments")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!configuredPaths.length) throw new Error("DISK_MONITOR_PATHS_REQUIRED");
if (configuredPaths.some((value) => !path.isAbsolute(value))) {
  throw new Error("DISK_MONITOR_PATHS_MUST_BE_ABSOLUTE");
}

const filesystems = [];
for (const monitoredPath of configuredPaths) {
  const status = await statfs(monitoredPath);
  const totalBytes = Number(status.blocks) * Number(status.bsize);
  const availableBytes = Number(status.bavail) * Number(status.bsize);
  const freePercent = totalBytes > 0 ? availableBytes / totalBytes * 100 : 0;
  filesystems.push({
    path: monitoredPath,
    totalBytes,
    availableBytes,
    freePercent: Number(freePercent.toFixed(2)),
  });
}

const unhealthy = filesystems.filter((filesystem) => filesystem.freePercent < threshold);
const payload = {
  event: "lumina-disk-space",
  status: unhealthy.length ? "FAILED" : "SUCCEEDED",
  thresholdPercent: threshold,
  checkedAt: new Date().toISOString(),
  filesystems,
};
const endpoint = process.env.DISK_NOTIFICATION_WEBHOOK_URL?.trim()
  || process.env.BACKUP_NOTIFICATION_WEBHOOK_URL?.trim();
if (endpoint && unhealthy.length) {
  await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...((process.env.DISK_NOTIFICATION_WEBHOOK_TOKEN
        || process.env.BACKUP_NOTIFICATION_WEBHOOK_TOKEN)
        ? {
            authorization: `Bearer ${
              process.env.DISK_NOTIFICATION_WEBHOOK_TOKEN
              || process.env.BACKUP_NOTIFICATION_WEBHOOK_TOKEN
            }`,
          }
        : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
}
process.stdout.write(`${JSON.stringify(payload)}\n`);
if (unhealthy.length) process.exitCode = 1;
