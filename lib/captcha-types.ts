export const captchaActions = ["staff_login", "password_recovery"] as const;
export type CaptchaAction = (typeof captchaActions)[number];

export const captchaProviders = ["turnstile", "altcha"] as const;
export type CaptchaProvider = (typeof captchaProviders)[number];

export const captchaFallbackReasons = [
  "script_load_failed",
  "load_timeout",
  "component_error",
  "verification_timeout",
  "token_expired",
  "service_unavailable",
  "not_configured",
  "administrator_disabled",
] as const;
export type CaptchaFallbackReason = (typeof captchaFallbackReasons)[number];

export type CaptchaProof = {
  provider: CaptchaProvider;
  token: string;
  fallbackReason?: CaptchaFallbackReason;
};

export type CaptchaProviderState = {
  provider: CaptchaProvider;
  fallbackReason?: CaptchaFallbackReason;
};

export type TurnstileFailureEvent =
  | "script_error"
  | "load_timeout"
  | "component_error"
  | "verification_timeout"
  | "token_expired"
  | "service_unavailable"
  | "not_configured";

const fallbackReasonByEvent: Record<TurnstileFailureEvent, CaptchaFallbackReason> = {
  script_error: "script_load_failed",
  load_timeout: "load_timeout",
  component_error: "component_error",
  verification_timeout: "verification_timeout",
  token_expired: "token_expired",
  service_unavailable: "service_unavailable",
  not_configured: "not_configured",
};

export function fallbackFromTurnstile(event: TurnstileFailureEvent): CaptchaProviderState {
  return { provider: "altcha", fallbackReason: fallbackReasonByEvent[event] };
}
