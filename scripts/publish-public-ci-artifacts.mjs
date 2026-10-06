import { unlinkSync } from "node:fs";
import path from "node:path";
import { evidenceDirectory, PUBLIC_ARTIFACT_ALLOWLIST, publicQaSummary,
  readPrivateJson, writeEvidenceJson } from "./lib/public-ci-artifacts.mjs";

try {
  const root = process.cwd();
  const output = evidenceDirectory(root, "public-artifacts");
  const filename = PUBLIC_ARTIFACT_ALLOWLIST[0];
  // Remove stale summary before any parse, including failed-run publication.
  try { unlinkSync(path.join(output, filename)); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("CI_PUBLIC_ARTIFACT_RESET_FAILED"); }
  const report = readPrivateJson(evidenceDirectory(root, "browser-qa-chromium-1243"), "report.json");
  const stage = readPrivateJson(evidenceDirectory(root, "ci-private"), "release-status.json");
  writeEvidenceJson(output, filename, publicQaSummary(report, stage,
    { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT }));
  process.stdout.write("CI_PUBLIC_ARTIFACTS_READY\n");
} catch {
  process.stderr.write("CI_PUBLIC_ARTIFACT_PUBLICATION_FAILED\n");
  process.exitCode = 1;
}
