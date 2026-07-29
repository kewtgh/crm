import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { encryptBackup } from "./lib/backup-crypto.mjs";

const required = [
  "BACKUP_DATABASE_URL",
  "BACKUP_LOCAL_ROOT",
  "BACKUP_ENCRYPTION_KEY",
  "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_REGION",
  "BACKUP_S3_BUCKET",
  "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY",
];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error(`Missing backup variables: ${missing.join(", ")}`);
const localRoot = path.resolve(process.env.BACKUP_LOCAL_ROOT);
if (!path.isAbsolute(process.env.BACKUP_LOCAL_ROOT)) {
  throw new Error("BACKUP_LOCAL_ROOT_MUST_BE_ABSOLUTE");
}
const retentionDays = Math.min(365, Math.max(14, Number(process.env.BACKUP_RETENTION_DAYS ?? 30)));
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const finalName = `lumina-crm-${timestamp}.dump.enc`;
const finalPath = path.join(localRoot, finalName);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumina-crm-backup-"));
const dumpPath = path.join(temporaryRoot, "database.dump");
const backupLocalObjects = /^(1|true|yes|on)$/i.test(process.env.BACKUP_LOCAL_OBJECTS ?? "false");
const objectsRoot = process.env.BACKUP_OBJECTS_ROOT?.trim();
if (backupLocalObjects && (!objectsRoot || !path.isAbsolute(objectsRoot))) {
  throw new Error("BACKUP_OBJECTS_ROOT_MUST_BE_ABSOLUTE_WHEN_LOCAL_OBJECT_BACKUP_IS_ENABLED");
}
const objectsArchivePath = path.join(temporaryRoot, "objects.tar");
const objectsFinalName = `lumina-crm-${timestamp}.objects.tar.enc`;
const objectsFinalPath = path.join(localRoot, objectsFinalName);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function notify(status, details) {
  const endpoint = process.env.BACKUP_NOTIFICATION_WEBHOOK_URL?.trim();
  if (!endpoint) return;
  await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.BACKUP_NOTIFICATION_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${process.env.BACKUP_NOTIFICATION_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      event: "lumina-postgresql-backup",
      status,
      checkedAt: new Date().toISOString(),
      ...details,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

try {
  await mkdir(localRoot, { recursive: true, mode: 0o700 });
  await run(process.env.PG_DUMP_COMMAND || "pg_dump", [
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-acl",
    "--file",
    dumpPath,
    process.env.BACKUP_DATABASE_URL,
  ]);
  await encryptBackup(dumpPath, finalPath);
  const encrypted = await stat(finalPath);
  const client = new S3Client({
    endpoint: process.env.BACKUP_S3_ENDPOINT,
    region: process.env.BACKUP_S3_REGION,
    forcePathStyle: /^(1|true|yes|on)$/i.test(process.env.BACKUP_S3_FORCE_PATH_STYLE ?? "true"),
    credentials: {
      accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY,
    },
  });
  const upload = (key, file, size, format) => client.send(new PutObjectCommand({
    Bucket: process.env.BACKUP_S3_BUCKET,
    Key: key,
    Body: createReadStream(file),
    ContentLength: size,
    ContentType: "application/octet-stream",
    Metadata: { encryption: "aes-256-gcm", format },
  }));
  const datePrefix = new Date().toISOString().slice(0, 10);
  const objectKey = `postgresql/${datePrefix}/${finalName}`;
  await upload(objectKey, finalPath, encrypted.size, "pg-dump-custom");
  let objects = null;
  if (backupLocalObjects) {
    await run(process.env.TAR_COMMAND || "tar", [
      "--create",
      "--file",
      objectsArchivePath,
      "--directory",
      objectsRoot,
      ".",
    ]);
    await encryptBackup(objectsArchivePath, objectsFinalPath);
    const encryptedObjects = await stat(objectsFinalPath);
    const objectsKey = `objects/${datePrefix}/${objectsFinalName}`;
    await upload(objectsKey, objectsFinalPath, encryptedObjects.size, "tar");
    objects = { objectKey: objectsKey, bytes: encryptedObjects.size };
  }

  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (const entry of await readdir(localRoot, { withFileTypes: true })) {
    if (!entry.isFile()
      || !/^lumina-crm-\d{8}T\d{6}Z\.(?:dump|objects\.tar)\.enc$/.test(entry.name)) continue;
    const candidate = path.join(localRoot, entry.name);
    if ((await stat(candidate)).mtimeMs < cutoff) await rm(candidate, { force: true });
  }
  await notify("SUCCEEDED", { objectKey, bytes: encrypted.size, objects, retentionDays });
  process.stdout.write(
    `[db:backup] uploaded encrypted database${objects ? " and local objects" : ""} backup (${encrypted.size} database bytes).\n`,
  );
} catch (error) {
  await notify("FAILED", {
    error: String(error instanceof Error ? error.message : error).slice(0, 500),
  });
  throw error;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
