import { z } from "zod";

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, "INVALID_IDENTIFIER").max(254, "INVALID_IDENTIFIER").refine(
    (value) => z.string().email().safeParse(value).success || /^[a-z][a-z0-9._-]{2,31}$/i.test(value),
    "INVALID_IDENTIFIER",
  ),
  password: z.string().min(8, "PASSWORD_TOO_SHORT"),
  turnstileToken: z.string().trim().min(1, "TURNSTILE_REQUIRED"),
  remember: z.preprocess((value) => value === true || value === "on", z.boolean()).default(false),
});

export const deviceVerificationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "INVALID_DEVICE_CODE"),
});

export const initialPasswordSchema = z.object({
  newPassword: z.string().min(12, "PASSWORD_TOO_SHORT").regex(/[A-Z]/, "PASSWORD_COMPLEXITY").regex(/[a-z]/, "PASSWORD_COMPLEXITY").regex(/[0-9]/, "PASSWORD_COMPLEXITY"),
  confirmPassword: z.string(),
}).refine((value) => value.newPassword === value.confirmPassword, { message: "PASSWORD_MISMATCH", path: ["confirmPassword"] });

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("INVALID_EMAIL"),
  turnstileToken: z.string().trim().min(1, "TURNSTILE_REQUIRED"),
});
