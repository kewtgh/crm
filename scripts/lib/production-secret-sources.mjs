import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const LUMINA_CONFIGURATION_ROOT = "/etc/lumina-crm";
export const LUMINA_SECRET_SOURCES_ROOT = "/etc/lumina-crm/secrets";
export const LUMINA_REQUIRED_SECRET_SOURCE_FILES = Object.freeze([
  "production.env",
  "worker.env",
  "database-bootstrap.env",
  "migration.env",
  "bootstrap-admin.env",
  "backup.env",
  "restore.env",
  "postgres-superuser-password.txt",
]);

function permissionMode(metadata) {
  return metadata.mode & 0o7777;
}

function fail(label, reason) {
  throw new Error(`LUMINA_SECRET_SOURCE_METADATA_INVALID:${label}:${reason}`);
}

function safeLstat(operations, target, label) {
  try {
    return operations.lstat(target);
  } catch {
    fail(label, "MISSING_OR_UNREADABLE");
  }
}

function safeRealpath(operations, target, label) {
  try {
    return operations.realpath(target);
  } catch {
    fail(label, "REALPATH_UNAVAILABLE");
  }
}

function validateDirectory(operations, directory, label, expectedGroupId) {
  const metadata = safeLstat(operations, directory, label);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(label, "NOT_REAL_DIRECTORY");
  if (safeRealpath(operations, directory, label) !== directory) fail(label, "REALPATH_MISMATCH");
  if (metadata.uid !== 0 || metadata.gid !== expectedGroupId) fail(label, "OWNER_MISMATCH");
  if (permissionMode(metadata) !== 0o750) fail(label, "MODE_MISMATCH");
}

export function validateSecretSourceMetadata({
  configurationRoot,
  secretsRoot,
  expectedGroupId,
  operations,
}) {
  if (!Number.isInteger(expectedGroupId) || expectedGroupId < 1) {
    fail("lumina-crm-group", "INVALID_GID");
  }
  validateDirectory(operations, configurationRoot, "configuration-directory", expectedGroupId);
  validateDirectory(operations, secretsRoot, "secrets-directory", expectedGroupId);

  for (const name of LUMINA_REQUIRED_SECRET_SOURCE_FILES) {
    const file = path.posix.join(secretsRoot, name);
    const metadata = safeLstat(operations, file, name);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail(name, "NOT_REGULAR_FILE");
    if (safeRealpath(operations, file, name) !== file) fail(name, "REALPATH_MISMATCH");
    if (metadata.uid !== 0 || metadata.gid !== expectedGroupId) fail(name, "OWNER_MISMATCH");
    if (permissionMode(metadata) !== 0o644) fail(name, "MODE_MISMATCH");
  }
  return {
    configurationRoot,
    secretsRoot,
    checkedFiles: [...LUMINA_REQUIRED_SECRET_SOURCE_FILES],
  };
}

export function assertProductionSecretSources({
  environment = process.env,
  currentGroupId = process.getgid?.(),
  operations = {
    lstat: lstatSync,
    realpath: realpathSync,
  },
} = {}) {
  const configuredRoot = environment.LUMINA_SECRETS_DIR?.trim() || LUMINA_SECRET_SOURCES_ROOT;
  if (configuredRoot !== LUMINA_SECRET_SOURCES_ROOT) {
    fail("secrets-directory", "NON_CANONICAL_PATH");
  }
  return validateSecretSourceMetadata({
    configurationRoot: LUMINA_CONFIGURATION_ROOT,
    secretsRoot: LUMINA_SECRET_SOURCES_ROOT,
    expectedGroupId: currentGroupId,
    operations,
  });
}
