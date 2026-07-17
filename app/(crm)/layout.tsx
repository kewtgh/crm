import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { isMfaRequiredRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { emptyRelationshipHealth, loadWorkspaceRelationshipHealth } from "@/lib/workspace-metrics";
import { loadUserSettings } from "@/lib/settings-repository";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  if (isMfaRequiredRole(user.role) && user.aal !== "aal2") redirect(user.mfaEnabled ? "/mfa-challenge" : "/mfa-setup");
  const [relationshipHealth,settings] = await Promise.all([
    loadWorkspaceRelationshipHealth().catch(() => emptyRelationshipHealth),
    loadUserSettings(user),
  ]);
  return <AppShell user={user} relationshipHealth={relationshipHealth} preferences={{timezone:settings.timezone,dateFormat:settings.dateFormat}}>{children}</AppShell>;
}
