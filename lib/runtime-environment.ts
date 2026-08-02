import {
  inspectCoreRuntimeEnvironment as inspectCoreRuntimeEnvironmentCore,
  inspectWebReadinessEnvironment as inspectWebReadinessEnvironmentCore,
  inspectWorkerRuntimeEnvironment as inspectWorkerRuntimeEnvironmentCore,
  isProductionSecret,
  WORKER_KEYS as runtimeWorkerKeys,
} from "./runtime-environment-core.mjs";

export type RuntimeEnvironmentStatus = {
  valid: boolean;
  configured: number;
  expected: number;
  missing: string[];
};

export const WORKER_KEYS = runtimeWorkerKeys as readonly [
  "REMINDERS", "NOTIFICATION_OUTBOX", "CALENDAR_DELIVERIES", "COMMUNICATION_DELIVERY",
  "GENERATED_JOBS", "WEBHOOK_INBOX", "INTEGRATION_SYNC",
];
export type WorkerKey = (typeof WORKER_KEYS)[number];

export type WorkerRuntimeEnvironmentStatus = RuntimeEnvironmentStatus & {
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
};

export function inspectCoreRuntimeEnvironment(environment: NodeJS.ProcessEnv = process.env): RuntimeEnvironmentStatus {
  return inspectCoreRuntimeEnvironmentCore(environment) as RuntimeEnvironmentStatus;
}

export function inspectWorkerRuntimeEnvironment(environment: NodeJS.ProcessEnv = process.env): WorkerRuntimeEnvironmentStatus {
  return inspectWorkerRuntimeEnvironmentCore(environment) as WorkerRuntimeEnvironmentStatus;
}

export function inspectWebReadinessEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  return inspectWebReadinessEnvironmentCore(environment) as RuntimeEnvironmentStatus & {
    core: boolean;
    emailDeliveryConfigured: null;
    emailDeliveryExternallyHealthy: null;
    emailDeliveryCode: null;
    webhooksEnabled: boolean;
    integrationsEnabled: boolean;
    enabledWorkers: WorkerKey[];
  };
}

export function requireLoginThrottleSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.LOGIN_THROTTLE_HASH_SECRET?.trim();
  if (environment.NODE_ENV === "production" && !isProductionSecret(secret)) throw new Error("LOGIN_THROTTLE_HASH_SECRET_NOT_CONFIGURED");
  return secret || "lumina-local-login-throttle-development-key";
}

export function requireTrustedDeviceSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.TRUSTED_DEVICE_HASH_SECRET?.trim();
  if (environment.NODE_ENV === "production" && !isProductionSecret(secret)) throw new Error("TRUSTED_DEVICE_HASH_SECRET_NOT_CONFIGURED");
  return secret || environment.LOGIN_THROTTLE_HASH_SECRET?.trim() || "lumina-local-trusted-device-development-key";
}
