import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("INVALID_EMAIL"),
  password: z.string().min(8, "PASSWORD_TOO_SHORT"),
  turnstileToken: z.string().trim().min(1, "TURNSTILE_REQUIRED"),
  remember: z.preprocess((value) => value === true || value === "on", z.boolean()).default(false),
});

export const initialPasswordSchema = z.object({
  newPassword: z.string().min(12, "PASSWORD_TOO_SHORT").regex(/[A-Z]/, "PASSWORD_COMPLEXITY").regex(/[a-z]/, "PASSWORD_COMPLEXITY").regex(/[0-9]/, "PASSWORD_COMPLEXITY"),
  confirmPassword: z.string(),
}).refine((value) => value.newPassword === value.confirmPassword, { message: "PASSWORD_MISMATCH", path: ["confirmPassword"] });

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("INVALID_EMAIL"),
  turnstileToken: z.string().trim().min(1, "TURNSTILE_REQUIRED"),
});
