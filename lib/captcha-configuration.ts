import { poolQuery } from "./db/pools";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function loadTurnstileEnabled() {
  const workspaceId = process.env.CRM_WORKSPACE_ID?.trim();
  if (!workspaceId || !uuidPattern.test(workspaceId)) {
    throw new Error("CAPTCHA_WORKSPACE_NOT_CONFIGURED");
  }
  const result = await poolQuery<{ turnstile_enabled: boolean }>(
    "system",
    `select turnstile_enabled
     from public.workspaces
     where id = $1
     limit 1`,
    [workspaceId],
  );
  const value = result.rows[0]?.turnstile_enabled;
  if (typeof value !== "boolean") throw new Error("CAPTCHA_WORKSPACE_NOT_FOUND");
  return value;
}

export type CaptchaProviderConfiguration =
  | { status: "ready"; turnstileEnabled: boolean }
  | { status: "unavailable"; code: "CAPTCHA_CONFIGURATION_UNAVAILABLE" };

export async function loadCaptchaProviderConfiguration(
  loader: () => Promise<boolean> = loadTurnstileEnabled,
): Promise<CaptchaProviderConfiguration> {
  try {
    return { status: "ready", turnstileEnabled: await loader() };
  } catch {
    return { status: "unavailable", code: "CAPTCHA_CONFIGURATION_UNAVAILABLE" };
  }
}
