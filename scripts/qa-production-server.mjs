import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const action = process.argv[2];
const evidenceDirectory = path.resolve("work/browser-qa-chromium-1228");
const pidFile = path.join(evidenceDirectory, "server.pid");
const stdoutFile = path.join(evidenceDirectory, "server.stdout.log");
const stderrFile = path.join(evidenceDirectory, "server.stderr.log");

function readPid() {
  if (!fs.existsSync(pidFile)) return null;
  const value = Number(fs.readFileSync(pidFile, "utf8").trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (action === "status") {
  const pid = readPid();
  process.stdout.write(JSON.stringify({ running: isRunning(pid), pid }) + "\n");
  process.exit(0);
}

if (action === "start") {
  const previousPid = readPid();
  if (isRunning(previousPid)) {
    process.stdout.write(JSON.stringify({ started: false, running: true, pid: previousPid }) + "\n");
    process.exit(0);
  }
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const stdout = fs.openSync(stdoutFile, "a");
  const stderr = fs.openSync(stderrFile, "a");
  const child = spawn(
    process.execPath,
    [path.resolve("node_modules/vinext/dist/cli.js"), "start"],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        PORT: process.env.PORT || "3200",
        ALTCHA_HMAC_SECRET: process.env.ALTCHA_HMAC_SECRET
          || "local-browser-qa-altcha-secret-never-use-production",
      },
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    },
  );
  child.unref();
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  fs.writeFileSync(pidFile, String(child.pid));
  process.stdout.write(JSON.stringify({ started: true, running: true, pid: child.pid }) + "\n");
  process.exit(0);
}

if (action === "stop") {
  const pid = readPid();
  if (!isRunning(pid)) {
    if (fs.existsSync(pidFile)) fs.rmSync(pidFile);
    process.stdout.write(JSON.stringify({ stopped: false, running: false, pid }) + "\n");
    process.exit(0);
  }
  process.kill(pid, "SIGTERM");
  if (fs.existsSync(pidFile)) fs.rmSync(pidFile);
  process.stdout.write(JSON.stringify({ stopped: true, running: false, pid }) + "\n");
  process.exit(0);
}

throw new Error("Usage: node scripts/qa-production-server.mjs <start|status|stop>");
