import path from "node:path";

function boundedInteger(value, {
  name,
  minimum,
  maximum,
  fallback,
}) {
  const source = String(value ?? fallback).trim();
  if (!/^\d+$/.test(source)) {
    throw new Error(`${name}_MUST_BE_${minimum}_TO_${maximum}`);
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name}_MUST_BE_${minimum}_TO_${maximum}`);
  }
  return parsed;
}

export function backupRetentionPolicy(environment = process.env) {
  return {
    remoteRetentionDays: boundedInteger(environment.BACKUP_RETENTION_DAYS, {
      name: "BACKUP_RETENTION_DAYS",
      minimum: 14,
      maximum: 365,
      fallback: 30,
    }),
    localRetentionHours: boundedInteger(environment.BACKUP_LOCAL_RETENTION_HOURS, {
      name: "BACKUP_LOCAL_RETENTION_HOURS",
      minimum: 24,
      maximum: 168,
      fallback: 48,
    }),
  };
}

export function matchingEncryptedObjectsPath(encryptedDatabasePath) {
  const filename = path.basename(encryptedDatabasePath);
  const match = /^lumina-crm-(\d{8}T\d{6}Z)\.dump\.enc$/.exec(filename);
  if (!match) throw new Error("RESTORE_DATABASE_BACKUP_NAME_INVALID");
  return path.join(
    path.dirname(encryptedDatabasePath),
    `lumina-crm-${match[1]}.objects.tar.enc`,
  );
}
