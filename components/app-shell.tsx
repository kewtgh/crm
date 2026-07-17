"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BookOpenCheck,
  Bot,
  Building2,
  CalendarRange,
  ChevronDown,
  ChevronRight,
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
import type { NotificationRecord } from "@/lib/notifications-repository";

type NavItem = { labelKey: string; href?: string; icon: React.ElementType; badge?: string; children?: { labelKey: string; href: string; badge?: string }[] };

const navigation: { titleKey: string; items: NavItem[] }[] = [
  { titleKey: "nav.dashboard", items: [
    { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard },
    { labelKey: "nav.schedule", icon: CalendarRange, children: [
      { labelKey: "nav.calendar", href: "/calendar" },
    { labelKey: "nav.tasks", href: "/tasks" },
    ]},
    { labelKey: "nav.messages", href: "/messages", icon: MessageSquareText },
  ]},
  { titleKey: "nav.relationships", items: [
    { labelKey: "nav.schools", href: "/schools", icon: Building2 },
    { labelKey: "nav.people", href: "/people", icon: Users },
    { labelKey: "nav.students", href: "/students", icon: GraduationCap },
    { labelKey: "nav.households", href: "/households", icon: HeartHandshake },
  ]},
  { titleKey: "nav.operations", items: [
    { labelKey: "nav.sales", icon: Target, children: [
      { labelKey: "nav.leads", href: "/leads" },
      { labelKey: "nav.opportunities", href: "/opportunities" },
      { labelKey: "nav.performance", href: "/sales/performance" },
      { labelKey: "nav.allocation", href: "/sales/allocation" },
      { labelKey: "nav.contracts", href: "/contracts" },
      { labelKey: "nav.products", href: "/products" },
    ]},
    { labelKey: "nav.progression", href: "/progression", icon: BookOpenCheck },
    { labelKey: "nav.data", icon: DatabaseZap, children: [
      { labelKey: "nav.imports", href: "/imports" },
      { labelKey: "nav.duplicates", href: "/duplicates" },
      { labelKey: "nav.quality", href: "/data-quality" },
    ]},
    { labelKey: "nav.reports", icon: FileBarChart, children: [
      { labelKey: "nav.reportCenter", href: "/reports" },
      { labelKey: "nav.consumption", href: "/analytics/consumption" },
      { labelKey: "nav.exports", href: "/reports/exports" },
    ]},
    { labelKey: "nav.ai", href: "/ai", icon: Bot },
  ]},
  { titleKey: "nav.admin", items: [
    { labelKey: "nav.admin", icon: ShieldCheck, children: [
      { labelKey: "nav.dashboard", href: "/admin" },
      { labelKey: "nav.approvals", href: "/admin/approvals" },
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
  const [searchResults, setSearchResults] = useState<Array<{ title: string; detail: string; href: string }>>([]);
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
  useEffect(() => {
    const query = globalSearch.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search/related?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const result = await response.json() as { items?: Array<{ labelZh: string; labelEn: string; type: "ORGANIZATION" | "CONTACT" }> };
        if (!response.ok || !result.items) return;
        setSearchResults(result.items.map((item) => ({
          title: item.type === "CONTACT" ? item.labelZh : locale === "zh-CN" ? item.labelZh : item.labelEn,
          detail: t(item.type === "CONTACT" ? "nav.searchContact" : "nav.searchOrganization"),
          href: item.type === "CONTACT" ? "/people" : "/schools",
        })));
      } catch { /* A transient search failure leaves the result list empty. */ }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [globalSearch, locale, t]);
  const closeMobile = () => setMobileOpen(false);

  return (
    <AppUserProvider user={user}>
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-overlay" onClick={closeMobile} aria-label={t("nav.close")} />}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label={t("nav.main")}>
        <div className="sidebar-header">
          <Link href="/dashboard" className="brand-lockup inverse" onClick={closeMobile}>
            <span className="brand-mark"><GraduationCap size={22} /></span>
            <span className="brand-words"><b>{t("brand.short")}</b><small>{t("brand.product")}</small></span>
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
              <label className="global-search"><Search size={18} /><input value={globalSearch} onChange={(event) => { const value=event.target.value; setGlobalSearch(value); if(value.trim().length<2)setSearchResults([]); }} placeholder={t("nav.globalSearch")} aria-label={t("nav.globalSearch")} /><kbd>⌘ K</kbd></label>
              {globalSearch.trim().length >= 2 && <div className="global-results">
                {searchResults.length ? searchResults.map((item) => <Link key={item.title} href={item.href} onClick={() => setGlobalSearch("")}><Search size={15} /><span><b>{item.title}</b><small>{item.detail}</small></span><ChevronRight size={15} /></Link>) : <p>{t("nav.noResults")}</p>}
              </div>}
            </div>
          </div>
          <div className="topbar-actions">
            <LocaleSwitcher compact />
            <Link className="top-icon" href="/help" aria-label={t("nav.help")}><HelpCircle size={19} /></Link>
            <div className="popover-anchor">
              <button className="top-icon" type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-label={t("nav.notifications")}><Bell size={19} /></button>
              {notificationsOpen && <NotificationPopover close={() => setNotificationsOpen(false)} />}
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

function NotificationPopover({ close }: { close: () => void }) {
  const { locale,t } = useI18n();const [items,setItems]=useState<NotificationRecord[]>([]);const [total,setTotal]=useState(0);const [error,setError]=useState("");
  useEffect(()=>{let active=true;fetch("/api/notifications").then(async(response)=>{const result=await response.json() as {items?:NotificationRecord[];total?:number};if(!response.ok||!result.items)throw new Error();if(active){setItems(result.items);setTotal(result.total??result.items.length);}}).catch(()=>active&&setError(t("nav.notification.loadFailed")));return()=>{active=false};},[t]);
  const markAll=async()=>{const response=await fetch("/api/notifications",{method:"PATCH",headers:{"content-type":"application/json"},body:"{}"});if(response.ok){setItems([]);setTotal(0);}else setError(t("nav.notification.markFailed"));};
  const href=(item:NotificationRecord)=>item.sourceType==="CONTRACT"?"/contracts":item.sourceType==="APPOINTMENT"?"/calendar":item.sourceType==="EXPORT"?"/reports/exports":"/tasks";
  const notificationTime=(date:string)=>new Intl.DateTimeFormat(locale==="zh-CN"?"zh-CN":"en",{dateStyle:"medium",timeStyle:"short"}).format(new Date(date));
  return <div className="top-popover notifications"><div className="popover-heading"><span><b>{t("nav.notifications")}</b><small>{t("nav.unreadCount", { count: total })}</small></span><button type="button" disabled={!items.length} onClick={markAll}>{t("nav.markAllRead")}</button></div>
    {error&&<p className="popover-error" role="alert">{error}</p>}{items.map((item)=><Link href={href(item)} onClick={close} key={item.id}><span className="notification-icon purple"><Bell size={17}/></span><span><b>{t(item.titleKey,item.values)}</b><small>{t(item.bodyKey,item.values)}</small><time>{notificationTime(item.createdAt)}</time></span></Link>)}
    {!items.length&&!error&&<p className="popover-empty">{t("nav.notification.empty")}</p>}
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
