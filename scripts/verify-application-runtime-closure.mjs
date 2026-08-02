import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APPLICATION_RUNTIME_ENTRYPOINTS = [
  "scripts/bootstrap-admin.mjs",
  "scripts/container-entrypoint.mjs",
  "scripts/db-backup.mjs",
  "scripts/db-bootstrap.mjs",
  "scripts/db-migrate.mjs",
  "scripts/db-restore-test.mjs",
  "scripts/db-verify-migrations.mjs",
  "scripts/process-calendar-deliveries.mjs",
  "scripts/process-communication-deliveries.mjs",
  "scripts/process-generated-jobs.mjs",
  "scripts/process-integration-sync.mjs",
  "scripts/process-notification-outbox.mjs",
  "scripts/process-reminders.mjs",
  "scripts/process-webhook-inbox.mjs",
  "scripts/process-worker-cycle.mjs",
  "scripts/run-worker-loop.mjs",
  "scripts/verify-application-runtime-closure.mjs",
  "scripts/worker-healthcheck.mjs",
  "scripts/worker-heartbeat.mjs",
  "scripts/worker-schema-check.mjs",
];

const localSpecifierPatterns = [
  /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g,
  /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
];

function localSpecifiers(source) {
  const values = new Set();
  for (const pattern of localSpecifierPatterns) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) values.add(match[1]);
  }
  return [...values];
}

function runtimeError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

export async function verifyApplicationRuntimeClosure({
  root = fileURLToPath(new URL("..", import.meta.url)),
  entrypoints = APPLICATION_RUNTIME_ENTRYPOINTS,
  enforceImageIdentity = process.platform !== "win32",
  importInvitationModule = true,
} = {}) {
  const applicationRoot = path.resolve(root);
  const pending = entrypoints.map((entrypoint) => ({
    absolutePath: path.resolve(applicationRoot, entrypoint),
    importedBy: "application-entrypoint",
  }));
  const visited = new Set();

  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current.absolutePath)) continue;
    if (!current.absolutePath.startsWith(`${applicationRoot}${path.sep}`)) {
      throw runtimeError("APPLICATION_RUNTIME_IMPORT_OUTSIDE_ROOT", current.importedBy);
    }

    let source;
    try {
      source = await readFile(current.absolutePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const missing = path.relative(applicationRoot, current.absolutePath).replaceAll("\\", "/");
      throw runtimeError("APPLICATION_RUNTIME_MODULE_MISSING", `${missing} imported by ${current.importedBy}`);
    }
    visited.add(current.absolutePath);

    const importer = path.relative(applicationRoot, current.absolutePath).replaceAll("\\", "/");
    for (const specifier of localSpecifiers(source)) {
      pending.push({
        absolutePath: path.resolve(path.dirname(current.absolutePath), specifier),
        importedBy: importer,
      });
    }
  }

  const invitationModule = path.join(applicationRoot, "lib", "invitation-credential-crypto.mjs");
  await access(invitationModule, constants.R_OK);
  const moduleStat = await stat(invitationModule);
  if (!moduleStat.isFile()) {
    throw runtimeError("APPLICATION_RUNTIME_MODULE_INVALID", "lib/invitation-credential-crypto.mjs");
  }
  if (enforceImageIdentity) {
    if (process.getuid?.() !== 10001 || process.getgid?.() !== 10001) {
      throw runtimeError("APPLICATION_RUNTIME_USER_INVALID", "expected uid/gid 10001:10001");
    }
    if (moduleStat.uid !== 10001 || moduleStat.gid !== 10001) {
      throw runtimeError("APPLICATION_RUNTIME_MODULE_OWNER_INVALID", "lib/invitation-credential-crypto.mjs");
    }
  }
  if (importInvitationModule) await import(pathToFileURL(invitationModule).href);

  return { checkedModules: visited.size, invitationModule: "readable-and-importable" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyApplicationRuntimeClosure();
  process.stdout.write(`APPLICATION_RUNTIME_CLOSURE_OK modules=${result.checkedModules}\n`);
}
