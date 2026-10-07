import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../components/app-shell";
import { I18nProvider } from "../../components/i18n-provider";
import { ExecutiveOverviewPage } from "../../components/executive-overview-page";
import { StudentSuccessWorkspace } from "../../components/student-success-workspace";
import { zhCN } from "../../lib/i18n/locales/zh-CN";
import type { AppRole } from "../../lib/roles";
import { usePathname, qaNavigate } from "./ux-foundation-navigation";
declare global { interface Window { managementNavigate: (href: string) => void; managementReload: () => void; managementRole: (role: AppRole) => void; } }
function Fixture() {
  const [revision, setRevision] = useState(0), [role, setRole] = useState<AppRole>("ADMIN"), pathname = usePathname();
  useEffect(() => { window.managementNavigate = qaNavigate; window.managementReload = () => setRevision(value => value + 1); window.managementRole = setRole; }, []);
  const user = { id: "00000000-0000-4000-8000-000000000099", username: "advisor-a", email: "advisor@example.test", displayName: "Advisor A", displayNameZh: "顾问甲", role, initials: "AA", mustChangePassword: false, mfaEnabled: true, aal: "aal2" as const, emailVerified: true, accountStatus: "ACTIVE" as const };
  return <AppShell user={user} relationshipHealth={{ hasData: true, score: 78, weeklyDelta: 3, sampleSize: 12, basis: "RELATIONSHIP_MILESTONES" }} preferences={{ timezone: "Asia/Taipei", dateFormat: "yyyy-MM-dd" }} preferredLocale="zh-CN"><div key={`${pathname}:${revision}`}>{pathname === "/student-success" ? <StudentSuccessWorkspace initial={null} initialView="analytics"/> : <ExecutiveOverviewPage/>}</div></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
