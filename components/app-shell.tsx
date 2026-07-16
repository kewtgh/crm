"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Bell,
  BookOpenCheck,
  Bot,
  Building2,
  CalendarCheck2,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  DatabaseZap,
  FileBarChart,
  GraduationCap,
  HeartHandshake,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  X,
} from "lucide-react";
import type { AppUser } from "@/lib/user";
import { ADMIN_ROLES, roleMessageKey } from "@/lib/roles";
import { APP_VERSION } from "@/lib/version";
import { AppUserProvider } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { LocaleSwitcher } from "./locale-switcher";

type NavItem = { labelKey: string; href?: string; icon: React.ElementType; badge?: string; children?: { labelKey: string; href: string; badge?: string }[] };

const navigation: { titleKey: string; items: NavItem[] }[] = [
  { titleKey: "nav.dashboard", items: [
    { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard },
    { labelKey: "nav.schedule", icon: CalendarRange, children: [
      { labelKey: "nav.calendar", href: "/calendar" },
      { labelKey: "nav.tasks", href: "/tasks", badge: "7" },
    ]},
    { labelKey: "nav.messages", href: "/messages", icon: MessageSquareText, badge: "3" },
  ]},
  { titleKey: "nav.relationships", items: [
    { labelKey: "nav.schools", href: "/schools", icon: Building2 },
    { labelKey: "nav.people", href: "/people", icon: Users },
    { labelKey: "nav.students", href: "/students", icon: GraduationCap },
    { labelKey: "nav.households", href: "/households", icon: HeartHandshake },
  ]},
  { titleKey: "nav.operations", items: [
    { labelKey: "nav.sales", icon: Target, children: [
      { labelKey: "nav.leads", href: "/leads", badge: "12" },
      { labelKey: "nav.opportunities", href: "/opportunities" },
      { labelKey: "nav.performance", href: "/sales/performance" },
      { labelKey: "nav.allocation", href: "/sales/allocation" },
      { labelKey: "nav.contracts", href: "/contracts", badge: "4" },
      { labelKey: "nav.products", href: "/products" },
    ]},
    { labelKey: "nav.progression", href: "/progression", icon: BookOpenCheck, badge: "4" },
    { labelKey: "nav.data", icon: DatabaseZap, children: [
      { labelKey: "nav.imports", href: "/imports" },
      { labelKey: "nav.duplicates", href: "/duplicates", badge: "9" },
      { labelKey: "nav.quality", href: "/data-quality" },
    ]},
    { labelKey: "nav.reports", icon: FileBarChart, children: [
      { labelKey: "nav.reportCenter", href: "/reports" },
      { labelKey: "nav.consumption", href: "/analytics/consumption" },
    ]},
    { labelKey: "nav.ai", href: "/ai", icon: Bot },
  ]},
  { titleKey: "nav.admin", items: [
    { labelKey: "nav.admin", icon: ShieldCheck, children: [
      { labelKey: "nav.dashboard", href: "/admin" },
      { labelKey: "nav.approvals", href: "/admin/approvals", badge: "7" },
      { labelKey: "nav.guardians", href: "/admin/guardians", badge: "6" },
      { labelKey: "nav.users", href: "/admin/users" },
      { labelKey: "nav.security", href: "/admin/security" },
    ]},
    { labelKey: "nav.settings", href: "/settings/profile", icon: Settings },
  ]},
];

export function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const visibleNavigation = useMemo(() => {
    const canAllocate = ADMIN_ROLES.includes(user.role) || user.role === "SALES_DIRECTOR" || user.role === "SALES_MANAGER";
    return navigation.map((group) => ({
      ...group,
      items: group.items
        .filter((item) => item.labelKey !== "nav.admin" || ADMIN_ROLES.includes(user.role))
        .map((item) => item.children ? { ...item, children: item.children.filter((child) => child.labelKey !== "nav.allocation" || canAllocate) } : item),
    })).filter((group) => group.items.length > 0);
  }, [user.role]);
  const [expanded, setExpanded] = useState<string[]>(() => navigation.flatMap((group) => group.items.filter((item) => item.children?.some((child) => pathname.startsWith(child.href))).map((item) => item.labelKey)));
  const searchResults = useMemo(() => {
    if (globalSearch.trim().length < 2) return [];
    const terms = locale === "zh-CN" ? [
      { title: "台北欧洲学校", detail: "学校", href: "/schools" },
      { title: "林俊佑 / Jay Lin", detail: "学生 · IB 一年级", href: "/students" },
      { title: "吴氏家庭", detail: "家庭 · 深圳", href: "/households" },
      { title: "UCAS 推荐信终稿", detail: "任务 · 今天到期", href: "/tasks" },
      { title: "双月日历与预约", detail: "日程 · 预约提醒", href: "/calendar" },
      { title: "Q3 销售目标", detail: "业绩 · 目标与预测", href: "/sales/performance" },
      { title: "客户合同与续约", detail: "合同 · 30/60/90 天提醒", href: "/contracts" },
    ] : [
      { title: "Taipei European School", detail: "School", href: "/schools" },
      { title: "林俊佑 / Jay Lin", detail: "Student · IB Year 1", href: "/students" },
      { title: "Wu Household", detail: "Household · Shenzhen", href: "/households" },
      { title: "Final UCAS reference", detail: "Task · Due today", href: "/tasks" },
      { title: "Two-month calendar", detail: "Schedule · Appointment alerts", href: "/calendar" },
      { title: "Q3 sales target", detail: "Performance · Target and forecast", href: "/sales/performance" },
      { title: "Customer contracts", detail: "Contracts · 30/60/90-day alerts", href: "/contracts" },
    ];
    return terms.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(globalSearch.toLowerCase()));
  }, [globalSearch, locale]);
  const closeMobile = () => setMobileOpen(false);

  return (
    <AppUserProvider user={user}>
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-overlay" onClick={closeMobile} aria-label={t("nav.close")} />}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label={t("nav.main")}>
        <div className="sidebar-header">
          <Link href="/dashboard" className="brand-lockup inverse" onClick={closeMobile}>
            <span className="brand-mark"><GraduationCap size={22} /></span>
            <span className="brand-words"><b>Lumina</b><small>Education CRM</small></span>
          </Link>
          <button className="mobile-close" type="button" onClick={closeMobile} aria-label={t("nav.close")}><X size={20} /></button>
        </div>
        <nav className="sidebar-nav">
          {visibleNavigation.map((group) => <div className="nav-group" key={group.titleKey}>
            <p>{t(group.titleKey)}</p>
            {group.items.map((item) => <NavEntry key={item.labelKey} item={item} pathname={pathname} expanded={expanded.includes(item.labelKey)} onExpand={() => setExpanded((current) => current.includes(item.labelKey) ? current.filter((value) => value !== item.labelKey) : [...current, item.labelKey])} onNavigate={closeMobile} />)}
          </div>)}
        </nav>
        <div className="sidebar-insight">
          <span><Sparkles size={16} /></span>
          <div><b>{t("nav.relationshipHealth")}</b><small>{t("nav.relationshipChange")}</small></div>
          <ChevronRight size={16} />
        </div>
        <button className="sidebar-collapse" type="button" onClick={() => setCollapsed((value) => !value)}><PanelLeftClose size={17} /><span>{t("nav.collapse")}</span><small>v{APP_VERSION}</small></button>
      </aside>

      <div className="app-column">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label={t("nav.open")}><Menu size={21} /></button>
            <div className="global-search-wrap">
              <label className="global-search"><Search size={18} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder={t("nav.globalSearch")} aria-label={t("nav.globalSearch")} /><kbd>⌘ K</kbd></label>
              {globalSearch && <div className="global-results">
                {searchResults.length ? searchResults.map((item) => <Link key={item.title} href={item.href} onClick={() => setGlobalSearch("")}><Search size={15} /><span><b>{item.title}</b><small>{item.detail}</small></span><ChevronRight size={15} /></Link>) : <p>{t("nav.noResults")}</p>}
              </div>}
            </div>
          </div>
          <div className="topbar-actions">
            <LocaleSwitcher compact />
            <Link className="top-icon" href="/help" aria-label={t("nav.help")}><HelpCircle size={19} /></Link>
            <div className="popover-anchor">
              <button className="top-icon" type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-label={t("nav.notifications")}><Bell size={19} /><i /></button>
              {notificationsOpen && <NotificationPopover user={user} close={() => setNotificationsOpen(false)} />}
            </div>
            <div className="topbar-divider" />
            <div className="popover-anchor">
              <button className="profile-trigger" type="button" onClick={() => setProfileOpen((value) => !value)}><span>{user.initials}</span><span className="profile-copy"><b>{user.displayNameZh} / {user.displayName}</b><small>{t(roleMessageKey[user.role])}</small></span><ChevronDown size={15} /></button>
              {profileOpen && <ProfilePopover user={user} close={() => setProfileOpen(false)} />}
            </div>
          </div>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
    </AppUserProvider>
  );
}

function NavEntry({ item, pathname, expanded, onExpand, onNavigate }: { item: NavItem; pathname: string; expanded: boolean; onExpand: () => void; onNavigate: () => void }) {
  const { t } = useI18n();
  const Icon = item.icon;
  const active = item.href ? pathname === item.href || pathname.startsWith(`${item.href}/`) : item.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`));
  if (item.children) return <div className={`nav-parent ${active ? "active" : ""}`}>
    <button type="button" className="nav-link" onClick={onExpand}><Icon size={18} /><span>{t(item.labelKey)}</span>{item.badge && <b className="nav-badge">{item.badge}</b>}<ChevronDown className={`nav-chevron ${expanded ? "rotate" : ""}`} size={15} /></button>
    {expanded && <div className="nav-children">{item.children.map((child) => <Link className={pathname === child.href ? "active" : ""} href={child.href} key={child.href} onClick={onNavigate}><span>{t(child.labelKey)}</span>{child.badge && <b className="nav-badge">{child.badge}</b>}</Link>)}</div>}
  </div>;
  return <Link className={`nav-link ${active ? "active" : ""}`} href={item.href ?? "#"} onClick={onNavigate}><Icon size={18} /><span>{t(item.labelKey)}</span>{item.badge && <b className="nav-badge">{item.badge}</b>}</Link>;
}

function NotificationPopover({ user, close }: { user: AppUser; close: () => void }) {
  const { t } = useI18n();
  return <div className="top-popover notifications"><div className="popover-heading"><span><b>{t("nav.notifications")}</b><small>{t("nav.unreadCount", { count: 3 })}</small></span><button type="button">{t("nav.markAllRead")}</button></div>
    <Link href="/tasks" onClick={close}><span className="notification-icon red"><CalendarCheck2 size={17} /></span><span><b>{t("nav.notification.tasks")}</b><small>{t("nav.notification.tasksDetail")}</small><time>{t("nav.notification.fiveMinutes")}</time></span></Link>
    {ADMIN_ROLES.includes(user.role) && <Link href="/admin/approvals" onClick={close}><span className="notification-icon purple"><ClipboardCheck size={17} /></span><span><b>{t("nav.notification.approval")}</b><small>{t("nav.notification.approvalDetail")}</small><time>{t("nav.notification.28Minutes")}</time></span></Link>}
    <Link href="/data-quality" onClick={close}><span className="notification-icon amber"><CircleGauge size={17} /></span><span><b>{t("nav.notification.quality")}</b><small>{t("nav.notification.qualityDetail")}</small><time>{t("nav.notification.oneHour")}</time></span></Link>
    <Link className="popover-footer" href="/messages" onClick={close}>{t("nav.notification.viewAll")} <ChevronRight size={15} /></Link>
  </div>;
}

function ProfilePopover({ user, close }: { user: AppUser; close: () => void }) {
  const { t } = useI18n();
  const roleLabel = t(roleMessageKey[user.role]);
  return <div className="top-popover profile-popover"><div className="profile-card"><span>{user.initials}</span><div><b>{user.displayNameZh} / {user.displayName}</b><small>@{user.username} · {user.email}</small><em>{roleLabel} · {t("nav.verified")}</em></div></div>
    <Link href="/settings/profile" onClick={close}><Settings size={17} />{t("nav.profileSettings")}</Link>
    <Link href={ADMIN_ROLES.includes(user.role) ? "/admin/security" : "/settings/security"} onClick={close}><ShieldCheck size={17} />{t("nav.security")} <span className="mini-good">{t("nav.mfaEnabled")}</span></Link>
    <Link href="/help" onClick={close}><HelpCircle size={17} />{t("nav.support")}</Link>
    <form action="/api/auth/logout" method="post"><button type="submit"><LogOut size={17} />{t("nav.signOut")}</button></form>
  </div>;
}
