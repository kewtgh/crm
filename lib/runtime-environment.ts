import { z } from "zod";
import path from "node:path";
import { secureEndpointOrigin } from "./application-origin.mjs";
import { EMAIL_DELIVERY_RUNTIME_KEYS } from "./email-delivery-runtime.mjs";

const placeholderPattern = /replace-with|change-me|example-secret|your-project|your-anon|server-only-service|production-site-key|production-server-secret|public-anon-key|workspace-uuid|independent-random/i;
const configured = z.string().trim().min(1).refine(
  (value) => !placeholderPattern.test(value),
  "Placeholder values are not allowed",
);
const productionSecret = z.string().trim().min(32).refine(
  (value) => !placeholderPattern.test(value),
  "Placeholder secrets are not allowed",
);
const databaseUrl = z.string().trim().min(1).refine((value) => {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && Boolean(url.hostname)
      && Boolean(url.username)
      && Boolean(url.pathname.slice(1))
      && !placeholderPattern.test(value);
  } catch {
    return false;
  }
}, "A complete PostgreSQL connection URL is required");
const hostname = z.string().trim().min(1).refine((value) => {
  try { return new URL(`http://${value}`).hostname === value; } catch { return false; }
}, "A valid hostname is required");
const positiveInteger = z.string().trim().regex(/^\d+$/).refine((value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}, "A positive integer is required");
const boundedPositiveInteger = (maximum: number) => positiveInteger.refine(
  (value) => Number(value) <= maximum,
  `Value must not exceed ${maximum}`,
);
const configuredUrl = z.url().refine((value) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return !placeholderPattern.test(value)
      && !host.endsWith(".example.com")
      && !host.endsWith(".example")
      && !host.endsWith(".invalid");
  } catch {
    return false;
  }
}, "Placeholder URLs are not allowed");

export const coreRuntimeEnvironmentSchema = z.object({
  APP_URL: configuredUrl.refine((value) => secureEndpointOrigin(value) !== null, "APP_URL must be an HTTPS origin (or loopback HTTP in development)"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: configured,
  TURNSTILE_SECRET_KEY: productionSecret,
  TURNSTILE_EXPECTED_HOSTNAME: hostname,
  ALTCHA_HMAC_SECRET: productionSecret,
  DATABASE_URL: databaseUrl,
  SYSTEM_DATABASE_URL: databaseUrl,
  CRM_WORKSPACE_ID: z.uuid(),
  LOGIN_THROTTLE_HASH_SECRET: productionSecret,
  TRUSTED_DEVICE_HASH_SECRET: productionSecret,
  TOTP_ENCRYPTION_KEY: productionSecret,
  INVITATION_CREDENTIAL_ENCRYPTION_KEY: productionSecret,
  OBJECT_STORAGE_SIGNING_SECRET: productionSecret,
}).superRefine((value, context) => {
  const appHostname = new URL(value.APP_URL).hostname;
  if (appHostname !== value.TURNSTILE_EXPECTED_HOSTNAME) {
    context.addIssue({ code: "custom", path: ["TURNSTILE_EXPECTED_HOSTNAME"], message: "Turnstile hostname must match APP_URL" });
  }
  if (value.LOGIN_THROTTLE_HASH_SECRET === value.TRUSTED_DEVICE_HASH_SECRET) {
    context.addIssue({ code: "custom", path: ["TRUSTED_DEVICE_HASH_SECRET"], message: "Security secrets must be independent" });
  }
  const secrets = [
    ["TURNSTILE_SECRET_KEY", value.TURNSTILE_SECRET_KEY],
    ["ALTCHA_HMAC_SECRET", value.ALTCHA_HMAC_SECRET],
    ["LOGIN_THROTTLE_HASH_SECRET", value.LOGIN_THROTTLE_HASH_SECRET],
    ["TRUSTED_DEVICE_HASH_SECRET", value.TRUSTED_DEVICE_HASH_SECRET],
    ["TOTP_ENCRYPTION_KEY", value.TOTP_ENCRYPTION_KEY],
    ["INVITATION_CREDENTIAL_ENCRYPTION_KEY", value.INVITATION_CREDENTIAL_ENCRYPTION_KEY],
    ["OBJECT_STORAGE_SIGNING_SECRET", value.OBJECT_STORAGE_SIGNING_SECRET],
  ] as const;
  secrets.forEach(([key, secret], index) => {
    if (secrets.some(([, candidate], candidateIndex) => candidateIndex < index && candidate === secret)) {
      context.addIssue({ code: "custom", path: [key], message: "Security secrets must be independent" });
    }
  });
});

export type RuntimeEnvironmentStatus = {
  valid: boolean;
  configured: number;
  expected: number;
  missing: string[];
};

export const WORKER_KEYS = [
  "REMINDERS",
  "NOTIFICATION_OUTBOX",
  "CALENDAR_DELIVERIES",
  "COMMUNICATION_DELIVERY",
  "GENERATED_JOBS",
  "WEBHOOK_INBOX",
  "INTEGRATION_SYNC",
] as const;

export type WorkerKey = (typeof WORKER_KEYS)[number];

const featureEnabled = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

const workerBaseKeys = [
  "WORKER_DATABASE_URL",
  "CRM_WORKSPACE_ID",
  "OBJECT_STORAGE_PROVIDER",
] as const;
const localStorageKeys = ["OBJECT_STORAGE_LOCAL_ROOT"] as const;
const s3StorageKeys = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;
const deliveryKeys = [
  ...EMAIL_DELIVERY_RUNTIME_KEYS,
  "INVITATION_CREDENTIAL_ENCRYPTION_KEY",
  "OUTBOX_BATCH_SIZE",
  "CALENDAR_DELIVERY_BATCH_SIZE",
  "COMMUNICATION_DELIVERY_BATCH_SIZE",
  "EXPORT_BATCH_SIZE",
  "REMINDER_BATCH_SIZE",
] as const;
const webhookKeys = [
  "WEBHOOK_MICROSOFT_365_SECRET",
  "WEBHOOK_GOOGLE_CALENDAR_SECRET",
  "WEBHOOK_EMAIL_SECRET",
  "WEBHOOK_E_SIGNATURE_SECRET",
  "WEBHOOK_ACCOUNTING_SECRET",
  "WEBHOOK_PAYMENT_SECRET",
  "WEBHOOK_PROCESSOR_URL",
  "WEBHOOK_PROCESSOR_TOKEN",
  "WEBHOOK_BATCH_SIZE",
] as const;
const integrationKeys = [
  "INTEGRATION_SYNC_PROCESSOR_URL",
  "INTEGRATION_SYNC_PROCESSOR_TOKEN",
  "INTEGRATION_SYNC_BATCH_SIZE",
] as const;
const observabilityKeys = [
  "OBSERVABILITY_WEBHOOK_URL",
  "OBSERVABILITY_WEBHOOK_TOKEN",
  "OBSERVABILITY_SAMPLE_RATE",
] as const;
const ssoKeys = ["SSO_ALLOWED_DOMAINS"] as const;
const scimKeys = ["SCIM_BEARER_TOKEN"] as const;

const workerBaseEnvironmentSchema = z.object({
  WORKER_DATABASE_URL: databaseUrl,
  CRM_WORKSPACE_ID: z.uuid(),
  OBJECT_STORAGE_PROVIDER: z.enum(["local", "s3"]),
  OBJECT_STORAGE_LOCAL_ROOT: z.string().trim().refine((value) => path.isAbsolute(value), "An absolute object storage path is required").optional(),
  S3_ENDPOINT: configuredUrl.optional(),
  S3_REGION: configured.optional(),
  S3_BUCKET: configured.optional(),
  S3_ACCESS_KEY_ID: configured.optional(),
  S3_SECRET_ACCESS_KEY: productionSecret.optional(),
}).superRefine((value, context) => {
  if (value.OBJECT_STORAGE_PROVIDER === "local" && !value.OBJECT_STORAGE_LOCAL_ROOT) {
    context.addIssue({ code: "custom", path: ["OBJECT_STORAGE_LOCAL_ROOT"], message: "Local object storage path is required" });
  }
  if (value.OBJECT_STORAGE_PROVIDER === "s3") {
    for (const key of s3StorageKeys) {
      if (!value[key]) context.addIssue({ code: "custom", path: [key], message: "S3 object storage setting is required" });
    }
  }
});
const deliveryEnvironmentSchema = z.object({
  EMAIL_DELIVERY_WEBHOOK_URL: configuredUrl,
  EMAIL_DELIVERY_WEBHOOK_TOKEN: productionSecret,
  INVITATION_CREDENTIAL_ENCRYPTION_KEY: productionSecret,
  OUTBOX_BATCH_SIZE: boundedPositiveInteger(40),
  CALENDAR_DELIVERY_BATCH_SIZE: boundedPositiveInteger(40),
  COMMUNICATION_DELIVERY_BATCH_SIZE: boundedPositiveInteger(40),
  EXPORT_BATCH_SIZE: boundedPositiveInteger(10),
  REMINDER_BATCH_SIZE: boundedPositiveInteger(200),
  WORKER_JOB_CONCURRENCY: boundedPositiveInteger(8).optional(),
});
const webhookEnvironmentSchema = z.object({
  WEBHOOK_MICROSOFT_365_SECRET: productionSecret,
  WEBHOOK_GOOGLE_CALENDAR_SECRET: productionSecret,
  WEBHOOK_EMAIL_SECRET: productionSecret,
  WEBHOOK_E_SIGNATURE_SECRET: productionSecret,
  WEBHOOK_ACCOUNTING_SECRET: productionSecret,
  WEBHOOK_PAYMENT_SECRET: productionSecret,
  WEBHOOK_PROCESSOR_URL: configuredUrl,
  WEBHOOK_PROCESSOR_TOKEN: productionSecret,
  WEBHOOK_BATCH_SIZE: boundedPositiveInteger(40),
});
const integrationEnvironmentSchema = z.object({
  INTEGRATION_SYNC_PROCESSOR_URL: configuredUrl,
  INTEGRATION_SYNC_PROCESSOR_TOKEN: productionSecret,
  INTEGRATION_SYNC_BATCH_SIZE: boundedPositiveInteger(12),
});
const observabilityEnvironmentSchema = z.object({
  OBSERVABILITY_WEBHOOK_URL: configuredUrl,
  OBSERVABILITY_WEBHOOK_TOKEN: productionSecret,
  OBSERVABILITY_SAMPLE_RATE: z.coerce.number().min(0).max(1),
});
const ssoEnvironmentSchema = z.object({
  SSO_ALLOWED_DOMAINS: z.string().trim().min(1).refine((value) => value.split(",").every((domain) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain.trim())), "Invalid SSO domain list"),
});
const scimEnvironmentSchema = z.object({ SCIM_BEARER_TOKEN: productionSecret });

const WORKER_EXTERNAL_BUDGET_SECONDS = 210;
function workerBudgetIssues(environment: NodeJS.ProcessEnv) {
  const integer = (key: string, fallback: number) => {
    const raw = environment[key];
    if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
    return Number(raw);
  };
  const concurrency = integer("WORKER_JOB_CONCURRENCY", 4);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) return [];
  const exceeds = (batchKey: string, fallback: number, timeoutSeconds: number) => (
    Math.ceil(integer(batchKey, fallback) / concurrency) * timeoutSeconds
      > WORKER_EXTERNAL_BUDGET_SECONDS
  );
  return [
    ...(exceeds("OUTBOX_BATCH_SIZE", 20, 20) ? ["OUTBOX_BATCH_SIZE"] : []),
    ...(exceeds("CALENDAR_DELIVERY_BATCH_SIZE", 20, 20) ? ["CALENDAR_DELIVERY_BATCH_SIZE"] : []),
    ...(exceeds("COMMUNICATION_DELIVERY_BATCH_SIZE", 20, 20) ? ["COMMUNICATION_DELIVERY_BATCH_SIZE"] : []),
    ...(featureEnabled(environment.WEBHOOKS_ENABLED) && exceeds("WEBHOOK_BATCH_SIZE", 20, 20) ? ["WEBHOOK_BATCH_SIZE"] : []),
    ...(featureEnabled(environment.INTEGRATION_SYNC_ENABLED) && exceeds("INTEGRATION_SYNC_BATCH_SIZE", 10, 60) ? ["INTEGRATION_SYNC_BATCH_SIZE"] : []),
  ];
}

export type WorkerRuntimeEnvironmentStatus = {
  valid: boolean;
  core: boolean;
  delivery: boolean;
  webhooks: boolean;
  integrations: boolean;
  observability: boolean;
  sso: boolean;
  scim: boolean;
  webhooksEnabled: boolean;
  integrationsEnabled: boolean;
  observabilityEnabled: boolean;
  ssoEnabled: boolean;
  scimEnabled: boolean;
  enabledWorkers: WorkerKey[];
  configured: number;
  expected: number;
  missing: string[];
};

export function inspectWorkerRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeEnvironmentStatus {
  const base = workerBaseEnvironmentSchema.safeParse(environment);
  const webhooksEnabled = featureEnabled(environment.WEBHOOKS_ENABLED);
  const integrationsEnabled = featureEnabled(environment.INTEGRATION_SYNC_ENABLED);
  const observabilityEnabled = featureEnabled(environment.OBSERVABILITY_ENABLED);
  const ssoEnabled = featureEnabled(environment.SSO_ENABLED);
  const scimEnabled = featureEnabled(environment.SCIM_ENABLED);
  const enabledWorkers: WorkerKey[] = [
    "REMINDERS",
    "NOTIFICATION_OUTBOX",
    "CALENDAR_DELIVERIES",
    "COMMUNICATION_DELIVERY",
    "GENERATED_JOBS",
    ...(webhooksEnabled ? ["WEBHOOK_INBOX" as const] : []),
    ...(integrationsEnabled ? ["INTEGRATION_SYNC" as const] : []),
  ];
  const storageKeys = environment.OBJECT_STORAGE_PROVIDER === "s3" ? s3StorageKeys : localStorageKeys;
  const activeGroups = [workerBaseKeys, storageKeys, deliveryKeys, ...(webhooksEnabled ? [webhookKeys] : []), ...(integrationsEnabled ? [integrationKeys] : []), ...(observabilityEnabled ? [observabilityKeys] : []), ...(ssoEnabled ? [ssoKeys] : []), ...(scimEnabled ? [scimKeys] : [])];
  const activeKeys = activeGroups.flat();
  const deliveryResult = deliveryEnvironmentSchema.safeParse(environment);
  const webhookResult = webhooksEnabled ? webhookEnvironmentSchema.safeParse(environment) : null;
  const integrationResult = integrationsEnabled ? integrationEnvironmentSchema.safeParse(environment) : null;
  const observabilityResult = observabilityEnabled ? observabilityEnvironmentSchema.safeParse(environment) : null;
  const ssoResult = ssoEnabled ? ssoEnvironmentSchema.safeParse(environment) : null;
  const scimResult = scimEnabled ? scimEnvironmentSchema.safeParse(environment) : null;
  const invalidKeys = (result: z.ZodSafeParseResult<unknown> | null) => result && !result.success
    ? result.error.issues.map((issue) => String(issue.path[0] ?? "environment")) : [];
  const budgetIssues = workerBudgetIssues(environment);
  const missing = [...invalidKeys(base), ...invalidKeys(deliveryResult), ...invalidKeys(webhookResult), ...invalidKeys(integrationResult), ...invalidKeys(observabilityResult), ...invalidKeys(ssoResult), ...invalidKeys(scimResult), ...budgetIssues];
  const delivery = deliveryResult.success && !budgetIssues.some((key) => ["OUTBOX_BATCH_SIZE","CALENDAR_DELIVERY_BATCH_SIZE","COMMUNICATION_DELIVERY_BATCH_SIZE"].includes(key));
  const webhooks = !webhooksEnabled || (webhookResult?.success === true && !budgetIssues.includes("WEBHOOK_BATCH_SIZE"));
  const integrations = !integrationsEnabled || (integrationResult?.success === true && !budgetIssues.includes("INTEGRATION_SYNC_BATCH_SIZE"));
  const observability = !observabilityEnabled || observabilityResult?.success === true;
  const sso = !ssoEnabled || ssoResult?.success === true;
  const scim = !scimEnabled || scimResult?.success === true;
  return {
    valid: base.success && delivery && webhooks && integrations && observability && sso && scim,
    core: base.success,
    delivery,
    webhooks,
    integrations,
    observability,
    sso,
    scim,
    webhooksEnabled,
    integrationsEnabled,
    observabilityEnabled,
    ssoEnabled,
    scimEnabled,
    enabledWorkers,
    configured: activeKeys.filter((key) => Boolean(environment[key]?.trim())).length,
    expected: activeKeys.length,
    missing: [...new Set(missing)],
  };
}

export function inspectWebReadinessEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const core = inspectCoreRuntimeEnvironment(environment);
  const webhooksEnabled = featureEnabled(environment.WEBHOOKS_ENABLED);
  const integrationsEnabled = featureEnabled(environment.INTEGRATION_SYNC_ENABLED);
  return {
    ...core,
    core: core.valid,
    emailDeliveryConfigured: null,
    emailDeliveryExternallyHealthy: null,
    emailDeliveryCode: null,
    webhooksEnabled,
    integrationsEnabled,
    enabledWorkers: [
      "REMINDERS",
      "NOTIFICATION_OUTBOX",
      "CALENDAR_DELIVERIES",
      "COMMUNICATION_DELIVERY",
      "GENERATED_JOBS",
      ...(webhooksEnabled ? ["WEBHOOK_INBOX"] : []),
      ...(integrationsEnabled ? ["INTEGRATION_SYNC"] : []),
    ] as WorkerKey[],
  };
}

export function inspectCoreRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeEnvironmentStatus {
  const keys = Object.keys(coreRuntimeEnvironmentSchema.shape);
  const parsed = coreRuntimeEnvironmentSchema.safeParse(environment);
  const missing = parsed.success
    ? []
    : [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment")))];
  return {
    valid: parsed.success,
    configured: keys.filter((key) => Boolean(environment[key]?.trim())).length,
    expected: keys.length,
    missing,
  };
}

export function requireLoginThrottleSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.LOGIN_THROTTLE_HASH_SECRET?.trim();
  if (environment.NODE_ENV === "production") {
    const parsed = productionSecret.safeParse(secret);
    if (!parsed.success) throw new Error("LOGIN_THROTTLE_HASH_SECRET_NOT_CONFIGURED");
  }
  return secret || "lumina-local-login-throttle-development-key";
}

export function requireTrustedDeviceSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.TRUSTED_DEVICE_HASH_SECRET?.trim();
  if (environment.NODE_ENV === "production") {
    const parsed = productionSecret.safeParse(secret);
    if (!parsed.success) throw new Error("TRUSTED_DEVICE_HASH_SECRET_NOT_CONFIGURED");
  }
  return secret
    || environment.LOGIN_THROTTLE_HASH_SECRET?.trim()
    || "lumina-local-trusted-device-development-key";
}
