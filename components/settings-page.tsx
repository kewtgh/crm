"use client";
/* eslint-disable @next/next/no-img-element -- Blob URLs are local previews, not persisted content images. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import {
  BellRing,
  Camera,
  Check,
  ChevronRight,
  Eye,
  KeyRound,
  Languages,
  Laptop,
  LockKeyhole,
  Mail,
  MonitorSmartphone,
  Save,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import { InlineMessage, SearchableSelect, StatusBadge, Toast } from "@/components/ui";
import { useAppUser } from "@/components/app-shell";
import type { AppUser } from "@/lib/auth";

const tabs = [
  { href: "/settings/profile", label: "个人资料", icon: UserRound },
  { href: "/settings/account", label: "账户与语言", icon: Languages },
  { href: "/settings/notifications", label: "通知偏好", icon: BellRing },
  { href: "/settings/security", label: "密码与安全", icon: ShieldCheck },
  { href: "/settings/privacy", label: "隐私与设备", icon: Eye },
];

export function SettingsPage({ section }: { section: string }) {
  const pathname = usePathname();
  const user = useAppUser();
  const [toast, setToast] = useState("");
  const prototypeSave = () => setToast("当前为验收基线：此设置尚未写入生产数据源");
  return <div className="page-stack settings-page"><section className="page-heading-row"><div><p className="eyebrow">PERSONAL SETTINGS</p><h1>个人与账户设置</h1><p>管理你的公开资料、语言、通知、隐私与登录安全。</p></div><StatusBadge tone="green">账户正常</StatusBadge></section><div className="settings-layout"><aside className="settings-nav">{tabs.map(({ href, label, icon: Icon }) => <Link key={href} className={pathname === href ? "active" : ""} href={href}><Icon size={17} /><span>{label}</span><ChevronRight size={14} /></Link>)}<div className="settings-role-note"><LockKeyhole size={17} /><div><b>受保护字段</b><p>角色、认证等级与账号状态只能由管理员修改。</p></div></div></aside><section className="settings-content"><InlineMessage type="warning">当前连接真实登录身份，但设置保存、MFA 与设备管理仍是验收界面，不会写入生产数据。</InlineMessage>{section === "profile" && <ProfileSettings user={user} onSave={prototypeSave} />}{section === "account" && <AccountSettings user={user} onSave={prototypeSave} />}{section === "notifications" && <NotificationSettings onSave={prototypeSave} />}{section === "security" && <SecuritySettings onSave={prototypeSave} />}{section === "privacy" && <PrivacySettings onSave={prototypeSave} />}</section></div>{toast && <Toast message={toast} onClose={() => setToast("")} />}</div>;
}

function SettingsHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="settings-section-heading"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>; }

function ProfileSettings({ user, onSave }: { user: AppUser; onSave: (message: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null); const [avatar, setAvatar] = useState<string>(); const [title, setTitle] = useState("ms");
  return <form onSubmit={(event) => { event.preventDefault(); onSave("个人资料已安全保存"); }}><SettingsHeader eyebrow="PROFILE" title="个人资料" description="这些资料会出现在团队协作、任务和活动时间线中。" /><div className="avatar-editor"><span className="large-avatar">{avatar ? <img src={avatar} alt="头像预览" /> : user.initials}</span><div><b>个人头像</b><p>JPG、PNG 或 WebP，最大 3MB。</p><button className="secondary-button" type="button" onClick={() => fileRef.current?.click()}><Camera size={16} />更换头像</button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) setAvatar(URL.createObjectURL(file)); }} /></div></div><div className="form-grid two-column"><label className="field"><span>中文姓名</span><input defaultValue={user.displayNameZh} required /></label><label className="field"><span>English name</span><input defaultValue={user.displayName} required /></label></div><SearchableSelect label="称呼 / Honorific" options={[{ value: "ms", label: "Ms. / 女士" },{ value: "mr", label: "Mr. / 先生" },{ value: "dr", label: "Dr. / 博士" },{ value: "mx", label: "Mx." }]} value={title} onChange={setTitle} /><label className="field"><span>个人简介</span><textarea rows={4} defaultValue="负责 Lumina 教育关系 CRM 的运营、安全与跨地区团队协作。" /></label><ProtectedFields role={user.role} /><SaveRow /></form>;
}

function ProtectedFields({ role }: { role: AppUser["role"] }) { const labels = { ADMIN: "系统管理员", MENTOR: "导师", SUPERVISOR: "督导", SALES: "业务成员" }; return <div className="protected-field-grid"><div><span>角色</span><b>{labels[role]}</b><small>不可自行修改</small></div><div><span>认证等级</span><b>{role === "ADMIN" ? "Level 3 · 高权限" : "按角色策略"}</b><small>不可自行修改</small></div><div><span>账号状态</span><b className="good-text">活跃 · 已验证</b><small>不可自行修改</small></div></div>; }

function AccountSettings({ user, onSave }: { user: AppUser; onSave: (message: string) => void }) {
  const [language, setLanguage] = useState("zh-CN"); const [timezone, setTimezone] = useState("asia-taipei");
  return <form onSubmit={(event) => { event.preventDefault(); onSave("账户与语言设置已更新"); }}><SettingsHeader eyebrow="ACCOUNT & LANGUAGE" title="账户与语言" description="邮箱变更需要重新验证；界面语言不会改变客户资料原文。" /><label className="field"><span>登录邮箱</span><span className="input-with-status"><Mail size={17} /><input type="email" defaultValue={user.email} /><b><Check size={14} />已验证</b></span></label><InlineMessage type="warning">修改邮箱后，我们会同时向新旧邮箱发送确认通知。</InlineMessage><div className="form-grid two-column"><SearchableSelect label="界面语言" options={[{ value: "zh-CN", label: "简体中文" },{ value: "zh-TW", label: "繁體中文" },{ value: "en", label: "English" }]} value={language} onChange={setLanguage} /><SearchableSelect label="时区" options={[{ value: "asia-taipei", label: "Asia/Taipei (UTC+8)" },{ value: "asia-shanghai", label: "Asia/Shanghai (UTC+8)" },{ value: "asia-singapore", label: "Asia/Singapore (UTC+8)" },{ value: "europe-london", label: "Europe/London" },{ value: "america-new-york", label: "America/New_York" }]} value={timezone} onChange={setTimezone} /></div><label className="field"><span>日期格式</span><select defaultValue="yyyy"><option value="yyyy">2026-07-16</option><option value="dd">16/07/2026</option><option value="mm">07/16/2026</option></select></label><SaveRow /></form>;
}

function NotificationSettings({ onSave }: { onSave: (message: string) => void }) {
  const rows = [{ title: "任务与截止时间", detail: "分配、即将到期和逾期提醒", email: true, app: true },{ title: "客户与关系变化", detail: "关键联系人、监护关系和风险变化", email: true, app: true },{ title: "销售与审批", detail: "商机阶段、报价和导出审批", email: false, app: true },{ title: "系统与安全", detail: "新设备、MFA 和权限变更（安全通知不可完全关闭）", email: true, app: true },{ title: "AI 建议", detail: "Next Best Action 与资料缺口建议", email: false, app: true }];
  return <form onSubmit={(event) => { event.preventDefault(); onSave("通知偏好已更新"); }}><SettingsHeader eyebrow="NOTIFICATIONS" title="通知偏好" description="选择需要通过站内或邮件接收的提醒。" /><div className="notification-settings-head"><span>通知类型</span><span>邮件</span><span>站内</span></div>{rows.map((row) => <div className="notification-setting-row" key={row.title}><div><b>{row.title}</b><small>{row.detail}</small></div><label className="switch"><input type="checkbox" defaultChecked={row.email} /><span /></label><label className="switch"><input type="checkbox" defaultChecked={row.app} /><span /></label></div>)}<label className="field"><span>免打扰时间</span><select defaultValue="22"><option value="off">关闭</option><option value="22">22:00–08:00</option><option value="21">21:00–09:00</option></select></label><SaveRow /></form>;
}

function SecuritySettings({ onSave }: { onSave: (message: string) => void }) {
  const [error, setError] = useState(""); const changePassword = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); if (data.get("newPassword") !== data.get("confirmPassword")) { setError("两次新密码不一致 / Passwords do not match"); return; } setError(""); onSave("密码已更新，其他设备已退出"); };
  return <div><SettingsHeader eyebrow="PASSWORD & SECURITY" title="密码与安全" description="管理员、导师和督导必须启用 MFA。" /><section className="mfa-card"><span><ShieldCheck size={25} /></span><div><b>MFA 管理服务待接入</b><p>接入 Supabase MFA 后才能显示真实状态和恢复代码。</p></div><StatusBadge tone="amber">不可用</StatusBadge><button className="secondary-button" type="button" disabled>管理 MFA</button></section><form onSubmit={changePassword} className="settings-subform"><h3>修改密码</h3><label className="field"><span>当前密码</span><input type="password" name="currentPassword" autoComplete="current-password" required /></label><div className="form-grid two-column"><label className="field"><span>新密码</span><input type="password" name="newPassword" autoComplete="new-password" minLength={10} required /></label><label className="field"><span>确认新密码</span><input type="password" name="confirmPassword" autoComplete="new-password" minLength={10} required /></label></div>{error && <InlineMessage type="error">{error}</InlineMessage>}<div className="settings-actions"><span>连接安全服务后才会提交更新。</span><button className="primary-button" type="submit"><KeyRound size={16} />验证表单</button></div></form><section className="recovery-section"><h3>恢复代码</h3><p>连接 MFA 后才会生成和管理恢复代码。</p><button className="secondary-button" type="button" disabled>重新生成恢复代码</button></section></div>;
}

function PrivacySettings({ onSave }: { onSave: (message: string) => void }) {
  const [revoked, setRevoked] = useState(false);
  return <div><SettingsHeader eyebrow="PRIVACY & DEVICES" title="隐私与登录设备" description="查看数据使用入口并管理仍在登录的设备。" /><section className="privacy-links"><a href="/privacy"><span><Eye size={18} /></span><div><b>隐私政策与数据使用</b><p>了解资料保留、权限和未成年人数据保护。</p></div><ChevronRight size={16} /></a><button type="button" onClick={() => onSave("隐私资料导出申请已提交，完成后将发送邮件")}><span><Mail size={18} /></span><div><b>申请导出我的账户资料</b><p>导出需要身份复核，并会留下审计记录。</p></div><ChevronRight size={16} /></button></section><h3 className="device-heading">登录设备</h3><div className="device-list"><Device icon={Laptop} title="Chrome · Windows 11" meta="Taipei · 当前设备 · 现在" current /><Device icon={Laptop} title="Safari · macOS" meta="Taipei · 32 分钟前" /><Device icon={Smartphone} title="Chrome · Android" meta="Singapore · 2 天前" /></div>{revoked ? <InlineMessage type="success">其他设备已全部退出，相关会话令牌已撤销。</InlineMessage> : <button className="danger-button" type="button" onClick={() => setRevoked(true)}><MonitorSmartphone size={17} />退出其他所有设备</button>}</div>;
}

function Device({ icon: Icon, title, meta, current }: { icon: React.ElementType; title: string; meta: string; current?: boolean }) { return <div className="device-row"><span><Icon size={20} /></span><div><b>{title}</b><small>{meta}</small></div>{current ? <StatusBadge tone="green">当前</StatusBadge> : <button type="button">退出</button>}</div>; }
function SaveRow() { return <div className="settings-actions"><span>带 * 的字段为必填项。</span><button className="primary-button" type="submit"><Save size={16} />保存更改</button></div>; }
