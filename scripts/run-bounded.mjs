import { existsSync } from "node:fs";
import path from "node:path";
import { boundedSeconds, runBounded } from "./lib/bounded-process.mjs";

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("Usage: node scripts/run-bounded.mjs [options] -- <command> [args...]");
  }
  const options = { label: "command", timeout: "300", idle: "120", heartbeat: "15" };
  for (let index = 0; index < separator; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === "--label") options.label = value;
    else if (key === "--timeout-seconds") options.timeout = value;
    else if (key === "--idle-seconds") options.idle = value;
    else if (key === "--heartbeat-seconds") options.heartbeat = value;
    else throw new Error(`Unknown option ${key}`);
  }
  return { options, command: argv[separator + 1], args: argv.slice(separator + 2) };
}

function normalizedCommand(command, args) {
  if (command === "node") return { command: process.execPath, args };
  if (command === "npm") {
    const npmCli = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ].find((candidate) => candidate && existsSync(candidate));
    if (!npmCli) throw new Error("Could not locate npm-cli.js for the bounded npm command");
    return { command: process.execPath, args: [npmCli, ...args] };
  }
  return { command, args };
}

const parsed = parseArguments(process.argv.slice(2));
const timeoutSeconds = boundedSeconds(parsed.options.timeout, 300, "timeout");
const idleSeconds = boundedSeconds(parsed.options.idle, 120, "idle timeout");
const heartbeatSeconds = boundedSeconds(parsed.options.heartbeat, 15, "heartbeat");
if (idleSeconds > timeoutSeconds) throw new Error("idle timeout cannot exceed the total timeout");
const target = normalizedCommand(parsed.command, parsed.args);

process.stdout.write(
  `[watchdog] ${parsed.options.label}: total=${timeoutSeconds}s, idle=${idleSeconds}s, `
  + `heartbeat=${heartbeatSeconds}s\n`,
);
await runBounded({
  ...target,
  label: parsed.options.label,
  timeoutMs: timeoutSeconds * 1_000,
  idleTimeoutMs: idleSeconds * 1_000,
  heartbeatMs: heartbeatSeconds * 1_000,
});
