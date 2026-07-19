import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-form";
import { MfaSecurityForm } from "@/components/first-login-security";
import { getCurrentUser, isMfaRequiredRole } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.mfa");
export default async function MfaChallengePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (user.aal === "aal2") redirect("/dashboard");
  if (!user.mfaEnabled) redirect(isMfaRequiredRole(user.role) ? "/mfa-setup" : "/dashboard");
  return <AuthLayout><MfaSecurityForm mode="challenge"/></AuthLayout>;
}
