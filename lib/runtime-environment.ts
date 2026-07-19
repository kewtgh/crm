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
