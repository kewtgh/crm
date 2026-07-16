import type { Metadata } from "next";
import { AuthForm, AuthLayout } from "@/components/auth-form";
import { redirectAuthenticatedUser } from "@/lib/auth";

export const metadata: Metadata = { title: "家长注册 · Lumina CRM" };

export default async function RegisterPage() {
  await redirectAuthenticatedUser();
  return <AuthLayout mode="register"><AuthForm mode="register" /></AuthLayout>;
}
