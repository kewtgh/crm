import { z } from "zod";
import { captchaFallbackReasons } from "./captcha-types";

export const captchaProofSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("turnstile"),
    token: z.string().trim().min(1, "CAPTCHA_REQUIRED").max(32_768, "CAPTCHA_INVALID"),
  }),
  z.object({
    provider: z.literal("altcha"),
    token: z.string().trim().min(1, "CAPTCHA_REQUIRED").max(32_768, "CAPTCHA_INVALID"),
    fallbackReason: z.enum(captchaFallbackReasons),
  }),
]);

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "INVALID_IDENTIFIER").max(254, "INVALID_IDENTIFIER").refine(
    (value) => z.string().email().safeParse(value).success || /^[a-z][a-z0-9._-]{2,31}$/i.test(value),
    "INVALID_IDENTIFIER",
  ),
  password: z.string().min(8, "PASSWORD_TOO_SHORT"),
  captchaProof: captchaProofSchema.optional(),
  turnstileToken: z.string().trim().min(1, "TURNSTILE_REQUIRED").max(32_768, "CAPTCHA_INVALID").optional(),
  remember: z.preprocess((value) => value === true || value === "on", z.boolean()).default(false),
}).superRefine((value, context) => {
  if (!value.captchaProof && !value.turnstileToken) {
    context.addIssue({ code: "custom", path: ["captchaProof"], message: "CAPTCHA_REQUIRED" });
  }
}).transform(({ turnstileToken, ...value }) => ({
  ...value,
  captchaProof: value.captchaProof ?? { provider: "turnstile" as const, token: turnstileToken! },
}));

export const deviceVerificationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "INVALID_DEVICE_CODE"),
});

export const passwordValueSchema = z.string()
  .min(12, "PASSWORD_TOO_SHORT")
  .max(128, "PASSWORD_TOO_LONG")
  .regex(/[A-Z]/, "PASSWORD_COMPLEXITY")
  .regex(/[a-z]/, "PASSWORD_COMPLEXITY")
  .regex(/[0-9]/, "PASSWORD_COMPLEXITY");

export const initialPasswordSchema = z.object({
  newPassword: passwordValueSchema,
  confirmPassword: z.string(),
}).refine((value) => value.newPassword === value.confirmPassword, { message: "PASSWORD_MISMATCH", path: ["confirmPassword"] });

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("INVALID_EMAIL"),
  captchaProof: captchaProofSchema.optional(),
  turnstileToken: z.string().trim().min(1, "TURNSTILE_REQUIRED").max(32_768, "CAPTCHA_INVALID").optional(),
}).superRefine((value, context) => {
  if (!value.captchaProof && !value.turnstileToken) {
    context.addIssue({ code: "custom", path: ["captchaProof"], message: "CAPTCHA_REQUIRED" });
  }
}).transform(({ turnstileToken, ...value }) => ({
  ...value,
  captchaProof: value.captchaProof ?? { provider: "turnstile" as const, token: turnstileToken! },
}));

export const ssoStartSchema = z.object({
  email: z.email().max(320),
  captchaProof: captchaProofSchema.optional(),
  turnstileToken: z.string().trim().min(1, "TURNSTILE_REQUIRED").max(32_768, "CAPTCHA_INVALID").optional(),
}).superRefine((value, context) => {
  if (!value.captchaProof && !value.turnstileToken) {
    context.addIssue({ code: "custom", path: ["captchaProof"], message: "CAPTCHA_REQUIRED" });
  }
}).transform(({ turnstileToken, ...value }) => ({
  ...value,
  captchaProof: value.captchaProof ?? { provider: "turnstile" as const, token: turnstileToken! },
}));
