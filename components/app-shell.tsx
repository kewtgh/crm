"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState } from "react";
import {
  Bell,
  BookOpenCheck,
  Bot,
  Building2,
  CalendarCheck2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  DatabaseZap,
  FileBarChart,
  GraduationCap,
  HeartHandshake,
  HelpCircle,
  Languages,
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
import type { AppUser } from "@/lib/auth";
import { APP_VERSION } from "@/lib/version";

type NavItem = { label: string; href?: string; icon: React.ElementType; badge?: string; children?: { label: string; href: string; badge?: string }[] };

const navigation: { title: string; items: NavItem[] }[] = [
  { title: "工作台", items: [
    { label: "运营首页", href: "/dashboard", icon: LayoutDashboard },
    { label: "任务与日历", href: "/tasks", icon: CheckSquare, badge: "7" },
    { label: "消息中心", href: "/messages", icon: MessageSquareText, badge: "3" },
  ]},
  { title: "关系 CRM", items: [
    { label: "学校与机构", href: "/schools", icon: Building2 },
    { label: "人员与联系人", href: "/people", icon: Users },
    { label: "学生档案", href: "/students", icon: GraduationCap },
    { label: "家庭与监护", href: "/households", icon: HeartHandshake },
  ]},
  { title: "增长与服务", items: [
    { label: "销售管理", icon: Target, children: [
      { label: "线索 Leads", href: "/leads", badge: "12" },
      { label: "商机 Pipeline", href: "/opportunities" },
      { label: "产品与服务", href: "/products" },
    ]},
    { label: "升年级中心", href: "/progression", icon: BookOpenCheck, badge: "4" },
    { label: "导入与数据质量", icon: DatabaseZap, children: [
      { label: "导入中心", href: "/imports" },
      { label: "重复项", href: "/duplicates", badge: "9" },
      { label: "数据质量", href: "/data-quality" },
    ]},
    { label: "报告与洞察", href: "/reports", icon: FileBarChart },
    { label: "AI 工作台", href: "/ai", icon: Bot },
  ]},
  { title: "系统", items: [
    { label: "管理中心", icon: ShieldCheck, children: [
      { label: "运营门户", href: "/admin" },
      { label: "监护人验证", href: "/admin/guardians", badge: "6" },
      { label: "导师与账户", href: "/admin/mentors" },
      { label: "安全与审计", href: "/admin/security" },
    ]},
    { label: "设置", href: "/settings/profile", icon: Settings },
  ]},
];

const AppUserContext = createContext<AppUser | null>(null);

export function useAppUser() {
  const user = useContext(AppUserContext);
  if (!user) throw new Error("useAppUser must be used inside AppShell");
  return user;
}

export function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const visibleNavigation = useMemo(
    () => user.role === "ADMIN"
      ? navigation
      : navigation.map((group) => ({
          ...group,
          items: group.items.filter((item) => item.label !== "管理中心"),
        })).filter((group) => group.items.length > 0),
    [user.role],
  );
  const [expanded, setExpanded] = useState<string[]>(() => navigation.flatMap((group) => group.items.filter((item) => item.children?.some((child) => pathname.startsWith(child.href))).map((item) => item.label)));
  const searchResults = useMemo(() => {
    if (globalSearch.trim().length < 2) return [];
    const terms = [
      { title: "台北欧洲学校", detail: "学校 · Taipei European School", href: "/schools" },
      { title: "林俊佑 / Jay Lin", detail: "学生 · IB Year 1", href: "/students" },
      { title: "吴氏家庭", detail: "家庭 · 深圳", href: "/households" },
      { title: "UCAS 推荐信终稿", detail: "任务 · 今天到期", href: "/tasks" },
    ];
    return terms.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(globalSearch.toLowerCase()));
  }, [globalSearch]);
  const closeMobile = () => setMobileOpen(false);

  return (
    <AppUserContext.Provider value={user}>
    <div className={`app-frame ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-overlay" onClick={closeMobile} aria-label="关闭导航" />}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label="主导航">
        <div className="sidebar-header">
          <Link href="/dashboard" className="brand-lockup inverse" onClick={closeMobile}>
            <span className="brand-mark"><GraduationCap size={22} /></span>
            <span className="brand-words"><b>Lumina</b><small>Education CRM</small></span>
          </Link>
          <button className="mobile-close" type="button" onClick={closeMobile} aria-label="关闭导航"><X size={20} /></button>
        </div>
        <nav className="sidebar-nav">
          {visibleNavigation.map((group) => <div className="nav-group" key={group.title}>
            <p>{group.title}</p>
            {group.items.map((item) => <NavEntry key={item.label} item={item} pathname={pathname} expanded={expanded.includes(item.label)} onExpand={() => setExpanded((current) => current.includes(item.label) ? current.filter((value) => value !== item.label) : [...current, item.label])} onNavigate={closeMobile} />)}
          </div>)}
        </nav>
        <div className="sidebar-insight">
          <span><Sparkles size={16} /></span>
          <div><b>关系健康度 87%</b><small>本周提升 3.2%</small></div>
          <ChevronRight size={16} />
        </div>
        <button className="sidebar-collapse" type="button" onClick={() => setCollapsed((value) => !value)}><PanelLeftClose size={17} /><span>收起导航</span><small>v{APP_VERSION}</small></button>
      </aside>

      <div className="app-column">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={21} /></button>
            <div className="global-search-wrap">
              <label className="global-search"><Search size={18} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="搜索学校、人员、学生或任务…" /><kbd>⌘ K</kbd></label>
              {globalSearch && <div className="global-results">
                {searchResults.length ? searchResults.map((item) => <Link key={item.title} href={item.href} onClick={() => setGlobalSearch("")}><Search size={15} /><span><b>{item.title}</b><small>{item.detail}</small></span><ChevronRight size={15} /></Link>) : <p>未找到匹配结果</p>}
              </div>}
            </div>
          </div>
          <div className="topbar-actions">
            <button className="text-icon-button" type="button"><Languages size={17} /><span>中文</span><ChevronDown size={14} /></button>
            <Link className="top-icon" href="/help" aria-label="帮助"><HelpCircle size={19} /></Link>
            <div className="popover-anchor">
              <button className="top-icon" type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-label="通知"><Bell size={19} /><i /></button>
              {notificationsOpen && <NotificationPopover user={user} close={() => setNotificationsOpen(false)} />}
            </div>
            <div className="topbar-divider" />
            <div className="popover-anchor">
              <button className="profile-trigger" type="button" onClick={() => setProfileOpen((value) => !value)}><span>{user.initials}</span><span className="profile-copy"><b>{user.displayNameZh}</b><small>{user.role === "ADMIN" ? "系统管理员" : user.role}</small></span><ChevronDown size={15} /></button>
              {profileOpen && <ProfilePopover user={user} close={() => setProfileOpen(false)} />}
            </div>
          </div>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
    </AppUserContext.Provider>
  );
}

function NavEntry({ item, pathname, expanded, onExpand, onNavigate }: { item: NavItem; pathname: string; expanded: boolean; onExpand: () => void; onNavigate: () => void }) {
  const Icon = item.icon;
  const active = item.href ? pathname === item.href || pathname.startsWith(`${item.href}/`) : item.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`));
  if (item.children) return <div className={`nav-parent ${active ? "active" : ""}`}>
    <button type="button" className="nav-link" onClick={onExpand}><Icon size={18} /><span>{item.label}</span>{item.badge && <b className="nav-badge">{item.badge}</b>}<ChevronDown className={`nav-chevron ${expanded ? "rotate" : ""}`} size={15} /></button>
    {expanded && <div className="nav-children">{item.children.map((child) => <Link className={pathname === child.href ? "active" : ""} href={child.href} key={child.href} onClick={onNavigate}><span>{child.label}</span>{child.badge && <b className="nav-badge">{child.badge}</b>}</Link>)}</div>}
  </div>;
  return <Link className={`nav-link ${active ? "active" : ""}`} href={item.href ?? "#"} onClick={onNavigate}><Icon size={18} /><span>{item.label}</span>{item.badge && <b className="nav-badge">{item.badge}</b>}</Link>;
}

function NotificationPopover({ user, close }: { user: AppUser; close: () => void }) {
  return <div className="top-popover notifications"><div className="popover-heading"><span><b>通知</b><small>3 条未读</small></span><button type="button">全部已读</button></div>
    <Link href="/tasks" onClick={close}><span className="notification-icon red"><CalendarCheck2 size={17} /></span><span><b>2 项任务今天到期</b><small>UCAS 推荐信、学校续约回访</small><time>5 分钟前</time></span></Link>
    {user.role === "ADMIN" && <Link href="/admin/guardians" onClick={close}><span className="notification-icon purple"><ClipboardCheck size={17} /></span><span><b>新的监护人验证申请</b><small>赵嘉敏申请关联学生赵子墨</small><time>28 分钟前</time></span></Link>}
    <Link href="/data-quality" onClick={close}><span className="notification-icon amber"><CircleGauge size={17} /></span><span><b>数据质量规则产生 9 项提醒</b><small>3 项高优先级需要处理</small><time>1 小时前</time></span></Link>
    <Link className="popover-footer" href="/messages" onClick={close}>查看全部通知 <ChevronRight size={15} /></Link>
  </div>;
}

function ProfilePopover({ user, close }: { user: AppUser; close: () => void }) {
  const roleLabel = user.role === "ADMIN" ? "管理员" : user.role === "MENTOR" ? "导师" : user.role === "SUPERVISOR" ? "督导" : "业务成员";
  return <div className="top-popover profile-popover"><div className="profile-card"><span>{user.initials}</span><div><b>{user.displayNameZh} · {user.displayName}</b><small>{user.email}</small><em>{roleLabel} · 已验证</em></div></div>
    <Link href="/settings/profile" onClick={close}><Settings size={17} />个人与账户设置</Link>
    <Link href={user.role === "ADMIN" ? "/admin/security" : "/settings/security"} onClick={close}><ShieldCheck size={17} />安全中心 <span className="mini-good">MFA 已启用</span></Link>
    <Link href="/help" onClick={close}><HelpCircle size={17} />帮助与支持</Link>
    <form action="/api/auth/logout" method="post"><button type="submit"><LogOut size={17} />安全退出</button></form>
  </div>;
}
