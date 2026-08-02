import path from "node:path";

import { secureEndpointOrigin } from "./application-origin.mjs";
import { EMAIL_DELIVERY_RUNTIME_KEYS } from "./email-delivery-runtime.mjs";

const placeholderPattern = /replace-with|change-me|example-secret|your-project|your-anon|server-only-service|production-site-key|production-server-secret|public-anon-key|workspace-uuid|independent-random/i;
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CORE_RUNTIME_KEYS = Object.freeze([
  "APP_URL", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY",
  "TURNSTILE_EXPECTED_HOSTNAME", "ALTCHA_HMAC_SECRET", "DATABASE_URL",
  "SYSTEM_DATABASE_URL", "CRM_WORKSPACE_ID", "LOGIN_THROTTLE_HASH_SECRET",
  "TRUSTED_DEVICE_HASH_SECRET", "TOTP_ENCRYPTION_KEY",
  "INVITATION_CREDENTIAL_ENCRYPTION_KEY", "OBJECT_STORAGE_SIGNING_SECRET",
]);

export const WORKER_KEYS = Object.freeze([
  "REMINDERS", "NOTIFICATION_OUTBOX", "CALENDAR_DELIVERIES",
  "COMMUNICATION_DELIVERY", "GENERATED_JOBS", "WEBHOOK_INBOX", "INTEGRATION_SYNC",
]);

const workerBaseKeys = ["WORKER_DATABASE_URL", "CRM_WORKSPACE_ID", "OBJECT_STORAGE_PROVIDER"];
const localStorageKeys = ["OBJECT_STORAGE_LOCAL_ROOT"];
const s3StorageKeys = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const deliveryKeys = [
  ...EMAIL_DELIVERY_RUNTIME_KEYS, "INVITATION_CREDENTIAL_ENCRYPTION_KEY",
  "OUTBOX_BATCH_SIZE", "CALENDAR_DELIVERY_BATCH_SIZE", "COMMUNICATION_DELIVERY_BATCH_SIZE",
  "EXPORT_BATCH_SIZE", "REMINDER_BATCH_SIZE",
];
const webhookKeys = [
  "WEBHOOK_MICROSOFT_365_SECRET", "WEBHOOK_GOOGLE_CALENDAR_SECRET", "WEBHOOK_EMAIL_SECRET",
  "WEBHOOK_E_SIGNATURE_SECRET", "WEBHOOK_ACCOUNTING_SECRET", "WEBHOOK_PAYMENT_SECRET",
  "WEBHOOK_PROCESSOR_URL", "WEBHOOK_PROCESSOR_TOKEN", "WEBHOOK_BATCH_SIZE",
];
const integrationKeys = ["INTEGRATION_SYNC_PROCESSOR_URL", "INTEGRATION_SYNC_PROCESSOR_TOKEN", "INTEGRATION_SYNC_BATCH_SIZE"];
const observabilityKeys = ["OBSERVABILITY_WEBHOOK_URL", "OBSERVABILITY_WEBHOOK_TOKEN", "OBSERVABILITY_SAMPLE_RATE"];
const ssoKeys = ["SSO_ALLOWED_DOMAINS"];
const scimKeys = ["SCIM_BEARER_TOKEN"];

const text = (value) => String(value ?? "").trim();
const unique = (values) => [...new Set(values)];
const configured = (value) => Boolean(text(value)) && !placeholderPattern.test(text(value));
export const featureEnabled = (value) => /^(1|true|yes|on)$/i.test(text(value));
export const isProductionSecret = (value) => text(value).length >= 32 && !placeholderPattern.test(text(value));

function isDatabaseUrl(value) {
  const candidate = text(value);
  try {
    const url = new URL(candidate);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && Boolean(url.hostname) && Boolean(url.username) && Boolean(url.pathname.slice(1))
      && !placeholderPattern.test(candidate);
  } catch { return false; }
}

function isHostname(value) {
  const candidate = text(value);
  try { return Boolean(candidate) && new URL(`http://${candidate}`).hostname === candidate; }
  catch { return false; }
}

function isConfiguredUrl(value) {
  const candidate = text(value);
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    return Boolean(host) && !placeholderPattern.test(candidate)
      && !host.endsWith(".example.com") && !host.endsWith(".example") && !host.endsWith(".invalid");
  } catch { return false; }
}

const isUuid = (value) => uuidPattern.test(text(value));
function isBoundedPositiveInteger(value, maximum) {
  const candidate = text(value);
  if (!/^\d+$/.test(candidate)) return false;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum;
}

function coreRuntimeIssues(environment) {
  const issues = [];
  const checks = {
    APP_URL: (value) => isConfiguredUrl(value) && secureEndpointOrigin(text(value)) !== null,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: configured,
    TURNSTILE_SECRET_KEY: isProductionSecret,
    TURNSTILE_EXPECTED_HOSTNAME: isHostname,
    ALTCHA_HMAC_SECRET: isProductionSecret,
    DATABASE_URL: isDatabaseUrl,
    SYSTEM_DATABASE_URL: isDatabaseUrl,
    CRM_WORKSPACE_ID: isUuid,
    LOGIN_THROTTLE_HASH_SECRET: isProductionSecret,
    TRUSTED_DEVICE_HASH_SECRET: isProductionSecret,
    TOTP_ENCRYPTION_KEY: isProductionSecret,
    INVITATION_CREDENTIAL_ENCRYPTION_KEY: isProductionSecret,
    OBJECT_STORAGE_SIGNING_SECRET: isProductionSecret,
  };
  for (const [key, check] of Object.entries(checks)) if (!check(environment[key])) issues.push(key);
  if (!issues.includes("APP_URL") && !issues.includes("TURNSTILE_EXPECTED_HOSTNAME")
    && new URL(text(environment.APP_URL)).hostname !== text(environment.TURNSTILE_EXPECTED_HOSTNAME)) {
    issues.push("TURNSTILE_EXPECTED_HOSTNAME");
  }
  const securitySecrets = [
    "TURNSTILE_SECRET_KEY", "ALTCHA_HMAC_SECRET", "LOGIN_THROTTLE_HASH_SECRET",
    "TRUSTED_DEVICE_HASH_SECRET", "TOTP_ENCRYPTION_KEY",
    "INVITATION_CREDENTIAL_ENCRYPTION_KEY", "OBJECT_STORAGE_SIGNING_SECRET",
  ];
  securitySecrets.forEach((key, index) => {
    const value = text(environment[key]);
    if (value && securitySecrets.slice(0, index).some((candidate) => text(environment[candidate]) === value)) issues.push(key);
  });
  return unique(issues);
}

export function inspectCoreRuntimeEnvironment(environment = process.env) {
  const missing = coreRuntimeIssues(environment);
  return {
    valid: missing.length === 0,
    configured: CORE_RUNTIME_KEYS.filter((key) => Boolean(text(environment[key]))).length,
    expected: CORE_RUNTIME_KEYS.length,
    missing,
  };
}

const WORKER_EXTERNAL_BUDGET_SECONDS = 210;
function workerBudgetIssues(environment) {
  const integer = (key, fallback) => {
    const raw = environment[key];
    if (raw === undefined || !/^\d+$/.test(text(raw))) return fallback;
    return Number(raw);
  };
  const concurrency = integer("WORKER_JOB_CONCURRENCY", 4);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) return [];
  const exceeds = (key, fallback, seconds) => Math.ceil(integer(key, fallback) / concurrency) * seconds > WORKER_EXTERNAL_BUDGET_SECONDS;
  return [
    ...(exceeds("OUTBOX_BATCH_SIZE", 20, 20) ? ["OUTBOX_BATCH_SIZE"] : []),
    ...(exceeds("CALENDAR_DELIVERY_BATCH_SIZE", 20, 20) ? ["CALENDAR_DELIVERY_BATCH_SIZE"] : []),
    ...(exceeds("COMMUNICATION_DELIVERY_BATCH_SIZE", 20, 20) ? ["COMMUNICATION_DELIVERY_BATCH_SIZE"] : []),
    ...(featureEnabled(environment.WEBHOOKS_ENABLED) && exceeds("WEBHOOK_BATCH_SIZE", 20, 20) ? ["WEBHOOK_BATCH_SIZE"] : []),
    ...(featureEnabled(environment.INTEGRATION_SYNC_ENABLED) && exceeds("INTEGRATION_SYNC_BATCH_SIZE", 10, 60) ? ["INTEGRATION_SYNC_BATCH_SIZE"] : []),
  ];
}

function workerBaseIssues(environment) {
  const issues = [];
  if (!isDatabaseUrl(environment.WORKER_DATABASE_URL)) issues.push("WORKER_DATABASE_URL");
  if (!isUuid(environment.CRM_WORKSPACE_ID)) issues.push("CRM_WORKSPACE_ID");
  const provider = text(environment.OBJECT_STORAGE_PROVIDER);
  if (!["local", "s3"].includes(provider)) issues.push("OBJECT_STORAGE_PROVIDER");
  if (environment.OBJECT_STORAGE_LOCAL_ROOT !== undefined
    && !path.isAbsolute(text(environment.OBJECT_STORAGE_LOCAL_ROOT))) issues.push("OBJECT_STORAGE_LOCAL_ROOT");
  if (environment.S3_ENDPOINT !== undefined && !isConfiguredUrl(environment.S3_ENDPOINT)) issues.push("S3_ENDPOINT");
  for (const key of ["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID"]) {
    if (environment[key] !== undefined && !configured(environment[key])) issues.push(key);
  }
  if (environment.S3_SECRET_ACCESS_KEY !== undefined && !isProductionSecret(environment.S3_SECRET_ACCESS_KEY)) issues.push("S3_SECRET_ACCESS_KEY");
  if (provider === "local" && !path.isAbsolute(text(environment.OBJECT_STORAGE_LOCAL_ROOT))) issues.push("OBJECT_STORAGE_LOCAL_ROOT");
  if (provider === "s3") {
    if (environment.S3_ENDPOINT === undefined) issues.push("S3_ENDPOINT");
    for (const key of ["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID"]) if (environment[key] === undefined) issues.push(key);
    if (environment.S3_SECRET_ACCESS_KEY === undefined) issues.push("S3_SECRET_ACCESS_KEY");
  }
  return unique(issues);
}

function deliveryIssues(environment) {
  const issues = [];
  if (!isConfiguredUrl(environment.EMAIL_DELIVERY_WEBHOOK_URL)) issues.push("EMAIL_DELIVERY_WEBHOOK_URL");
  if (!isProductionSecret(environment.EMAIL_DELIVERY_WEBHOOK_TOKEN)) issues.push("EMAIL_DELIVERY_WEBHOOK_TOKEN");
  if (!isProductionSecret(environment.INVITATION_CREDENTIAL_ENCRYPTION_KEY)) issues.push("INVITATION_CREDENTIAL_ENCRYPTION_KEY");
  for (const [key, maximum] of [
    ["OUTBOX_BATCH_SIZE", 40], ["CALENDAR_DELIVERY_BATCH_SIZE", 40],
    ["COMMUNICATION_DELIVERY_BATCH_SIZE", 40], ["EXPORT_BATCH_SIZE", 10], ["REMINDER_BATCH_SIZE", 200],
  ]) if (!isBoundedPositiveInteger(environment[key], maximum)) issues.push(key);
  if (environment.WORKER_JOB_CONCURRENCY !== undefined && !isBoundedPositiveInteger(environment.WORKER_JOB_CONCURRENCY, 8)) issues.push("WORKER_JOB_CONCURRENCY");
  return issues;
}

function webhookIssues(environment) {
  const issues = [];
  for (const key of webhookKeys.filter((key) => key.endsWith("_SECRET") || key.endsWith("_TOKEN"))) {
    if (!isProductionSecret(environment[key])) issues.push(key);
  }
  if (!isConfiguredUrl(environment.WEBHOOK_PROCESSOR_URL)) issues.push("WEBHOOK_PROCESSOR_URL");
  if (!isBoundedPositiveInteger(environment.WEBHOOK_BATCH_SIZE, 40)) issues.push("WEBHOOK_BATCH_SIZE");
  return issues;
}

function integrationIssues(environment) {
  const issues = [];
  if (!isConfiguredUrl(environment.INTEGRATION_SYNC_PROCESSOR_URL)) issues.push("INTEGRATION_SYNC_PROCESSOR_URL");
  if (!isProductionSecret(environment.INTEGRATION_SYNC_PROCESSOR_TOKEN)) issues.push("INTEGRATION_SYNC_PROCESSOR_TOKEN");
  if (!isBoundedPositiveInteger(environment.INTEGRATION_SYNC_BATCH_SIZE, 12)) issues.push("INTEGRATION_SYNC_BATCH_SIZE");
  return issues;
}

function observabilityIssues(environment) {
  const issues = [];
  if (!isConfiguredUrl(environment.OBSERVABILITY_WEBHOOK_URL)) issues.push("OBSERVABILITY_WEBHOOK_URL");
  if (!isProductionSecret(environment.OBSERVABILITY_WEBHOOK_TOKEN)) issues.push("OBSERVABILITY_WEBHOOK_TOKEN");
  const sampleRate = Number(environment.OBSERVABILITY_SAMPLE_RATE);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) issues.push("OBSERVABILITY_SAMPLE_RATE");
  return issues;
}

function ssoIssues(environment) {
  const domains = text(environment.SSO_ALLOWED_DOMAINS);
  return domains && domains.split(",").every((domain) => domainPattern.test(domain.trim())) ? [] : ["SSO_ALLOWED_DOMAINS"];
}

export function inspectWorkerRuntimeEnvironment(environment = process.env) {
  const webhooksEnabled = featureEnabled(environment.WEBHOOKS_ENABLED);
  const integrationsEnabled = featureEnabled(environment.INTEGRATION_SYNC_ENABLED);
  const observabilityEnabled = featureEnabled(environment.OBSERVABILITY_ENABLED);
  const ssoEnabled = featureEnabled(environment.SSO_ENABLED);
  const scimEnabled = featureEnabled(environment.SCIM_ENABLED);
  const baseIssues = workerBaseIssues(environment);
  const deliverySchemaIssues = deliveryIssues(environment);
  const webhookSchemaIssues = webhooksEnabled ? webhookIssues(environment) : [];
  const integrationSchemaIssues = integrationsEnabled ? integrationIssues(environment) : [];
  const observabilitySchemaIssues = observabilityEnabled ? observabilityIssues(environment) : [];
  const ssoSchemaIssues = ssoEnabled ? ssoIssues(environment) : [];
  const scimSchemaIssues = scimEnabled && !isProductionSecret(environment.SCIM_BEARER_TOKEN) ? ["SCIM_BEARER_TOKEN"] : [];
  const budgetIssues = workerBudgetIssues(environment);
  const delivery = deliverySchemaIssues.length === 0
    && !budgetIssues.some((key) => ["OUTBOX_BATCH_SIZE", "CALENDAR_DELIVERY_BATCH_SIZE", "COMMUNICATION_DELIVERY_BATCH_SIZE"].includes(key));
  const webhooks = !webhooksEnabled || (webhookSchemaIssues.length === 0 && !budgetIssues.includes("WEBHOOK_BATCH_SIZE"));
  const integrations = !integrationsEnabled || (integrationSchemaIssues.length === 0 && !budgetIssues.includes("INTEGRATION_SYNC_BATCH_SIZE"));
  const observability = !observabilityEnabled || observabilitySchemaIssues.length === 0;
  const sso = !ssoEnabled || ssoSchemaIssues.length === 0;
  const scim = !scimEnabled || scimSchemaIssues.length === 0;
  const storageKeys = text(environment.OBJECT_STORAGE_PROVIDER) === "s3" ? s3StorageKeys : localStorageKeys;
  const activeKeys = [
    workerBaseKeys, storageKeys, deliveryKeys,
    ...(webhooksEnabled ? [webhookKeys] : []), ...(integrationsEnabled ? [integrationKeys] : []),
    ...(observabilityEnabled ? [observabilityKeys] : []), ...(ssoEnabled ? [ssoKeys] : []),
    ...(scimEnabled ? [scimKeys] : []),
  ].flat();
  return {
    valid: baseIssues.length === 0 && delivery && webhooks && integrations && observability && sso && scim,
    core: baseIssues.length === 0,
    delivery, webhooks, integrations, observability, sso, scim,
    webhooksEnabled, integrationsEnabled, observabilityEnabled, ssoEnabled, scimEnabled,
    enabledWorkers: [
      "REMINDERS", "NOTIFICATION_OUTBOX", "CALENDAR_DELIVERIES", "COMMUNICATION_DELIVERY", "GENERATED_JOBS",
      ...(webhooksEnabled ? ["WEBHOOK_INBOX"] : []), ...(integrationsEnabled ? ["INTEGRATION_SYNC"] : []),
    ],
    configured: activeKeys.filter((key) => Boolean(text(environment[key]))).length,
    expected: activeKeys.length,
    missing: unique([
      ...baseIssues, ...deliverySchemaIssues, ...webhookSchemaIssues, ...integrationSchemaIssues,
      ...observabilitySchemaIssues, ...ssoSchemaIssues, ...scimSchemaIssues, ...budgetIssues,
    ]),
  };
}

export function inspectWebReadinessEnvironment(environment = process.env) {
  const core = inspectCoreRuntimeEnvironment(environment);
  const webhooksEnabled = featureEnabled(environment.WEBHOOKS_ENABLED);
  const integrationsEnabled = featureEnabled(environment.INTEGRATION_SYNC_ENABLED);
  return {
    ...core, core: core.valid,
    emailDeliveryConfigured: null, emailDeliveryExternallyHealthy: null, emailDeliveryCode: null,
    webhooksEnabled, integrationsEnabled,
    enabledWorkers: [
      "REMINDERS", "NOTIFICATION_OUTBOX", "CALENDAR_DELIVERIES", "COMMUNICATION_DELIVERY", "GENERATED_JOBS",
      ...(webhooksEnabled ? ["WEBHOOK_INBOX"] : []), ...(integrationsEnabled ? ["INTEGRATION_SYNC"] : []),
    ],
  };
}
