import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PUBLIC_ARTIFACT_ALLOWLIST = Object.freeze(["browser-qa-summary.json"]);
export const privateStageNames = Object.freeze(["configure", "release", "cleanup"]);

// Fail closed on redirected evidence/output directories. No operator-supplied publication paths.
export function evidenceDirectory(root, name) {
  if (!["ci-private", "public-artifacts", "browser-qa-chromium-1243"].includes(name)) {
    throw new Error("CI_EVIDENCE_DIRECTORY_INVALID");
  }
  let directory = path.resolve(root);
  for (const part of ["work", name]) {
    directory = path.join(directory, part);
    try {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("CI_EVIDENCE_DIRECTORY_UNSAFE");
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("CI_EVIDENCE_DIRECTORY_UNSAFE");
      mkdirSync(directory, { mode: 0o700 });
    }
  }
  return directory;
}

export function readPrivateJson(directory, filename) {
  try {
    const file = path.join(directory, filename);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_000_000) return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch { return null; }
}

export function writeEvidenceJson(directory, filename, data) {
  // O_NOFOLLOW is not portable to Windows: exclusive creation prevents following an old link.
  writeFileSync(path.join(directory, filename), JSON.stringify(data, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
}

export function publicQaSummary(report, stage, currentRun = {}) {
  if (currentRun.runId !== undefined && (stage?.runId !== currentRun.runId
    || stage?.runAttempt !== currentRun.runAttempt)) stage = null;
  const result = stage?.stage === "release" && ["PASS", "FAIL"].includes(stage.result)
    ? stage.result : "NOT_RUN";
  const summary = { schemaVersion: 1, browserRevision: 1243, releaseGate: result,
    browserQa: { result: "UNAVAILABLE", checks: 0, errors: 0, warnings: 0 },
    screenshotPublication: "DISABLED" };
  if (result === "NOT_RUN") return summary;
  const started = Date.parse(stage?.startedAt);
  const ended = Date.parse(stage?.completedAt);
  const runAt = Date.parse(report?.runAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || !Number.isFinite(runAt)
    || runAt < started || runAt > ended || ended < started
    || report?.browser !== "ms-playwright/chromium-1243"
    || typeof report?.browserVersion !== "string"
    || !/^\d{1,3}(?:\.\d{1,6}){3}$/.test(report?.browserVersion ?? "")
    || ![report?.pages, report?.errors, report?.warnings].every(value => Array.isArray(value)
      && value.length <= 100_000)) return summary;
  const checks = report.pages.length;
  summary.browserVersion = report.browserVersion;
  summary.browserQa = { result: report.errors.length || !checks ? "FAIL" : "PASS",
    checks, errors: report.errors.length, warnings: report.warnings.length };
  // Never copy URLs, messages, paths, identities, screenshots, env or arbitrary source fields.
  return summary;
}
