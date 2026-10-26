import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { shouldChallengeMfa } from "@/lib/auth";
import { redirect } from "next/navigation";
import { emptyRelationshipHealth, loadWorkspaceRelationshipHealth } from "@/lib/workspace-metrics";
import { loadUserSettings } from "@/lib/settings-repository";
import {DEFAULT_TIMEZONE} from "@/lib/timezone";
import {getRequestLocale} from "@/lib/page-metadata";
import {settingsReadSchema} from "@/lib/settings-contract";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  if (shouldChallengeMfa(user) && user.aal !== "aal2") redirect(user.mfaEnabled ? "/mfa-challenge" : "/mfa-setup");
  const [relationshipResult,settings] = await Promise.all([
    loadWorkspaceRelationshipHealth()
      .then((value) => ({ value, unavailable: false }))
      .catch(() => ({ value: emptyRelationshipHealth, unavailable: true })),
    loadUserSettings(user).then(settings=>settingsReadSchema.parse({settings,email:user.email}).settings).catch(()=>null),
  ]);
  return <AppShell user={user} relationshipHealth={relationshipResult.value} relationshipHealthUnavailable={relationshipResult.unavailable} preferencesUnavailable={settings===null} preferences={settings?{timezone:settings.timezone,dateFormat:settings.dateFormat}:{timezone:DEFAULT_TIMEZONE,dateFormat:"yyyy-MM-dd"}} preferredLocale={settings?.locale??await getRequestLocale()} avatarSource={settings?.avatarPath ? `/api/settings/avatar?v=${encodeURIComponent(settings.avatarPath)}` : null}>{children}</AppShell>;
}
