import { AuthForm, AuthLayout } from "@/components/auth-form";
import { redirectAuthenticatedUser } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.register");

export default async function RegisterPage() {
  await redirectAuthenticatedUser();
  return <AuthLayout mode="register"><AuthForm mode="register" /></AuthLayout>;
}
