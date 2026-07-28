import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceDirectory = path.join(root, "archive", "supabase", "migrations");
const targetDirectory = path.join(root, "db", "migrations");
const generatedHeader = [
  "-- Generated from the preserved pre-exit migration history.",
  "-- Supabase platform primitives were replaced with self-hosted PostgreSQL primitives.",
  "",
].join("\n");

function removeStorage(sql) {
  return sql
    .replace(
      /insert\s+into\s+storage\.buckets[\s\S]*?allowed_mime_types\s*=\s*excluded\.allowed_mime_types\s*;\s*/gi,
      "-- Object bucket provisioning moved to the application ObjectStore.\n",
    )
    .replace(
      /drop\s+policy\s+if\s+exists\s+[^;]+?\s+on\s+storage\.objects\s*;\s*/gi,
      "",
    )
    .replace(
      /create\s+policy\s+[\s\S]*?\s+on\s+storage\.objects[\s\S]*?;\s*/gi,
      "",
    )
    .replace(
      /grant\s+[\s\S]*?\s+on\s+storage\.objects\s+to\s+authenticated\s*;\s*/gi,
      "",
    );
}

function replaceDatabaseRoles(sql) {
  return sql
    .replace(/\bauthenticated\b/gi, "crm_app")
    .replace(/\banon\b/gi, "crm_system")
    .replace(/\bto\s+service_role\b/gi, "to crm_system, crm_worker")
    .replace(/\bfrom\s+service_role\b/gi, "from crm_system, crm_worker")
    .replace(/,\s*service_role\b/gi, ", crm_system, crm_worker");
}

function transform(sql, fileName) {
  if (fileName === "202607170004_reminder_scheduler.sql") {
    return `${generatedHeader}-- Scheduling is owned by the systemd worker timer.\n`;
  }
  let result = removeStorage(sql);
  result = result
    .replace(/\bauth\.users\b/gi, "app_auth.accounts")
    .replace(/\bauth\.mfa_factors\b/gi, "app_auth.totp_factors")
    .replace(/\bauth\.uid\(\)/gi, "app_auth.current_user_id()")
    .replace(/\bauth\.jwt\(\)/gi, "app_auth.current_claims()")
    .replace(/\bauth\.role\(\)/gi, "app_auth.current_db_role()")
    .replace(/\bf\.status\s*=\s*'verified'/gi, "f.status = 'VERIFIED'")
    .replace(
      /set\s+search_path\s*=\s*public(?:\s*,\s*auth)?/gi,
      "set search_path=public,app_auth,extensions",
    )
    .replace(
      /current_user\s+not\s+in\s*\(\s*'postgres'\s*,\s*'service_role'\s*\)/gi,
      "app_auth.current_db_role() <> 'service_role'",
    );
  result = replaceDatabaseRoles(result);
  return `${generatedHeader}set search_path = public, extensions;\n\n${result.trim()}\n`;
}

await mkdir(targetDirectory, { recursive: true });
const sourceFiles = (await readdir(sourceDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

for (const fileName of sourceFiles) {
  const source = await readFile(path.join(sourceDirectory, fileName), "utf8");
  await writeFile(path.join(targetDirectory, fileName), transform(source, fileName), "utf8");
}

process.stdout.write(`Generated ${sourceFiles.length} standard PostgreSQL migrations.\n`);
