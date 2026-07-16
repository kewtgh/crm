"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserRoundCog,
  Users,
} from "lucide-react";
import { guardians, mentors } from "@/lib/crm-data";
import { Pagination, SearchField, StatusBadge, Toast } from "@/components/ui";

export function AdminPortalPage() {
  return <div className="page-stack admin-portal"><section className="page-heading-row"><div><p className="eyebrow">OPERATIONS CONTROL CENTER</p><h1>管理运营门户</h1><p>早上好，雅雯。这里汇总待办、账号安全、系统消息和上线进度。</p></div><div className="page-actions"><button className="secondary-button" type="button"><RefreshCcw size={16} />刷新状态</button><button className="primary-button" type="button"><Plus size={16} />邀请用户</button></div></section>
    <section className="admin-alert"><span><ShieldAlert size={21} /></span><div><b>安全提醒：2 个高权限账户尚未启用 MFA</b><p>请在本周安全审查前完成配置。停用账户已自动撤销所有活跃会话。</p></div><a href="/admin/security">立即处理 <ArrowRight size={15} /></a></section>
    <section className="admin-metric-grid"><AdminMetric icon={UserCheck} tone="purple" value="6" label="监护人待验证" note="2 项超过 24 小时" href="/admin/guardians" /><AdminMetric icon={Users} tone="blue" value="42" label="活跃团队成员" note="本周新增 3 人" href="/admin/mentors" /><AdminMetric icon={KeyRound} tone="amber" value="2" label="MFA 待配置" note="均为高权限账户" href="/admin/security" /><AdminMetric icon={CircleGauge} tone="green" value="98.6%" label="本月服务可用性" note="所有核心服务正常" href="/admin/security" /></section>
    <section className="admin-grid"><article className="surface admin-work"><div className="surface-heading"><div><p className="eyebrow">PRIORITY QUEUE</p><h2>运营待办</h2></div><span className="count-pill">9 项</span></div><AdminTask tone="red" icon={ShieldAlert} title="复核异常监护人资料" meta="吴欣怡 · 资料冲突 · 2 小时前" action="审核" /><AdminTask tone="amber" icon={UserRoundCog} title="导师 Alex Cheng 等待激活" meta="邀请将在 36 小时后过期" action="管理" /><AdminTask tone="blue" icon={RefreshCcw} title="季度权限复核" meta="已完成 76% · 还剩 11 个账户" action="继续" /><AdminTask tone="purple" icon={CheckCircle2} title="课程字典更新待发布" meta="新增 4 个课程体系和 18 个年级" action="查看" /></article>
      <article className="surface launch-progress"><div className="surface-heading"><div><p className="eyebrow">READINESS</p><h2>上线准备度</h2></div><b>84%</b></div><ProgressItem label="身份与权限" value={92} status="通过" /><ProgressItem label="核心业务数据" value={88} status="通过" /><ProgressItem label="监护人验证流程" value={78} status="复核中" /><ProgressItem label="安全与恢复演练" value={68} status="待完成" /><a className="card-link" href="/reports">查看完整上线清单 <ChevronRight size={15} /></a></article>
    </section>
    <section className="admin-bottom-grid"><article className="surface"><div className="surface-heading"><div><p className="eyebrow">SECURITY EVENTS</p><h2>近期安全事件</h2></div><a href="/admin/security">全部</a></div><EventRow tone="green" title="管理员 MFA 验证成功" meta="Olivia Chen · Taipei · 09:42" /><EventRow tone="amber" title="新设备登录需确认" meta="Jason Wu · Chrome on macOS · 08:16" /><EventRow tone="blue" title="导师账户权限已调整" meta="Simon Gao · 由 Ethan Wang 操作 · 昨天" /></article><article className="surface"><div className="surface-heading"><div><p className="eyebrow">MESSAGES</p><h2>系统消息</h2></div><span className="count-pill">3 未读</span></div><EventRow tone="purple" title="数据保留政策将在 8 月更新" meta="需要管理员确认 · 今天" /><EventRow tone="blue" title="学校导入批次已完成" meta="2,418 行成功 · 7 行待处理" /><EventRow tone="green" title="每周备份验证完成" meta="恢复点可用 · 昨天 03:00" /></article></section>
  </div>;
}

function AdminMetric({ icon: Icon, tone, value, label, note, href }: { icon: React.ElementType; tone: string; value: string; label: string; note: string; href: string }) { return <a className="admin-metric" href={href}><span className={tone}><Icon size={20} /></span><div><b>{value}</b><span>{label}</span><small>{note}</small></div><ChevronRight size={16} /></a>; }
function AdminTask({ icon: Icon, tone, title, meta, action }: { icon: React.ElementType; tone: string; title: string; meta: string; action: string }) { return <div className="admin-task"><span className={tone}><Icon size={18} /></span><div><b>{title}</b><small>{meta}</small></div><button type="button">{action}</button></div>; }
function ProgressItem({ label, value, status }: { label: string; value: number; status: string }) { return <div className="launch-row"><span><b>{label}</b><small>{status}</small></span><div><i style={{ width: `${value}%` }} /></div><b>{value}%</b></div>; }
function EventRow({ tone, title, meta }: { tone: string; title: string; meta: string }) { return <div className="event-row"><i className={tone} /><span><b>{title}</b><small>{meta}</small></span><ChevronRight size={15} /></div>; }

export function GuardianVerificationPage() {
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1); const [toast, setToast] = useState(""); const pageSize = 4;
  const filtered = useMemo(() => guardians.filter((item) => Object.values(item).join(" ").toLowerCase().includes(query.toLowerCase())), [query]);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize); const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">IDENTITY & RELATIONSHIP REVIEW</p><h1>监护人验证</h1><p>逐项核对身份、学生关系和冲突依据；系统不会自动批准中高风险申请。</p></div><button className="secondary-button" type="button">查看验证规则</button></section>
    <section className="verification-summary"><span><b>6</b><small>等待验证</small></span><span><b>2</b><small>超过 24 小时</small></span><span><b>1</b><small>高风险冲突</small></span><span><b>3.2h</b><small>平均处理时间</small></span></section>
    <section className="surface verification-table"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="搜索申请人、学生或邮箱…" /><div className="filter-chips"><button type="button">风险 <span>全部</span></button><button type="button">提交时间 <span>最近 7 天</span></button></div></div><div className="guardian-list">{visible.map((item) => <div className="guardian-row" key={item.id}><span className="record-avatar">{item.name[0]}</span><div><b>{item.name} · {item.english}</b><small>{item.email}</small></div><span><small>申请关联学生</small><b>{item.student}</b></span><span><small>匹配依据</small><b>{item.match}</b></span><span><StatusBadge tone={item.risk === "高" ? "red" : item.risk === "中" ? "amber" : "green"}>{item.risk}风险</StatusBadge><small>{item.submitted}</small></span><button className="secondary-button" type="button" onClick={() => setToast(`已打开 ${item.name} 的验证资料`)}>审核</button></div>)}</div><Pagination page={page} totalPages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} /></section>{toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

export function MentorManagementPage() {
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1); const [toast, setToast] = useState(""); const pageSize = 4;
  const filtered = useMemo(() => mentors.filter((item) => Object.values(item).join(" ").toLowerCase().includes(query.toLowerCase())), [query]); const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">MENTOR DIRECTORY & ACCOUNTS</p><h1>导师管理</h1><p>查看已注册导师、学生负载、账户状态、MFA 和最近登录。</p></div><button className="primary-button" type="button"><Plus size={16} />邀请导师</button></section>
    <section className="quick-summary"><span><b>{mentors.length}</b><small>已注册导师</small></span><span><b>4</b><small>活跃在线</small></span><span><b>90</b><small>服务学生</small></span><span><b>2</b><small>MFA 待配置</small></span></section>
    <section className="surface verification-table"><div className="table-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="搜索导师姓名、英文名或学科…" /><div className="filter-chips"><button type="button">状态 <span>全部</span></button><button type="button">学科 <span>全部</span></button></div></div><div className="mentor-list">{visible.map((item) => <div className="mentor-row" key={item.id}><span className="record-avatar mentor">{item.english.split(" ").map((part) => part[0]).join("")}</span><div><b>{item.name} · {item.english}</b><small>{item.subject}</small></div><span><small>学生负载</small><b>{item.students} 名</b></span><span><small>账户状态</small><StatusBadge tone={item.status === "活跃" ? "green" : item.status === "休假" ? "amber" : "gray"}>{item.status}</StatusBadge></span><span><small>MFA</small><b className={item.mfa ? "good-text" : "warn-text"}>{item.mfa ? "已启用" : "待配置"}</b></span><span><small>最近登录</small><b>{item.last}</b></span><button className="icon-button" type="button" onClick={() => setToast(`正在管理 ${item.name} 的账户`)}><MoreHorizontal size={18} /></button></div>)}</div><Pagination page={page} totalPages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} /></section>{toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}

export function SecurityAdminPage() {
  return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">SECURITY & AUDIT</p><h1>安全与审计</h1><p>监控高权限账户、活跃设备和关键操作。</p></div><button className="secondary-button" type="button"><RefreshCcw size={16} />重新检查</button></section><section className="security-grid"><article className="surface"><span className="security-hero green"><ShieldCheck size={28} /></span><h2>总体状态良好</h2><p>过去 30 天没有高危越权事件。2 个高权限账户仍需配置 MFA。</p><StatusBadge tone="green">防护运行中</StatusBadge></article><article className="surface"><div className="surface-heading"><h2>高权限账户</h2><b>12 / 14 安全</b></div><ProgressItem label="管理员 MFA" value={86} status="12 / 14" /><ProgressItem label="督导 MFA" value={100} status="8 / 8" /><ProgressItem label="导师 MFA" value={67} status="4 / 6" /></article><article className="surface"><div className="surface-heading"><h2>活跃会话</h2><b>38</b></div><EventRow tone="green" title="Chrome · Windows" meta="Olivia Chen · Taipei · 当前设备" /><EventRow tone="blue" title="Safari · macOS" meta="Jason Wu · Taipei · 32 分钟前" /><EventRow tone="amber" title="Chrome · Android" meta="Sophia Lin · Singapore · 新设备" /></article></section>
    <section className="surface audit-stream"><div className="surface-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>关键审计记录</h2></div><button className="secondary-button" type="button">导出审计</button></div><EventRow tone="purple" title="GUARDIAN_VERIFY · 监护关系获批" meta="由 Olivia Chen 操作 · 赵嘉敏 → 赵子墨 · 今天 10:41" /><EventRow tone="blue" title="ROLE_UPDATE · 导师权限调整" meta="由 Ethan Wang 操作 · Simon Gao · 今天 09:18" /><EventRow tone="amber" title="EXPORT_REQUEST · 敏感字段导出待审批" meta="由 Jason Wu 发起 · 42 条学生记录 · 昨天" /><EventRow tone="green" title="SESSION_REVOKE · 其他设备已退出" meta="由 Sophia Lin 操作 · 3 个会话 · 昨天" /></section></div>;
}
