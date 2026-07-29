import { access, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { decryptBackup } from "./lib/backup-crypto.mjs";
import { matchingEncryptedObjectsPath } from "./lib/backup-policy.mjs";

async function resolveEncryptedPath() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  const localRoot = process.env.BACKUP_LOCAL_ROOT?.trim();
  if (!localRoot || !path.isAbsolute(localRoot)) {
    throw new Error(
      "Usage: npm run db:restore:test -- <encrypted-backup-file> "
      + "or configure absolute BACKUP_LOCAL_ROOT",
    );
  }
  const candidates = [];
  for (const entry of await readdir(localRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^lumina-crm-\d{8}T\d{6}Z\.dump\.enc$/.test(entry.name)) continue;
    const candidate = path.join(localRoot, entry.name);
    candidates.push({ candidate, modified: (await stat(candidate)).mtimeMs });
  }
  candidates.sort((left, right) => right.modified - left.modified);
  if (!candidates[0]) throw new Error("RESTORE_TEST_BACKUP_NOT_FOUND");
  return candidates[0].candidate;
}

const encryptedPath = await resolveEncryptedPath();
const adminUrl = process.env.RESTORE_DATABASE_ADMIN_URL?.trim()
  || process.env.DATABASE_ADMIN_URL?.trim();
if (!adminUrl) throw new Error("RESTORE_DATABASE_ADMIN_URL_OR_DATABASE_ADMIN_URL_REQUIRED");
const encryptedObjectsPath = matchingEncryptedObjectsPath(encryptedPath);
const requireLocalObjects = /^(1|true|yes|on)$/i.test(
  process.env.RESTORE_REQUIRE_LOCAL_OBJECTS ?? "false",
);
const verifyLocalObjects = await access(encryptedObjectsPath)
  .then(() => true)
  .catch(() => false);
if (requireLocalObjects && !verifyLocalObjects) {
  throw new Error("RESTORE_MATCHING_OBJECT_BACKUP_NOT_FOUND");
}
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumina-crm-restore-"));
const dumpPath = path.join(temporaryRoot, "database.dump");
const objectsArchivePath = path.join(temporaryRoot, "objects.tar");
const databaseName = `lumina_restore_${Date.now()}_${process.pid}`;
if (!/^lumina_restore_\d+_\d+$/.test(databaseName)) throw new Error("RESTORE_DATABASE_NAME_INVALID");
const admin = new pg.Client({ connectionString: adminUrl, application_name: "lumina-restore-test" });
let adminConnected = false;
let restoreDatabaseCreated = false;

function run(command, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", quiet ? "ignore" : "inherit", "inherit"],
      env: process.env,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with ${code}`)));
  });
}

try {
  await decryptBackup(encryptedPath, dumpPath);
  await admin.connect();
  adminConnected = true;
  await admin.query(`create database "${databaseName}"`);
  restoreDatabaseCreated = true;
  const restoreUrl = new URL(adminUrl);
  restoreUrl.pathname = `/${databaseName}`;
  await run(process.env.PG_RESTORE_COMMAND || "pg_restore", [
    "--exit-on-error",
    "--no-owner",
    "--no-acl",
    "--dbname",
    restoreUrl.toString(),
    dumpPath,
  ]);
  if (verifyLocalObjects) {
    await decryptBackup(encryptedObjectsPath, objectsArchivePath);
    await run(process.env.TAR_COMMAND || "tar", [
      "--list",
      "--file",
      objectsArchivePath,
    ], { quiet: true });
  }
  const restored = new pg.Client({
    connectionString: restoreUrl.toString(),
    application_name: "lumina-restore-verification",
  });
  await restored.connect();
  try {
    const verification = await restored.query(
      `select
        to_regclass('app_auth.accounts') is not null as auth_ready,
        to_regclass('public.workspaces') is not null as crm_ready,
        (select count(*) from app_meta.schema_migrations) > 0 as migrations_ready`,
    );
    if (!verification.rows[0]?.auth_ready
      || !verification.rows[0]?.crm_ready
      || !verification.rows[0]?.migrations_ready) {
      throw new Error("RESTORE_VERIFICATION_FAILED");
    }
  } finally {
    await restored.end();
  }
  process.stdout.write(
    `[db:restore:test] verified encrypted database backup in ${databaseName}`
    + `${verifyLocalObjects ? " and its matching local-object archive" : ""}.\n`,
  );
} finally {
  if (adminConnected && restoreDatabaseCreated) {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
      [databaseName],
    ).catch(() => undefined);
    await admin.query(`drop database if exists "${databaseName}"`).catch(() => undefined);
  }
  if (adminConnected) await admin.end().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}
