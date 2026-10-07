import { hasCapability, type Capability } from "./capabilities";
import type { AppRole } from "./roles";

export type NavigationSpace = "work" | "relationships" | "students" | "commercial" | "management" | "governance" | "admin" | "account";
type Match = { pathname: string; descendants?: boolean; query?: Record<string, string>; notQuery?: Record<string, string> };
export type NavigationDestination = {
  id: string; space: NavigationSpace; labelKey: string; href: string;
  matches: readonly Match[]; capability?: Capability; roles?: readonly AppRole[];
  guard: "AUTH_RLS" | "CAPABILITY" | "ROLE_AND_CAPABILITY";
  secondary?: boolean; documentNavigation?: boolean;
};
const entry = (id: string, space: NavigationSpace, labelKey: string, href: string, capability?: Capability, secondary = false): NavigationDestination => ({
  id, space, labelKey, href, capability, secondary, guard: capability ? "CAPABILITY" : "AUTH_RLS",
  matches: [{ pathname: href.split("?")[0], descendants: true }],
});
const adminRoles: readonly AppRole[] = ["ADMIN", "SUPER_ADMIN"];
export const navigationDestinations: readonly NavigationDestination[] = [
  entry("dashboard", "work", "nav.dashboard", "/dashboard"),
  entry("action-center", "work", "nav.actionCenter", "/action-center"),
  entry("tasks", "work", "ux.nav.tasks", "/tasks", "tasks.view"),
  entry("calendar", "work", "nav.calendar", "/calendar", "calendar.view"),
  entry("approvals", "work", "ux.nav.approvals", "/approvals", "approvals.decide"),
  { ...entry("messages", "work", "nav.messages", "/messages", "messages.view", true), matches: [{ pathname: "/messages" }, { pathname: "/notifications" }] },
  entry("portal", "work", "nav.guardianPortal", "/guardian-portal", "portal.manage", true),
  entry("organizations", "relationships", "nav.schools", "/schools"),
  entry("contacts", "relationships", "ux.nav.contacts", "/people"),
  { ...entry("students", "students", "ux.nav.students", "/students", "education.view"), matches: [{ pathname: "/students", descendants: true }, { pathname: "/households", notQuery: { tab: "families" } }] },
  { ...entry("families", "students", "ux.nav.families", "/households?tab=families", "education.view"), matches: [{ pathname: "/households", query: { tab: "families" } }] },
  entry("enrollments", "students", "ux.nav.enrollments", "/enrollments", "education.view"),
  entry("applications", "students", "ux.nav.applications", "/applications", "education.view"),
  entry("support", "students", "success.title", "/student-success", "education.view"),
  entry("progression", "students", "ux.nav.progression", "/progression", "progression.manage"),
  entry("leads", "commercial", "nav.leads", "/leads", "leads.view"),
  entry("opportunities", "commercial", "nav.opportunities", "/opportunities", "opportunities.view"),
  entry("products", "commercial", "nav.products", "/products"),
  entry("contracts", "commercial", "nav.contracts", "/contracts", "contracts.view"),
  entry("finance", "commercial", "nav.finance", "/finance", "finance.view"),
  entry("commissions", "commercial", "ux.nav.commissions", "/commissions", "finance.view"),
  entry("growth", "commercial", "nav.growth", "/growth", "leads.view", true),
  entry("executive", "management", "management.title", "/reports/executive", "education.view"),
  entry("channels", "management", "channelAnalytics.title", "/reports/channels", "education.view"),
  { ...entry("performance", "management", "nav.performance", "/sales/performance"), matches: [{ pathname: "/sales/performance" }, { pathname: "/sales/allocation" }] },
  entry("reports", "management", "nav.reportCenter", "/reports", undefined, true),
  entry("consumption", "management", "nav.consumption", "/analytics/consumption", undefined, true),
  entry("exports", "management", "nav.exports", "/reports/exports", "exports.request", true),
  entry("imports", "governance", "nav.imports", "/imports", "imports.view"),
  entry("quality", "governance", "nav.quality", "/data-quality", "dataQuality.manage"),
  entry("duplicates", "governance", "nav.duplicates", "/duplicates", "duplicates.manage"),
  entry("workflows", "governance", "workflow.templates", "/workflow-templates", "education.view"),
  entry("education-business", "governance", "business.title", "/education-business", "education.view", true),
  entry("privacy", "governance", "nav.privacyRequests", "/privacy-requests", "privacyRequests.manage", true),
  entry("ai", "governance", "ux.nav.ai", "/ai", "ai.review", true),
  entry("automation", "governance", "ux.nav.automation", "/automation", "automation.manage", true),
  ...[
    ["admin", "nav.adminOverview", "/admin", "admin.access"],
    ["admin-approvals", "nav.approvals", "/admin/approvals", "admin.access"],
    ["admin-operations", "nav.operationsCenter", "/admin/operations", "admin.access"],
    ["admin-workspace", "nav.workspaceSettings", "/admin/workspace", "admin.access"],
    ["admin-users", "nav.users", "/admin/users", "users.manage"],
    ["admin-recycle", "nav.recycleBin", "/admin/recycle-bin", "admin.access"],
    ["admin-security", "nav.security", "/admin/security", "admin.access"],
  ].map(([id, labelKey, href, capability]) => ({ ...entry(id, "admin", labelKey, href, capability as Capability), guard: "ROLE_AND_CAPABILITY" as const, roles: id === "admin-recycle" ? ["SUPER_ADMIN" as const] : adminRoles, documentNavigation: true })),
  { ...entry("settings", "account", "nav.settings", "/settings/profile"), matches: [{ pathname: "/settings", descendants: true }] },
];

export function visibleDestinations(role: AppRole) {
  return navigationDestinations.filter(d => (!d.roles || d.roles.includes(role)) && (!d.capability || hasCapability(role, d.capability)));
}
export function destinationMatches(destination: NavigationDestination, pathname: string, query: Pick<URLSearchParams, "get">) {
  return destination.matches.some(match => (pathname === match.pathname || Boolean(match.descendants && pathname.startsWith(`${match.pathname}/`)))
    && Object.entries(match.query ?? {}).every(([key, value]) => query.get(key) === value)
    && Object.entries(match.notQuery ?? {}).every(([key, value]) => query.get(key) !== value));
}
export function activeDestination(pathname: string, query: Pick<URLSearchParams, "get">, destinations: readonly NavigationDestination[]) {
  // Match against the complete contract before applying visibility: a restricted
  // child must never fall back to its accessible generic parent command.
  const winner = [...navigationDestinations].filter(d => destinationMatches(d, pathname, query))
    .sort((a, b) => Math.max(...b.matches.map(m => m.pathname.length)) - Math.max(...a.matches.map(m => m.pathname.length)))[0];
  return winner && destinations.find(d => d.id === winner.id);
}
