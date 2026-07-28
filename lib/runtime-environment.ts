import { z } from "zod";
import { secureEndpointOrigin } from "./application-origin.mjs";

const placeholderPattern = /replace-with|change-me|example-secret|your-project|your-anon|server-only-service|production-site-key|production-server-secret|public-anon-key|workspace-uuid|independent-random/i;
const configured = z.string().trim().min(1).refine(
  (value) => !placeholderPattern.test(value),
  "Placeholder values are not allowed",
);
const productionSecret = z.string().trim().min(32).refine(
  (value) => !placeholderPattern.test(value),
  "Placeholder secrets are not allowed",
);
const authKey = z.string().trim().min(20).refine(
  (value) => !placeholderPattern.test(value),
  "Placeholder authentication keys are not allowed",
);
const hostname = z.string().trim().min(1).refine((value) => {
  try { return new URL(`http://${value}`).hostname === value; } catch { return false; }
}, "A valid hostname is required");
const positiveInteger = z.string().trim().regex(/^\d+$/).refine((value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}, "A positive integer is required");
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
  NEXT_PUBLIC_SUPABASE_URL: configuredUrl.refine((value) => secureEndpointOrigin(value) !== null, "Supabase URL must be an HTTPS origin (or loopback HTTP in development)"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: authKey,
  SUPABASE_SERVICE_ROLE_KEY: authKey,
  CRM_WORKSPACE_ID: z.uuid(),
  LOGIN_THROTTLE_HASH_SECRET: productionSecret,
  TRUSTED_DEVICE_HASH_SECRET: productionSecret,
}).superRefine((value, context) => {
  const appHostname = new URL(value.APP_URL).hostname;
  if (appHostname !== value.TURNSTILE_EXPECTED_HOSTNAME) {
    context.addIssue({ code: "custom", path: ["TURNSTILE_EXPECTED_HOSTNAME"], message: "Turnstile hostname must match APP_URL" });
  }
  if (value.LOGIN_THROTTLE_HASH_SECRET === value.TRUSTED_DEVICE_HASH_SECRET) {
    context.addIssue({ code: "custom", path: ["TRUSTED_DEVICE_HASH_SECRET"], message: "Security secrets must be independent" });
  }
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
  "GENERATED_JOBS",
  "WEBHOOK_INBOX",
  "INTEGRATION_SYNC",
] as const;

export type WorkerKey = (typeof WORKER_KEYS)[number];

const featureEnabled = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");

const deliveryKeys = [
  "EMAIL_DELIVERY_WEBHOOK_URL",
  "EMAIL_DELIVERY_WEBHOOK_TOKEN",
  "OUTBOX_BATCH_SIZE",
  "CALENDAR_DELIVERY_BATCH_SIZE",
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

const deliveryEnvironmentSchema = z.object({
  EMAIL_DELIVERY_WEBHOOK_URL: configuredUrl,
  EMAIL_DELIVERY_WEBHOOK_TOKEN: productionSecret,
  OUTBOX_BATCH_SIZE: positiveInteger,
  CALENDAR_DELIVERY_BATCH_SIZE: positiveInteger,
  EXPORT_BATCH_SIZE: positiveInteger,
  REMINDER_BATCH_SIZE: positiveInteger,
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
  WEBHOOK_BATCH_SIZE: positiveInteger,
});
const integrationEnvironmentSchema = z.object({
  INTEGRATION_SYNC_PROCESSOR_URL: configuredUrl,
  INTEGRATION_SYNC_PROCESSOR_TOKEN: productionSecret,
  INTEGRATION_SYNC_BATCH_SIZE: positiveInteger,
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
  const core = inspectCoreRuntimeEnvironment(environment);
  const webhooksEnabled = featureEnabled(environment.WEBHOOKS_ENABLED);
  const integrationsEnabled = featureEnabled(environment.INTEGRATION_SYNC_ENABLED);
  const observabilityEnabled = featureEnabled(environment.OBSERVABILITY_ENABLED);
  const ssoEnabled = featureEnabled(environment.SSO_ENABLED);
  const scimEnabled = featureEnabled(environment.SCIM_ENABLED);
  const enabledWorkers: WorkerKey[] = [
    "REMINDERS",
    "NOTIFICATION_OUTBOX",
    "CALENDAR_DELIVERIES",
    "GENERATED_JOBS",
    ...(webhooksEnabled ? ["WEBHOOK_INBOX" as const] : []),
    ...(integrationsEnabled ? ["INTEGRATION_SYNC" as const] : []),
  ];
  const activeGroups = [deliveryKeys, ...(webhooksEnabled ? [webhookKeys] : []), ...(integrationsEnabled ? [integrationKeys] : []), ...(observabilityEnabled ? [observabilityKeys] : []), ...(ssoEnabled ? [ssoKeys] : []), ...(scimEnabled ? [scimKeys] : [])];
  const activeKeys = activeGroups.flat();
  const deliveryResult = deliveryEnvironmentSchema.safeParse(environment);
  const webhookResult = webhooksEnabled ? webhookEnvironmentSchema.safeParse(environment) : null;
  const integrationResult = integrationsEnabled ? integrationEnvironmentSchema.safeParse(environment) : null;
  const observabilityResult = observabilityEnabled ? observabilityEnvironmentSchema.safeParse(environment) : null;
  const ssoResult = ssoEnabled ? ssoEnvironmentSchema.safeParse(environment) : null;
  const scimResult = scimEnabled ? scimEnvironmentSchema.safeParse(environment) : null;
  const invalidKeys = (result: z.ZodSafeParseResult<unknown> | null) => result && !result.success
    ? result.error.issues.map((issue) => String(issue.path[0] ?? "environment")) : [];
  const missing = [...core.missing, ...invalidKeys(deliveryResult), ...invalidKeys(webhookResult), ...invalidKeys(integrationResult), ...invalidKeys(observabilityResult), ...invalidKeys(ssoResult), ...invalidKeys(scimResult)];
  const delivery = deliveryResult.success;
  const webhooks = !webhooksEnabled || webhookResult?.success === true;
  const integrations = !integrationsEnabled || integrationResult?.success === true;
  const observability = !observabilityEnabled || observabilityResult?.success === true;
  const sso = !ssoEnabled || ssoResult?.success === true;
  const scim = !scimEnabled || scimResult?.success === true;
  return {
    valid: core.valid && delivery && webhooks && integrations && observability && sso && scim,
    core: core.valid,
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
    configured: core.configured + activeKeys.filter((key) => Boolean(environment[key]?.trim())).length,
    expected: core.expected + activeKeys.length,
    missing: [...new Set(missing)],
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
  return secret || environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
}

export function requireTrustedDeviceSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.TRUSTED_DEVICE_HASH_SECRET?.trim();
  if (environment.NODE_ENV === "production") {
    const parsed = productionSecret.safeParse(secret);
    if (!parsed.success) throw new Error("TRUSTED_DEVICE_HASH_SECRET_NOT_CONFIGURED");
  }
  return secret
    || environment.LOGIN_THROTTLE_HASH_SECRET?.trim()
    || environment.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || "lumina-local-trusted-device-development-key";
}
