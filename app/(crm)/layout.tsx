import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { isMfaRequiredRole } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  if (isMfaRequiredRole(user.role) && user.aal !== "aal2") redirect(user.mfaEnabled ? "/mfa-challenge" : "/mfa-setup");
  return <AppShell user={user}>{children}</AppShell>;
}
