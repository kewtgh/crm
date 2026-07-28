import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const directory = path.resolve(import.meta.dirname, "..", "db", "migrations");
const files = (await readdir(directory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
if (!files.length) throw new Error("No migrations found");

const forbidden = [
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
const manifest = [];
for (const name of files) {
  const sql = await readFile(path.join(directory, name), "utf8");
  const violation = forbidden.find((pattern) => pattern.test(sql));
  if (violation) throw new Error(`${name} contains forbidden platform SQL: ${violation}`);
  manifest.push({
    name,
    checksum: createHash("sha256").update(sql).digest("hex"),
  });
}
process.stdout.write(`${JSON.stringify({ migrations: manifest }, null, 2)}\n`);
