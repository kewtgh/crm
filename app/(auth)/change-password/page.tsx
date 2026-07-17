import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-form";
import { InitialPasswordChangeForm } from "@/components/first-login-security";
import { getCurrentUser, nextAuthenticatedPath } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.initialPassword");
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect(nextAuthenticatedPath(user));
  return <AuthLayout><InitialPasswordChangeForm/></AuthLayout>;
}
