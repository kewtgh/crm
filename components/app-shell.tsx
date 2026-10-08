"use client";

import {WorkspaceIconContext} from "./workspace-heading";
import {destinationIcon} from "@/lib/workspace-visuals";
import {uiIcons} from "./ui-icon";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Sparkles,
  Building2,
  ChevronDown,
  ChevronRight,
  DatabaseZap,
  FileBarChart,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Search,
  Settings,
  ShieldCheck,
  Target,
  Users,
  X,
} from "lucide-react";
import type { AppUser } from "@/lib/user";
import { roleMessageKey } from "@/lib/roles";
import { activeDestination, visibleDestinations, type NavigationSpace } from "@/lib/navigation-destinations";
import { APP_VERSION } from "@/lib/version";
import { AppUserProvider } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { LocaleSwitcher } from "./locale-switcher";
import { useNotifications } from "@/hooks/use-notifications";
import { notificationHref } from "@/lib/notification-link";
import type { RelationshipHealth } from "@/lib/workspace-metrics";
import type { UserSettings } from "@/lib/settings-repository";
import { UserPreferencesProvider } from "./user-preferences-context";
import { useUserPreferences } from "./user-preferences-context";
import { apiFetch } from "@/lib/api-client";
import { AccessibleDrawer } from "./ui";
import { UserAvatar } from "./user-avatar";

type NavItem = { labelKey: string; href?: string; icon: React.ElementType; badge?: string; documentChildNavigation?: boolean; children?: { labelKey: string; href: string; badge?: string }[] };
type NavigationGroup = { titleKey: string; items: NavItem[] };
type GlobalSearchResult = { title: string; detail: string; href: string; source: "page" | "record" };
const SIDEBAR_SCROLL_STORAGE_KEY = "lumina.sidebar.scroll-top";

const spaceIcons = { work: LayoutDashboard, relationships: Building2, students: Users, commercial: Target, management: FileBarChart, governance: DatabaseZap, admin: ShieldCheck, account: Settings };
function navigationFor(role: AppUser["role"]): NavigationGroup[] {
  const visible = visibleDestinations(role);
  return (Object.keys(spaceIcons) as NavigationSpace[]).map(space => ({
    titleKey: space === "account" ? "nav.account" : "ux.space." + space,
    items: visible.filter(d => d.space === space && (!d.parentId || !visible.some(parent => parent.id === d.parentId))).map(d => {
      const children = visible.filter(child => child.parentId === d.id);
      return { labelKey: d.labelKey, href: d.href, icon: uiIcons[destinationIcon(d.id)], documentChildNavigation: d.documentNavigation,
        ...(children.length ? { children: [{ labelKey: "nav.messages", href: d.href }, ...children.map(child => ({ labelKey: child.labelKey, href: child.href }))] } : {}) };
    }),
  })).filter(group => group.items.length);
}

export function AppShell({ user, relationshipHealth, relationshipHealthUnavailable = false, preferences, preferredLocale, avatarSource = null, children }: { user: AppUser; relationshipHealth: RelationshipHealth; relationshipHealthUnavailable?: boolean; preferences:Pick<UserSettings,"timezone"|"dateFormat">; preferredLocale:UserSettings["locale"]; avatarSource?:string|null; children: React.ReactNode }) {
  const [avatarOverride,setAvatarOverride]=useState<string|null>(null);
  useEffect(()=>{const update=(event:Event)=>{const url=(event as CustomEvent<{url:string}>).detail?.url;if(url?.startsWith("/api/settings/avatar"))setAvatarOverride(url);};window.addEventListener("lumina:avatar-updated",update);return()=>window.removeEventListener("lumina:avatar-updated",update);},[]);
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen,setMobileSearchOpen]=useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [recordSearchResults, setRecordSearchResults] = useState<GlobalSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeResult, setActiveResult] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarNavRef = useRef<HTMLElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef=useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsTriggerRef=useRef<HTMLButtonElement>(null);
  const profileTriggerRef=useRef<HTMLButtonElement>(null);
  const localeSynchronized=useRef(false);
  useEffect(()=>{
    if(localeSynchronized.current)return;
    localeSynchronized.current=true;
    if(locale!==preferredLocale)void setLocale(preferredLocale);
  },[locale,preferredLocale,setLocale]);
  useEffect(() => {
    const sidebarNavigation = sidebarNavRef.current;
    if (!sidebarNavigation) return;
    const restoreScrollPosition = () => {
      try {
        const storedPosition = Number(window.sessionStorage.getItem(SIDEBAR_SCROLL_STORAGE_KEY));
        if (Number.isFinite(storedPosition) && storedPosition > 0) sidebarNavigation.scrollTop = storedPosition;
      } catch {
        // Storage can be unavailable in hardened browser contexts; navigation still works.
      }
    };
    const persistScrollPosition = () => {
      try {
        window.sessionStorage.setItem(SIDEBAR_SCROLL_STORAGE_KEY, String(sidebarNavigation.scrollTop));
      } catch {
        // Do not make navigation depend on browser storage availability.
      }
    };
    const frame = window.requestAnimationFrame(restoreScrollPosition);
    sidebarNavigation.addEventListener("scroll", persistScrollPosition, { passive: true });
    window.addEventListener("pagehide", persistScrollPosition);
    return () => {
      window.cancelAnimationFrame(frame);
      sidebarNavigation.removeEventListener("scroll", persistScrollPosition);
      window.removeEventListener("pagehide", persistScrollPosition);
    };
  }, []);
  const visibleNavigation = useMemo(() => navigationFor(user.role), [user.role]);
  const currentDestination = activeDestination(pathname, searchParams, visibleDestinations(user.role));
  const activeNavigationHref = currentDestination?.href;
  const activeSpaceKey = currentDestination?.space === "account" ? "nav.account" : "ux.space." + currentDestination?.space;
  const [expandedSpaces, setExpandedSpaces] = useState<string[]>(["ux.space.work"]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nav = sidebarNavRef.current;
      const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!nav || !link) return;
      const bounds = nav.getBoundingClientRect(), current = link.getBoundingClientRect();
      if (current.top < bounds.top) nav.scrollTop += current.top - bounds.top;
      else if (current.bottom > bounds.bottom) nav.scrollTop += current.bottom - bounds.bottom;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeNavigationHref, mobileOpen, collapsed]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const pageCommands=useMemo<GlobalSearchResult[]>(()=>visibleNavigation.flatMap(group=>group.items.flatMap(item=>{
    const own=item.href?[{title:t(item.labelKey),detail:t("search.type.page"),href:item.href,source:"page" as const}]:[];
    const children=(item.children??[]).map(child=>({title:t(child.labelKey),detail:t("search.type.page"),href:child.href,source:"page" as const}));
    return[...own,...children];
  })),[t,visibleNavigation]);
  const matchingPageCommands=useMemo(()=>{
    const query=globalSearch.trim().toLocaleLowerCase(locale);
    if(query.length<2)return[];
    return pageCommands.filter(item=>`${item.title} ${item.href}`.toLocaleLowerCase(locale).includes(query)).slice(0,6);
  },[globalSearch,locale,pageCommands]);
  const searchResults=useMemo(()=>{
    const hrefs=new Set(matchingPageCommands.map(item=>item.href));
    return[...matchingPageCommands,...recordSearchResults.filter(item=>!hrefs.has(item.href))].slice(0,12);
  },[matchingPageCommands,recordSearchResults]);
  useEffect(() => {
    const query = globalSearch.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError("");
      try {
        const result = await apiFetch<{ items: Array<{ value:string;labelZh: string; labelEn: string; type: "ORGANIZATION" | "CONTACT" | "USER" | "OPPORTUNITY" | "TASK" | "CONTRACT" | "QUOTE" | "PRODUCT" | "STUDENT" | "HOUSEHOLD" | "LEAD" }> }>(`/api/search/related?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if(controller.signal.aborted)return;
        setRecordSearchResults(result.items
          .filter((item): item is typeof item & { type: Exclude<typeof item.type, "USER"> } => item.type !== "USER")
          .map((item) => ({
          title: locale === "zh-CN" ? item.labelZh : item.labelEn,
          detail: t(`search.type.${item.type.toLowerCase()}`),
          href: searchHref(item.type,item.value.split(":")[1]??""),
          source: "record",
          })));
        setActiveResult(-1);
      } catch {
        if (!controller.signal.aborted) {
          setRecordSearchResults([]);
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
    setRecordSearchResults([]);
    setSearchError("");
    setActiveResult(-1);
    if (value.trim().length < 2) {
      setSearchLoading(false);
      setActiveResult(-1);
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if(window.matchMedia("(max-width: 680px)").matches)setMobileSearchOpen(true);
        else searchInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
        setProfileOpen(false);
        setNotificationsOpen(false);
        setMobileSearchOpen(false);
        setGlobalSearch("");
        setRecordSearchResults([]);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!profileRef.current?.contains(target)) setProfileOpen(false);
      if (!notificationsRef.current?.contains(target)) setNotificationsOpen(false);
      if (!searchWrapRef.current?.contains(target)&&!mobileSearchRef.current?.contains(target)) {
        setGlobalSearch("");
        setRecordSearchResults([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);
  useEffect(()=>{
    if(!mobileOpen)return;
    const previousOverflow=document.body.style.overflow;
    const trigger=mobileMenuRef.current;
    document.body.style.overflow="hidden";
    window.requestAnimationFrame(()=>sidebarRef.current?.querySelector<HTMLElement>("button:not([disabled]),a[href]")?.focus());
    const trap=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();setMobileOpen(false);return;}
      if(event.key!=="Tab"||!sidebarRef.current)return;
      const focusable=Array.from(sidebarRef.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),[tabindex]:not([tabindex='-1'])")).filter(element=>element.getClientRects().length>0);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",trap);
    return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener("keydown",trap);trigger?.focus();};
  },[mobileOpen]);
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
      setRecordSearchResults([]);
      setMobileSearchOpen(false);
      searchInputRef.current?.blur();
    }
  };
  const closeMobile = () => setMobileOpen(false);
  const closeNotifications=useCallback(()=>setNotificationsOpen(false),[]);
  const closeProfile=useCallback(()=>setProfileOpen(false),[]);

  return (
    <AppUserProvider user={user}>
    <UserPreferencesProvider initialPreferences={preferences}>
    <a className="skip-link" href="#main-content">{t("nav.skipContent")}</a>
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-overlay" onClick={closeMobile} aria-label={t("nav.close")} />}
      <aside ref={sidebarRef} id="main-navigation" className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label={t("nav.main")} role={mobileOpen?"dialog":undefined} aria-modal={mobileOpen||undefined}>
        <div className="sidebar-header">
          <Link href="/dashboard" className="brand-lockup inverse" onClick={closeMobile} aria-label={t("brand.name")}>
            <span className="brand-logo-surface">
              <Image className="brand-logo" src="/brand/weiai-logo-800x240.png" width={800} height={240} alt={t("brand.name")} priority />
            </span>
          </Link>
          <button className="mobile-close" type="button" onClick={closeMobile} aria-label={t("nav.close")}><X size={20} /></button>
        </div>
        <nav ref={sidebarNavRef} className="sidebar-nav">
          {visibleNavigation.map((group) => <div className="nav-group" key={group.titleKey}>
            <button type="button" className="nav-space-heading" tabIndex={collapsed ? -1 : 0} aria-expanded={collapsed || expandedSpaces.includes(group.titleKey) || activeSpaceKey === group.titleKey} aria-controls={`space-${group.titleKey}`} onClick={() => setExpandedSpaces(current => current.includes(group.titleKey) ? current.filter(key => key !== group.titleKey) : [...current, group.titleKey])}>{t(group.titleKey)}<ChevronDown size={14}/></button>
            <div id={`space-${group.titleKey}`} hidden={!collapsed && !expandedSpaces.includes(group.titleKey) && activeSpaceKey !== group.titleKey}>{group.items.map((item) => <NavEntry key={item.labelKey} item={item} activeHref={activeNavigationHref} expanded={expanded.includes(item.labelKey) || Boolean(item.children?.some((child) => child.href === activeNavigationHref))} onExpand={() => { if (collapsed) setCollapsed(false); setExpanded((current) => current.includes(item.labelKey) ? current.filter((value) => value !== item.labelKey) : [...current, item.labelKey]); }} onNavigate={closeMobile} />)}</div>
          </div>)}
        </nav>
        <div className="sidebar-insight">
          <span><Sparkles size={16} /></span>
          <div><b>{relationshipHealthUnavailable ? t("nav.relationshipHealthUnavailable") : relationshipHealth.hasData && relationshipHealth.score !== null ? t("nav.relationshipHealthValue", { score: relationshipHealth.score }) : t("nav.relationshipHealthEmpty")}</b><small>{relationshipHealthUnavailable ? t("nav.relationshipHealthUnavailableHelp") : relationshipHealth.hasData && relationshipHealth.weeklyDelta !== null ? t("nav.relationshipChangeValue", { delta: relationshipHealth.weeklyDelta }) : t("nav.relationshipSample", { count: relationshipHealth.sampleSize })}</small></div>
          <ChevronRight size={16} />
        </div>
        <button className="sidebar-collapse" type="button" aria-label={t(collapsed ? "nav.expand" : "nav.collapse")} title={t(collapsed ? "nav.expand" : "nav.collapse")} aria-pressed={collapsed} onClick={() => setCollapsed((value) => !value)}><PanelLeftClose size={17} /><span>{t(collapsed ? "nav.expand" : "nav.collapse")}</span><small>v{APP_VERSION}</small></button>
      </aside>

      <div className="app-column">
        <header className="topbar">
          <div className="topbar-left">
            <button ref={mobileMenuRef} className="mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label={t("nav.open")} aria-expanded={mobileOpen} aria-controls="main-navigation"><Menu size={21} /></button>
            <button className="mobile-search-trigger" type="button" onClick={()=>setMobileSearchOpen(true)} aria-label={t("nav.globalSearch")}><Search size={20}/><span>{t("nav.globalSearch")}</span></button>
            <div className="global-search-wrap" ref={searchWrapRef}>
              <label className="global-search"><Search size={18} /><input ref={searchInputRef} role="combobox" aria-autocomplete="list" aria-expanded={globalSearch.trim().length >= 2} aria-controls="global-search-results" aria-activedescendant={activeResult >= 0 ? `global-result-${activeResult}` : undefined} value={globalSearch} onKeyDown={searchKeyDown} onChange={(event) => changeSearch(event.target.value)} placeholder={t("nav.globalSearch")} aria-label={t("nav.globalSearch")} /><kbd>Ctrl/⌘ K</kbd></label>
              {globalSearch.trim().length >= 2 && <GlobalSearchResults className="global-results" id="global-search-results" itemIdPrefix="global-result" results={searchResults} activeResult={activeResult} loading={searchLoading} error={searchError} onActive={setActiveResult} onChoose={()=>changeSearch("")}/>}
            </div>
          </div>
          <div className="topbar-actions">
            <LocaleSwitcher compact persist />
            <Link className="top-icon" href="/help" aria-label={t("nav.help")}><HelpCircle size={19} /></Link>
            <div className="popover-anchor" ref={notificationsRef}>
              <button ref={notificationsTriggerRef} className="top-icon" type="button" aria-haspopup="dialog" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((value) => !value); setProfileOpen(false); }} aria-label={t("nav.notifications")}><Bell size={19} /></button>
              {notificationsOpen && <NotificationPopover triggerRef={notificationsTriggerRef} close={closeNotifications} />}
            </div>
            <div className="topbar-divider" />
            <div className="popover-anchor" ref={profileRef}>
              <button ref={profileTriggerRef} className="profile-trigger" type="button" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => { setProfileOpen((value) => !value); setNotificationsOpen(false); }}><UserAvatar initials={user.initials} source={avatarOverride ?? avatarSource}/><span className="profile-copy"><b>{user.displayNameZh} / {user.displayName}</b><small>{t(roleMessageKey[user.role])}</small></span><ChevronDown size={15} /></button>
              {profileOpen && <ProfilePopover user={user} avatarSource={avatarOverride ?? avatarSource} triggerRef={profileTriggerRef} close={closeProfile} />}
            </div>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="app-content" data-workspace-space={currentDestination?.space??"work"} data-workspace-destination={currentDestination?.id??"other"}><WorkspaceIconContext.Provider value={destinationIcon(currentDestination?.id)}>{children}</WorkspaceIconContext.Provider></main>
      </div>
    </div>
    {mobileSearchOpen&&<AccessibleDrawer title={t("nav.globalSearch")} onClose={()=>{setMobileSearchOpen(false);changeSearch("");}}><div ref={mobileSearchRef} className="mobile-global-search"><label className="global-search"><Search size={18}/><input autoFocus role="combobox" aria-autocomplete="list" aria-expanded={globalSearch.trim().length>=2} aria-controls="mobile-global-search-results" aria-activedescendant={activeResult>=0?`mobile-global-result-${activeResult}`:undefined} value={globalSearch} onKeyDown={searchKeyDown} onChange={event=>changeSearch(event.target.value)} placeholder={t("nav.globalSearch")} aria-label={t("nav.globalSearch")}/></label>{globalSearch.trim().length>=2&&<GlobalSearchResults className="mobile-global-results" id="mobile-global-search-results" itemIdPrefix="mobile-global-result" results={searchResults} activeResult={activeResult} loading={searchLoading} error={searchError} onActive={setActiveResult} onChoose={()=>{setMobileSearchOpen(false);changeSearch("");}}/>}</div></AccessibleDrawer>}
    </UserPreferencesProvider>
    </AppUserProvider>
  );
}

function GlobalSearchResults({
  className,
  id,
  itemIdPrefix,
  results,
  activeResult,
  loading,
  error,
  onActive,
  onChoose,
}: {
  className:string;
  id:string;
  itemIdPrefix:string;
  results:GlobalSearchResult[];
  activeResult:number;
  loading:boolean;
  error:string;
  onActive:(index:number)=>void;
  onChoose:()=>void;
}) {
  const {t}=useI18n();
  return <div className={className} id={id} role="listbox" aria-label={t("nav.globalSearch")}>
    {results.map((item,index)=><Link id={`${itemIdPrefix}-${index}`} data-source={item.source} role="option" aria-selected={activeResult===index} className={activeResult===index?"active":""} key={`${item.source}:${item.href}:${item.title}`} href={item.href} onMouseEnter={()=>onActive(index)} onClick={onChoose}>{item.source==="page"?<LayoutDashboard size={16}/>:<Search size={16}/>}<span><b>{item.title}</b><small>{item.detail}</small></span><ChevronRight size={16}/></Link>)}
    {loading&&<p role="status">{t("nav.searchLoading")}</p>}
    {error&&<p role="alert">{error}</p>}
    {!loading&&!error&&!results.length&&<p>{t("nav.noResults")}</p>}
  </div>;
}

function NavEntry({ item, activeHref, expanded, onExpand, onNavigate }: { item: NavItem; activeHref?: string; expanded: boolean; onExpand: () => void; onNavigate: () => void }) {
  const { t } = useI18n();
  const Icon = item.icon;
  const active = activeHref === item.href || item.children?.some((child) => child.href === activeHref);
  if (item.children) return <div className={`nav-parent ${active ? "active" : ""}`}>
    <button type="button" className="nav-link" aria-label={t(item.labelKey)} title={t(item.labelKey)} aria-expanded={expanded} onClick={onExpand}><Icon size={18} /><span>{t(item.labelKey)}</span>{item.badge && <b className="nav-badge">{item.badge}</b>}<ChevronDown className={`nav-chevron ${expanded ? "rotate" : ""}`} size={15} /></button>
    {expanded && <div className="nav-children">{item.children.map((child) => {const childActive=activeHref===child.href;const properties={className:childActive?"active":"",...(childActive?{"aria-current":"page" as const}:{}),href:child.href,onClick:onNavigate};const content=<><span>{t(child.labelKey)}</span>{child.badge&&<b className="nav-badge">{child.badge}</b>}</>;return item.documentChildNavigation?<a {...properties} data-navigation="document" key={child.href}>{content}</a>:<Link {...properties} key={child.href}>{content}</Link>;})}</div>}
  </div>;
  const properties = { className: `nav-link ${active ? "active" : ""}`, "aria-label": t(item.labelKey), title: t(item.labelKey), "aria-current": active ? "page" as const : undefined, href: item.href ?? "#", onClick: onNavigate };
  const content = <><Icon size={18}/><span>{t(item.labelKey)}</span>{item.badge && <b className="nav-badge">{item.badge}</b>}</>;
  return item.documentChildNavigation ? <a {...properties} data-navigation="document">{content}</a> : <Link {...properties}>{content}</Link>;
}

function NotificationPopover({ close,triggerRef }: { close: () => void;triggerRef:React.RefObject<HTMLButtonElement|null> }) {
  const {t} = useI18n();const {formatDate}=useUserPreferences();const {items,total,error,loading,pending,load,markRead}=useNotifications();const dialogRef=useRef<HTMLDivElement>(null);const restoreFocus=useRef(true);
  useEffect(()=>{const trigger=triggerRef.current;const frame=window.requestAnimationFrame(()=>dialogRef.current?.querySelector<HTMLElement>("button:not([disabled]),a[href]")?.focus());const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();close();return;}if(event.key!=="Tab"||!dialogRef.current)return;const focusable=Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])"));const first=focusable[0],last=focusable[focusable.length-1];if((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)){event.preventDefault();restoreFocus.current=false;const next=findAdjacentFocusable(trigger,dialogRef.current,event.shiftKey);close();window.requestAnimationFrame(()=>next?.focus());}};const current=dialogRef.current;current?.addEventListener("keydown",key);return()=>{window.cancelAnimationFrame(frame);current?.removeEventListener("keydown",key);if(restoreFocus.current)trigger?.focus();};},[close,triggerRef]);
  const notificationTime=(date:string)=>formatDate(date,{includeTime:true});
  return <div ref={dialogRef} className="top-popover notifications" role="dialog" aria-modal="false" aria-busy={loading||pending} aria-label={t("nav.notifications")}><div className="popover-heading"><span><b>{t("nav.notifications")}</b><small>{t("nav.unreadCount", { count: total })}</small></span><button type="button" disabled={!total||loading||pending} onClick={()=>void markRead({all:true})}>{t("nav.markAllRead")}</button></div>
    {error&&<div className="popover-error" role="alert"><p>{error}</p><button className="secondary-button" disabled={loading||pending} type="button" onClick={()=>void load(1)}>{t("common.retry")}</button></div>}{items.map((item)=><Link href={notificationHref(item)} onClick={close} key={item.id}><span className="notification-icon purple"><Bell size={17}/></span><span><b>{t(item.titleKey,item.values)}</b><small>{t(item.bodyKey,item.values)}</small><time>{notificationTime(item.createdAt)}</time></span></Link>)}
    {loading&&<p className="popover-empty" role="status">{t("notifications.loading")}</p>}
    {!items.length&&!error&&!loading&&<p className="popover-empty">{t("nav.notification.empty")}</p>}
    <Link className="popover-footer" href="/notifications" onClick={close}>{t("nav.notification.viewAll")} <ChevronRight size={15} /></Link>
  </div>;
}

function ProfilePopover({ user, close,triggerRef,avatarSource }: { user: AppUser; close: () => void;triggerRef:React.RefObject<HTMLButtonElement|null>;avatarSource:string|null }) {
  const { t } = useI18n();
  const router = useRouter();
  const roleLabel = t(roleMessageKey[user.role]);
  const menuRef=useRef<HTMLDivElement>(null);
  const restoreFocus=useRef(true);
  const [signingOut,setSigningOut]=useState(false);
  const [signOutError,setSignOutError]=useState("");
  useEffect(()=>{const trigger=triggerRef.current;const frame=window.requestAnimationFrame(()=>menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus());return()=>{window.cancelAnimationFrame(frame);if(restoreFocus.current)trigger?.focus();};},[triggerRef]);
  const onKeyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{const items=Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']")??[]);if(event.key==="Escape"){event.preventDefault();close();return;}if(event.key==="Tab"){event.preventDefault();restoreFocus.current=false;const next=findAdjacentFocusable(triggerRef.current,menuRef.current,event.shiftKey);close();window.requestAnimationFrame(()=>next?.focus());return;}if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key)||!items.length)return;event.preventDefault();const index=items.indexOf(document.activeElement as HTMLElement);const next=event.key==="Home"?0:event.key==="End"?items.length-1:event.key==="ArrowDown"?(index+1+items.length)%items.length:(index-1+items.length)%items.length;items[next]?.focus();};
  const signOut=async()=>{if(signingOut)return;setSigningOut(true);setSignOutError("");try{await apiFetch<void>("/api/auth/logout",{method:"POST"});restoreFocus.current=false;router.replace("/login");router.refresh();}catch{setSignOutError(t("nav.signOutFailed"));setSigningOut(false);}};
  return <div ref={menuRef} onKeyDown={onKeyDown} className="top-popover profile-popover" role="menu"><div className="profile-card" role="none"><UserAvatar initials={user.initials} source={avatarSource}/><div><b>{user.displayNameZh} / {user.displayName}</b><small>@{user.username} · {user.email}</small><em>{roleLabel} · {t(user.emailVerified ? "nav.emailVerified" : "nav.emailUnverified")}</em></div></div>
    <Link role="menuitem" href="/settings/profile" onClick={close}><Settings size={17} />{t("nav.profileSettings")}</Link>
    <Link role="menuitem" href="/settings/security" onClick={close}><ShieldCheck size={17} />{t("nav.twoFactorSecurity")} <span className={user.mfaEnabled ? "mini-good" : "mini-warning"}>{t(user.mfaEnabled ? "nav.mfaEnabled" : "nav.mfaNotEnabled")}</span></Link>
    <Link role="menuitem" href="/help" onClick={close}><HelpCircle size={17} />{t("nav.support")}</Link>
    {signOutError&&<p className="profile-signout-error" role="alert">{signOutError}</p>}
    <button className="profile-signout" role="menuitem" type="button" disabled={signingOut} aria-busy={signingOut} onClick={()=>void signOut()}><LogOut size={17} />{t(signingOut?"nav.signingOut":"nav.signOut")}</button>
  </div>;
}

function searchHref(type:"ORGANIZATION"|"CONTACT"|"OPPORTUNITY"|"TASK"|"CONTRACT"|"QUOTE"|"PRODUCT"|"STUDENT"|"HOUSEHOLD"|"LEAD",id:string){
  if(type==="ORGANIZATION")return`/schools/${id}`;
  if(type==="CONTACT")return`/people/${id}`;
  if(type==="TASK")return`/tasks/${id}`;
  if(type==="OPPORTUNITY")return`/opportunities?focus=${id}`;
  if(type==="CONTRACT")return`/contracts?focus=${id}`;
  if(type==="QUOTE")return`/finance?quote=${id}`;
  if(type==="STUDENT")return`/students?focus=${id}`;
  if(type==="HOUSEHOLD")return`/households?tab=families&focus=${id}`;
  if(type==="LEAD")return`/leads?focus=${id}`;
  return`/products?focus=${id}`;
}

function findAdjacentFocusable(trigger:HTMLElement|null,popover:HTMLElement|null,backwards:boolean){
  if(!trigger)return null;
  const elements=Array.from(document.querySelectorAll<HTMLElement>(
    "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])",
  )).filter(element=>!popover?.contains(element)&&element.getClientRects().length>0);
  const index=elements.indexOf(trigger);
  return elements[index+(backwards?-1:1)]??trigger;
}
