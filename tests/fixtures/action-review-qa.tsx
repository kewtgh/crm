import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionCenterPage } from "../../components/action-center-page";
import { DashboardPage } from "../../components/dashboard-page";
import { I18nProvider, useI18n } from "../../components/i18n-provider";
import { AppUserProvider } from "../../components/app-user-context";
import { UserPreferencesProvider } from "../../components/user-preferences-context";
import type { ActionCenterSnapshot, ActionCenterItem } from "../../lib/action-center-repository";
import type { AppRole } from "../../lib/roles";
import { zhCN } from "../../lib/i18n/locales/zh-CN";
import { qaNavigate } from "./ux-foundation-navigation";

const items: ActionCenterItem[] = [
  { id: "overdue-tasks", category: "work", priority: "urgent", count: 2, titleKey: "actionCenter.item.overdueTasks", detailKey: "actionCenter.item.overdueTasksHelp", href: "/tasks?queue=overdue", source: "live_aggregate" },
  { id: "today-tasks", category: "work", priority: "high", count: 3, titleKey: "actionCenter.item.todayTasks", detailKey: "actionCenter.item.todayTasksHelp", href: "/tasks?queue=today", source: "live_aggregate" },
  { id: "pending-approvals", category: "governance", priority: "urgent", count: 7, titleKey: "actionCenter.item.approvals", detailKey: "actionCenter.item.approvalsHelp", href: "/approvals", source: "live_aggregate" },
  { id: "renewals", category: "sales", priority: "high", count: 4, titleKey: "actionCenter.item.renewals", detailKey: "actionCenter.item.renewalsHelp", href: "/contracts", source: "live_aggregate" },
  { id: "notifications", category: "work", priority: "normal", count: 5, titleKey: "actionCenter.item.notifications", detailKey: "actionCenter.item.notificationsHelp", href: "/notifications", source: "live_aggregate" },
];
const initial: ActionCenterSnapshot = { role: "SALES_SPECIALIST", generatedAt: "2026-10-23T03:00:00Z", items, total: 21, urgent: 9, unavailableSources: [] };
declare global { interface Window {
  actionNavigate: (href: string) => void;
  actionScenario: (name: string, role?: AppRole) => void;
} }
function Fixture() {
  const { setLocale } = useI18n();
  const [scenario, setScenario] = useState({ name: "normal", role: "SALES_SPECIALIST" as AppRole, key: 0 });
  useEffect(() => {
    window.actionNavigate = qaNavigate;
    window.actionScenario = (name, role = "SALES_SPECIALIST") => {
      localStorage.setItem("lumina:dashboard-mode:00000000-0000-4000-8000-000000000099", "daily");
      setScenario(previous => ({ name, role, key: previous.key + 1 }));
    };
  }, []);
  const user = { id: "00000000-0000-4000-8000-000000000099", username: "fictional-advisor", email: "advisor@example.test", displayName: "Advisor A", displayNameZh: "示例顾问", role: scenario.role, initials: "AA", mustChangePassword: false, mfaEnabled: true, aal: "aal2" as const, emailVerified: true, accountStatus: "ACTIVE" as const };
  const snapshot = { ...initial, items: scenario.name.includes("empty") ? [] : items, total: scenario.name.includes("empty") ? 0 : 21, urgent: scenario.name.includes("empty") ? 0 : 9, unavailableSources: scenario.name.startsWith("partial") ? ["approvals" as const] : [] };
  const dashboard = { todayTasks: 3, overdueTasks: 2, pendingApprovals: 7, renewalsDue: 4, riskContracts: 1, activeProducts: 1, unreadNotifications: 5, newLeads: 2, activeStudents: 3, pendingProgression: 1, activeCampaigns: 0, attributedLeads: 0, pendingAdmissions: 0, monthRevenueByCurrency: { USD: 100 }, approvalUnavailable: scenario.name === "dashboard-unknown", focusTasks: [{ id: "00000000-0000-4000-8000-000000000001", titleZh: "示例回访任务", titleEn: "Example follow-up task", related: "Fictional Academy", dueAt: "2026-10-23T03:00:00Z", status: "TODO", priority: "HIGH" }] };
  return <AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{ timezone: "Asia/Taipei", dateFormat: "yyyy-MM-dd" }}><main className="page-stack" style={{ padding: 16 }}><nav className="page-actions"><button onClick={() => void setLocale("zh-CN")}>QA 中文</button><button onClick={() => void setLocale("en")}>QA English</button></nav>{scenario.name.startsWith("dashboard") ? <DashboardPage key={scenario.key} initialSnapshot={dashboard} /> : <ActionCenterPage key={scenario.key} snapshot={snapshot} />}</main></UserPreferencesProvider></AppUserProvider>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture /></I18nProvider>);
