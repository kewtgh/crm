import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);

export const releaseVersion = String(packageJson.version);

const APP_VERSION_SOURCE = /^export const APP_VERSION = "(\d+\.\d+\.\d+)";\s*$/;
const README_RELEASE_SOURCE = /^Current release candidate: \*\*v(\d+\.\d+\.\d+)\*\*\s*$/m;
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

export function appVersionFromSource(source) {
  const match = String(source).match(APP_VERSION_SOURCE);
  if (!match) throw new Error("LUMINA_APP_VERSION_SOURCE_INVALID");
  return match[1];
}

export function readmeReleaseVersion(source) {
  const match = String(source).match(README_RELEASE_SOURCE);
  if (!match) throw new Error("LUMINA_README_RELEASE_VERSION_INVALID");
  return match[1];
}

export function assertReleaseVersionConsistency({ packageVersion, appVersionSource, readmeSource }) {
  const expectedVersion = String(packageVersion ?? "");
  if (!RELEASE_VERSION.test(expectedVersion)) {
    throw new Error("LUMINA_PACKAGE_VERSION_INVALID");
  }
  const appVersion = appVersionFromSource(appVersionSource);
  if (appVersion !== expectedVersion) {
    throw new Error("LUMINA_RELEASE_VERSION_MISMATCH");
  }
  if (readmeSource !== undefined && readmeReleaseVersion(readmeSource) !== expectedVersion) {
    throw new Error("LUMINA_README_RELEASE_VERSION_MISMATCH");
  }
  return expectedVersion;
}
