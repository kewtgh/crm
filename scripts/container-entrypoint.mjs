import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { EMAIL_DELIVERY_RUNTIME_KEYS } from "../lib/email-delivery-runtime.mjs";

const proxyKeys = [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
  "http_proxy", "https_proxy", "all_proxy",
];
const forbiddenSecretKeys = new Set([
  ...proxyKeys,
  "NO_PROXY",
  "no_proxy",
  "NODE_OPTIONS",
  "PATH",
  "HOME",
  "LUMINA_ENV_FILES",
]);

async function loadSecretEnvironment() {
  const configured = process.env.LUMINA_ENV_FILES?.trim();
  if (!configured) return;
  for (const file of configured.split(",").map((value) => value.trim()).filter(Boolean)) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith("/run/secrets/")) {
      throw new Error("LUMINA_SECRET_PATH_OUTSIDE_RUN_SECRETS");
    }
    const parsed = parseEnv(await readFile(resolved, "utf8"));
    const forbidden = Object.keys(parsed).filter((key) => forbiddenSecretKeys.has(key));
    if (forbidden.length) {
      throw new Error(`FORBIDDEN_SECRET_ENVIRONMENT_KEYS: ${forbidden.join(",")}`);
    }
    Object.assign(process.env, parsed);
  }
}

function configureDirectRuntime() {
  for (const key of proxyKeys) delete process.env[key];
  const noProxy = "postgres,web,worker,localhost,127.0.0.1,::1";
  process.env.NO_PROXY = noProxy;
  process.env.no_proxy = noProxy;
  delete process.env.NODE_OPTIONS;
}

function requireKeys(keys) {
  const missing = keys.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`MISSING_REQUIRED_ENVIRONMENT: ${missing.join(",")}`);
}

function requireDatabaseRole(key, expectedRole) {
  requireKeys([key]);
  let value;
  try {
    value = new URL(process.env[key]);
  } catch {
    throw new Error(`${key}_INVALID`);
  }
  if (!["postgres:", "postgresql:"].includes(value.protocol)
    || value.hostname !== "postgres"
    || value.port !== "5432"
    || value.pathname !== "/lumina_crm"
    || decodeURIComponent(value.username) !== expectedRole) {
    throw new Error(`${key}_MUST_USE_${expectedRole.toUpperCase()}_AT_POSTGRES`);
  }
}

function rejectPresent(keys, boundary) {
  const present = keys.filter((key) => process.env[key]?.trim());
  if (present.length) throw new Error(`${boundary}_CREDENTIAL_BOUNDARY_VIOLATION: ${present.join(",")}`);
}

function webPreflight() {
  requireKeys([
    "APP_URL",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
    "TURNSTILE_EXPECTED_HOSTNAME",
    "ALTCHA_HMAC_SECRET",
    "CRM_WORKSPACE_ID",
    "LOGIN_THROTTLE_HASH_SECRET",
    "TRUSTED_DEVICE_HASH_SECRET",
    "TOTP_ENCRYPTION_KEY",
    "OBJECT_STORAGE_SIGNING_SECRET",
    ...EMAIL_DELIVERY_RUNTIME_KEYS,
  ]);
  requireDatabaseRole("DATABASE_URL", "crm_app");
  requireDatabaseRole("SYSTEM_DATABASE_URL", "crm_system");
  rejectPresent([
    "WORKER_DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "BACKUP_DATABASE_URL",
    "DATABASE_ADMIN_URL",
    "RESTORE_DATABASE_ADMIN_URL",
    "ADMIN_PASSWORD",
  ], "WEB");
}

function workerPreflight() {
  requireDatabaseRole("WORKER_DATABASE_URL", "crm_worker");
  requireKeys([
    "CRM_WORKSPACE_ID",
    "OBJECT_STORAGE_PROVIDER",
    ...EMAIL_DELIVERY_RUNTIME_KEYS,
  ]);
  rejectPresent([
    "DATABASE_URL",
    "SYSTEM_DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "BACKUP_DATABASE_URL",
    "DATABASE_ADMIN_URL",
    "RESTORE_DATABASE_ADMIN_URL",
    "ADMIN_PASSWORD",
  ], "WORKER");
}

async function runModule(file) {
  await import(new URL(file, import.meta.url));
}

async function startWeb() {
  webPreflight();
  const { startProdServer } = await import("vinext/server/prod-server");
  await startProdServer({
    port: 3200,
    host: "0.0.0.0",
    outDir: path.resolve("dist"),
  });
}

const commands = {
  web: startWeb,
  "web-health": async () => {
    const response = await fetch("http://127.0.0.1:3200/api/health", {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`WEB_LIVENESS_FAILED_${response.status}`);
    const body = await response.json();
    if (body?.status !== "ok") throw new Error("WEB_LIVENESS_INVALID");
  },
  worker: async () => {
    workerPreflight();
    await runModule("./run-worker-loop.mjs");
  },
  "worker-health": async () => {
    workerPreflight();
    await runModule("./worker-healthcheck.mjs");
  },
  "migration-verify": () => runModule("./db-verify-migrations.mjs"),
  "db-bootstrap": async () => {
    requireDatabaseRole("DATABASE_ADMIN_URL", "postgres");
    requireKeys([
      "CRM_APP_DB_PASSWORD",
      "CRM_SYSTEM_DB_PASSWORD",
      "CRM_WORKER_DB_PASSWORD",
      "CRM_MIGRATOR_DB_PASSWORD",
      "CRM_BACKUP_DB_PASSWORD",
    ]);
    rejectPresent(["MIGRATION_DATABASE_URL", "BACKUP_DATABASE_URL", "ADMIN_PASSWORD"], "DATABASE_BOOTSTRAP");
    await runModule("./db-bootstrap.mjs");
  },
  migrate: async () => {
    requireDatabaseRole("MIGRATION_DATABASE_URL", "crm_migrator");
    rejectPresent(["DATABASE_ADMIN_URL", "BACKUP_DATABASE_URL", "ADMIN_PASSWORD"], "MIGRATION");
    await runModule("./db-migrate.mjs");
  },
  "bootstrap-admin": async () => {
    requireDatabaseRole("SYSTEM_DATABASE_URL", "crm_system");
    requireKeys(["ADMIN_EMAIL", "ADMIN_PASSWORD", "CRM_WORKSPACE_ID"]);
    rejectPresent(["DATABASE_ADMIN_URL", "MIGRATION_DATABASE_URL", "BACKUP_DATABASE_URL"], "ADMIN_BOOTSTRAP");
    await runModule("./bootstrap-admin.mjs");
  },
  backup: async () => {
    requireDatabaseRole("BACKUP_DATABASE_URL", "crm_backup");
    rejectPresent([
      "DATABASE_ADMIN_URL",
      "RESTORE_DATABASE_ADMIN_URL",
      "MIGRATION_DATABASE_URL",
      "DATABASE_URL",
      "SYSTEM_DATABASE_URL",
      "WORKER_DATABASE_URL",
    ], "BACKUP");
    await runModule("./db-backup.mjs");
  },
  "restore-test": async () => {
    requireDatabaseRole("RESTORE_DATABASE_ADMIN_URL", "postgres");
    rejectPresent([
      "MIGRATION_DATABASE_URL",
      "DATABASE_URL",
      "SYSTEM_DATABASE_URL",
      "WORKER_DATABASE_URL",
    ], "RESTORE_TEST");
    await runModule("./db-restore-test.mjs");
  },
};

const [command, ...unexpected] = process.argv.slice(2);
if (!command || unexpected.length || !commands[command]) {
  throw new Error("LUMINA_CONTAINER_COMMAND_NOT_ALLOWED");
}
await loadSecretEnvironment();
configureDirectRuntime();
await commands[command]();
