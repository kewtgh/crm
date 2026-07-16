import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("INVALID_EMAIL"),
  password: z.string().min(8, "PASSWORD_TOO_SHORT"),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("INVALID_EMAIL"),
});

export const registerSchema = z
  .object({
    username: z.string().trim().toLowerCase().min(3, "USERNAME_TOO_SHORT").max(32, "USERNAME_TOO_LONG").regex(/^[a-z][a-z0-9._-]+$/, "USERNAME_INVALID"),
    chineseName: z.string().trim().min(2, "CHINESE_NAME_REQUIRED"),
    englishName: z.string().trim().min(2, "ENGLISH_NAME_REQUIRED"),
    email: z.string().trim().email("INVALID_EMAIL"),
    password: z
      .string()
      .min(10, "PASSWORD_TOO_SHORT")
      .regex(/[A-Z]/, "PASSWORD_NEEDS_UPPERCASE")
      .regex(/[0-9]/, "PASSWORD_NEEDS_NUMBER"),
    confirmPassword: z.string(),
    agreement: z.literal(true, {
      error: "AGREEMENT_REQUIRED",
    }),
    turnstileToken: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "PASSWORD_MISMATCH",
    path: ["confirmPassword"],
  });
