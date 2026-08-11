import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const defaultMigrationDirectory = path.resolve(import.meta.dirname, "..", "db", "migrations");

export const forbiddenPlatformSql = [
  /\bauth\.[a-z_]/i,
  /\bauth\.users\b/i,
  /\bauth\.uid\(/i,
  /\bauth\.jwt\(/i,
  /\bauth\.role\(/i,
  /\bstorage\./i,
  /\bservice_role\b(?=\s*;)/i,
  /\bpg_cron\b/i,
  /\bcron\./i,
];

export async function discoverMigrationNames(directory = defaultMigrationDirectory) {
  return (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
}

export function validateMigrationManifest(discoveredNames, manifest) {
  if (!discoveredNames.length) throw new Error("No migrations found");
  if (new Set(discoveredNames).size !== discoveredNames.length) {
    throw new Error("Duplicate discovered migration names");
  }
  const manifestNames = manifest.map(({ name }) => name);
  if (new Set(manifestNames).size !== manifestNames.length) {
    throw new Error("Duplicate migration names in checksum manifest");
  }
  for (const entry of manifest) {
    if (!/^[a-f0-9]{64}$/.test(entry.checksum)) {
      throw new Error(`${entry.name} has an invalid SHA-256 checksum`);
    }
  }
  if (
    discoveredNames.length !== manifestNames.length
    || discoveredNames.some((name, index) => name !== manifestNames[index])
  ) {
    throw new Error("Migration checksum manifest does not exactly match discovered migrations");
  }
  return true;
}

export async function verifyMigrationDirectory(directory = defaultMigrationDirectory) {
  const files = await discoverMigrationNames(directory);
  const manifest = [];
  for (const name of files) {
    const sql = await readFile(path.join(directory, name), "utf8");
    const violation = forbiddenPlatformSql.find((pattern) => pattern.test(sql));
    if (violation) throw new Error(`${name} contains forbidden platform SQL: ${violation}`);
    manifest.push({
      name,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  validateMigrationManifest(files, manifest);
  return { migrations: manifest };
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  const result = await verifyMigrationDirectory();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
