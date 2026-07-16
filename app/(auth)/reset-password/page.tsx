import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth-form";
import { NewPasswordForm } from "@/components/password-reset-forms";

export const metadata: Metadata = { title: "设置新密码 · Lumina CRM" };

export default function ResetPasswordPage() {
  return <AuthLayout mode="login"><NewPasswordForm /></AuthLayout>;
}
