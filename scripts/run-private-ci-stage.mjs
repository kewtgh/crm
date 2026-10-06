import { closeSync, openSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { runBounded } from "./lib/bounded-process.mjs";
import { evidenceDirectory, privateStageNames, writeEvidenceJson } from "./lib/public-ci-artifacts.mjs";

const commands = { configure: ["env:configure-local", 600], release: ["release:gate", 1200],
  cleanup: ["ci:stop-local-database", 180] };
const stage = process.argv[2];
let log;
let directory;
let statusFilename;
let startedAt;
const runIdentity = { runId: process.env.GITHUB_RUN_ID ?? null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null };
try {
  if (!privateStageNames.includes(stage) || !process.env.npm_execpath) throw new Error("CI_STAGE_INVALID");
  directory = evidenceDirectory(process.cwd(), "ci-private");
  statusFilename = `${stage}-status.json`;
  for (const filename of [`${stage}.log`, statusFilename]) {
    try { unlinkSync(path.join(directory, filename)); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("CI_STAGE_RESET_FAILED"); }
  }
  log = openSync(path.join(directory, `${stage}.log`), "wx", 0o600);
  let bytes = 0;
  const privateOutput = { write(chunk) {
    if (log === undefined) return;
    const data = Buffer.from(chunk);
    const retained = data.subarray(0, Math.max(0, 64_000_000 - bytes));
    if (retained.length) writeSync(log, retained);
    bytes += retained.length;
  } };
  startedAt = new Date().toISOString();
  const [script, seconds] = commands[stage];
  await runBounded({ command: process.execPath, args: [process.env.npm_execpath, "run", script],
    label: `private-ci-${stage}`, timeoutMs: seconds * 1000, idleTimeoutMs: 180_000,
    stdout: privateOutput, stderr: privateOutput });
  writeEvidenceJson(directory, statusFilename,
    { stage, result: "PASS", startedAt, completedAt: new Date().toISOString(), ...runIdentity });
  process.stdout.write(`CI_PRIVATE_${stage.toUpperCase()}_PASS\n`);
} catch {
  if (directory && statusFilename && startedAt) {
    try { writeEvidenceJson(directory, statusFilename,
      { stage, result: "FAIL", startedAt, completedAt: new Date().toISOString(), ...runIdentity }); } catch {}
  }
  process.stderr.write("CI_PRIVATE_STAGE_FAILED\n");
  process.exitCode = 1;
} finally { if (log !== undefined) { closeSync(log); log = undefined; } }
