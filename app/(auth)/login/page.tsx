import { AuthForm, AuthLayout } from "@/components/auth-form";
import { redirectAuthenticatedUser } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.login");

export default async function LoginPage() {
  await redirectAuthenticatedUser();
  return <AuthLayout mode="login"><AuthForm mode="login" demoMode={process.env.CRM_DEMO_MODE === "true"} /></AuthLayout>;
}
