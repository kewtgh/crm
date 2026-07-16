import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱 / Enter a valid email"),
  password: z.string().min(8, "密码至少 8 位 / Minimum 8 characters"),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱 / Enter a valid email"),
});

export const registerSchema = z
  .object({
    chineseName: z.string().trim().min(2, "请输入中文姓名 / Enter Chinese name"),
    englishName: z.string().trim().min(2, "请输入英文姓名 / Enter English name"),
    email: z.string().trim().email("请输入有效邮箱 / Enter a valid email"),
    password: z
      .string()
      .min(10, "密码至少 10 位 / Minimum 10 characters")
      .regex(/[A-Z]/, "至少包含一个大写字母 / Add an uppercase letter")
      .regex(/[0-9]/, "至少包含一个数字 / Add a number"),
    confirmPassword: z.string(),
    agreement: z.literal(true, {
      error: "请同意服务条款与隐私政策 / Please accept the terms",
    }),
    turnstileToken: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次密码不一致 / Passwords do not match",
    path: ["confirmPassword"],
  });
