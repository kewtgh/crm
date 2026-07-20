import { z } from "zod";

const configured = z.string().trim().min(1);
const productionSecret = z.string().trim().min(32).refine(
  (value) => !/replace-with|change-me|example-secret/i.test(value),
  "Placeholder secrets are not allowed",
);

export const coreRuntimeEnvironmentSchema = z.object({
  APP_URL: z.url(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: configured,
  TURNSTILE_SECRET_KEY: productionSecret,
  TURNSTILE_EXPECTED_HOSTNAME: configured,
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: configured,
  SUPABASE_SERVICE_ROLE_KEY: configured,
  CRM_WORKSPACE_ID: z.uuid(),
  LOGIN_THROTTLE_HASH_SECRET: productionSecret,
  TRUSTED_DEVICE_HASH_SECRET: productionSecret,
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

export type WorkerRuntimeEnvironmentStatus = {
  valid: boolean;
  core: boolean;
  delivery: boolean;
  webhooks: boolean;
  integrations: boolean;
  webhooksEnabled: boolean;
  integrationsEnabled: boolean;
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
  const enabledWorkers: WorkerKey[] = [
    "REMINDERS",
    "NOTIFICATION_OUTBOX",
    "CALENDAR_DELIVERIES",
    "GENERATED_JOBS",
    ...(webhooksEnabled ? ["WEBHOOK_INBOX" as const] : []),
    ...(integrationsEnabled ? ["INTEGRATION_SYNC" as const] : []),
  ];
  const activeGroups = [
    deliveryKeys,
    ...(webhooksEnabled ? [webhookKeys] : []),
    ...(integrationsEnabled ? [integrationKeys] : []),
  ];
  const activeKeys = activeGroups.flat();
  const missing = [
    ...core.missing,
    ...activeKeys.filter((key) => !environment[key]?.trim()),
  ];
  const delivery = deliveryKeys.every((key) => Boolean(environment[key]?.trim()));
  const webhooks = !webhooksEnabled || webhookKeys.every((key) => Boolean(environment[key]?.trim()));
  const integrations = !integrationsEnabled || integrationKeys.every((key) => Boolean(environment[key]?.trim()));
  return {
    valid: core.valid && delivery && webhooks && integrations,
    core: core.valid,
    delivery,
    webhooks,
    integrations,
    webhooksEnabled,
    integrationsEnabled,
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
