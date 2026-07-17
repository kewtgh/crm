"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Building2,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  DatabaseZap,
  FileBarChart,
  GraduationCap,
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
import type { RelationshipHealth } from "@/lib/workspace-metrics";

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
  ]},
  { titleKey: "nav.operations", items: [
    { labelKey: "nav.sales", icon: Target, children: [
      { labelKey: "nav.opportunities", href: "/opportunities" },
      { labelKey: "nav.performance", href: "/sales/performance" },
      { labelKey: "nav.allocation", href: "/sales/allocation" },
      { labelKey: "nav.contracts", href: "/contracts" },
      { labelKey: "nav.products", href: "/products" },
      { labelKey: "nav.finance", href: "/finance" },
    ]},
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
  ]},
  { titleKey: "nav.admin", items: [
    { labelKey: "nav.admin", icon: ShieldCheck, children: [
      { labelKey: "nav.dashboard", href: "/admin" },
      { labelKey: "nav.approvals", href: "/admin/approvals" },
      { labelKey: "nav.operationsCenter", href: "/admin/operations" },
      { labelKey: "nav.users", href: "/admin/users" },
      { labelKey: "nav.security", href: "/admin/security" },
    ]},
  ]},
  { titleKey: "nav.account", items: [
    { labelKey: "nav.settings", href: "/settings/profile", icon: Settings },
  ]},
];

export function AppShell({ user, relationshipHealth, children }: { user: AppUser; relationshipHealth: RelationshipHealth; children: React.ReactNode }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ title: string; detail: string; href: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeResult, setActiveResult] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
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
      setSearchLoading(true);
      setSearchError("");
      try {
        const response = await fetch(`/api/search/related?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const result = await response.json() as { items?: Array<{ value:string;labelZh: string; labelEn: string; type: "ORGANIZATION" | "CONTACT" }> };
        if (!response.ok || !result.items) throw new Error();
        setSearchResults(result.items.map((item) => ({
          title: item.type === "CONTACT" ? item.labelZh : locale === "zh-CN" ? item.labelZh : item.labelEn,
          detail: t(item.type === "CONTACT" ? "nav.searchContact" : "nav.searchOrganization"),
          href: item.type === "CONTACT" ? `/people/${item.value.split(":")[1]??""}` : `/schools/${item.value.split(":")[1]??""}`,
        })));
        setActiveResult(-1);
      } catch {
        if (!controller.signal.aborted) {
          setSearchResults([]);
          setSearchError(t("nav.searchFailed"));
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [globalSearch, locale, t]);
  const changeSearch = (value: string) => {
    setGlobalSearch(value);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError("");
      setActiveResult(-1);
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setProfileOpen(false);
        setNotificationsOpen(false);
        setGlobalSearch("");
        setSearchResults([]);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!profileRef.current?.contains(target)) setProfileOpen(false);
      if (!notificationsRef.current?.contains(target)) setNotificationsOpen(false);
      if (!searchWrapRef.current?.contains(target)) {
        setGlobalSearch("");
        setSearchResults([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);
  const searchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult((current) => Math.min(searchResults.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult((current) => Math.max(-1, current - 1));
    } else if (event.key === "Enter" && activeResult >= 0 && searchResults[activeResult]) {
      event.preventDefault();
      window.location.assign(searchResults[activeResult].href);
    } else if (event.key === "Escape") {
      setGlobalSearch("");
      setSearchResults([]);
      searchInputRef.current?.blur();
    }
  };
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
          <div><b>{relationshipHealth.hasData && relationshipHealth.score !== null ? t("nav.relationshipHealthValue", { score: relationshipHealth.score }) : t("nav.relationshipHealthEmpty")}</b><small>{relationshipHealth.hasData && relationshipHealth.weeklyDelta !== null ? t("nav.relationshipChangeValue", { delta: relationshipHealth.weeklyDelta }) : t("nav.relationshipSample", { count: relationshipHealth.sampleSize })}</small></div>
          <ChevronRight size={16} />
        </div>
        <button className="sidebar-collapse" type="button" onClick={() => setCollapsed((value) => !value)}><PanelLeftClose size={17} /><span>{t("nav.collapse")}</span><small>v{APP_VERSION}</small></button>
      </aside>

      <div className="app-column">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label={t("nav.open")}><Menu size={21} /></button>
            <div className="global-search-wrap" ref={searchWrapRef}>
              <label className="global-search"><Search size={18} /><input ref={searchInputRef} role="combobox" aria-autocomplete="list" aria-expanded={globalSearch.trim().length >= 2} aria-controls="global-search-results" aria-activedescendant={activeResult >= 0 ? `global-result-${activeResult}` : undefined} value={globalSearch} onKeyDown={searchKeyDown} onChange={(event) => changeSearch(event.target.value)} placeholder={t("nav.globalSearch")} aria-label={t("nav.globalSearch")} /><kbd>Ctrl/⌘ K</kbd></label>
              {globalSearch.trim().length >= 2 && <div className="global-results" id="global-search-results" role="listbox" aria-label={t("nav.globalSearch")}>
                {searchLoading ? <p role="status">{t("nav.searchLoading")}</p> : searchError ? <p role="alert">{searchError}</p> : searchResults.length ? searchResults.map((item, index) => <Link id={`global-result-${index}`} role="option" aria-selected={activeResult === index} className={activeResult === index ? "active" : ""} key={`${item.href}:${item.title}`} href={item.href} onMouseEnter={() => setActiveResult(index)} onClick={() => setGlobalSearch("")}><Search size={15} /><span><b>{item.title}</b><small>{item.detail}</small></span><ChevronRight size={15} /></Link>) : <p>{t("nav.noResults")}</p>}
              </div>}
            </div>
          </div>
          <div className="topbar-actions">
            <LocaleSwitcher compact />
            <Link className="top-icon" href="/help" aria-label={t("nav.help")}><HelpCircle size={19} /></Link>
            <div className="popover-anchor" ref={notificationsRef}>
              <button className="top-icon" type="button" aria-haspopup="dialog" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((value) => !value); setProfileOpen(false); }} aria-label={t("nav.notifications")}><Bell size={19} /></button>
              {notificationsOpen && <NotificationPopover close={() => setNotificationsOpen(false)} />}
            </div>
            <div className="topbar-divider" />
            <div className="popover-anchor" ref={profileRef}>
              <button className="profile-trigger" type="button" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => { setProfileOpen((value) => !value); setNotificationsOpen(false); }}><span>{user.initials}</span><span className="profile-copy"><b>{user.displayNameZh} / {user.displayName}</b><small>{t(roleMessageKey[user.role])}</small></span><ChevronDown size={15} /></button>
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
  return <div className="top-popover notifications" role="dialog" aria-label={t("nav.notifications")}><div className="popover-heading"><span><b>{t("nav.notifications")}</b><small>{t("nav.unreadCount", { count: total })}</small></span><button type="button" disabled={!items.length} onClick={markAll}>{t("nav.markAllRead")}</button></div>
    {error&&<p className="popover-error" role="alert">{error}</p>}{items.map((item)=><Link href={href(item)} onClick={close} key={item.id}><span className="notification-icon purple"><Bell size={17}/></span><span><b>{t(item.titleKey,item.values)}</b><small>{t(item.bodyKey,item.values)}</small><time>{notificationTime(item.createdAt)}</time></span></Link>)}
    {!items.length&&!error&&<p className="popover-empty">{t("nav.notification.empty")}</p>}
    <Link className="popover-footer" href="/messages" onClick={close}>{t("nav.notification.viewAll")} <ChevronRight size={15} /></Link>
  </div>;
}

function ProfilePopover({ user, close }: { user: AppUser; close: () => void }) {
  const { t } = useI18n();
  const roleLabel = t(roleMessageKey[user.role]);
  return <div className="top-popover profile-popover" role="menu"><div className="profile-card"><span>{user.initials}</span><div><b>{user.displayNameZh} / {user.displayName}</b><small>@{user.username} · {user.email}</small><em>{roleLabel} · {t(user.emailVerified ? "nav.emailVerified" : "nav.emailUnverified")}</em></div></div>
    <Link href="/settings/profile" onClick={close}><Settings size={17} />{t("nav.profileSettings")}</Link>
    <Link href={ADMIN_ROLES.includes(user.role) ? "/admin/security" : "/settings/security"} onClick={close}><ShieldCheck size={17} />{t("nav.security")} <span className={user.mfaEnabled ? "mini-good" : "mini-warning"}>{t(user.mfaEnabled ? "nav.mfaEnabled" : "nav.mfaNotEnabled")}</span></Link>
    <Link href="/help" onClick={close}><HelpCircle size={17} />{t("nav.support")}</Link>
    <form action="/api/auth/logout" method="post"><button type="submit"><LogOut size={17} />{t("nav.signOut")}</button></form>
  </div>;
}
