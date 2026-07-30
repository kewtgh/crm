import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);

export const releaseVersion = String(packageJson.version);

const APP_VERSION_SOURCE = /^export const APP_VERSION = "(\d+\.\d+\.\d+)";\s*$/;
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

export function appVersionFromSource(source) {
  const match = String(source).match(APP_VERSION_SOURCE);
  if (!match) throw new Error("LUMINA_APP_VERSION_SOURCE_INVALID");
  return match[1];
}

export function assertReleaseVersionConsistency({ packageVersion, appVersionSource }) {
  const expectedVersion = String(packageVersion ?? "");
  if (!RELEASE_VERSION.test(expectedVersion)) {
    throw new Error("LUMINA_PACKAGE_VERSION_INVALID");
  }
  const appVersion = appVersionFromSource(appVersionSource);
  if (appVersion !== expectedVersion) {
    throw new Error("LUMINA_RELEASE_VERSION_MISMATCH");
  }
  return expectedVersion;
}
