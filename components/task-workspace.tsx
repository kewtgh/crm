"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, Clock3, UsersRound } from "lucide-react";
import type { TaskWorkspace } from "@/lib/task-workspace-repository";
import { useI18n } from "@/components/i18n-provider";
import { useUserPreferences } from "@/components/user-preferences-context";
import { AccessibleDrawer, InlineMessage, ProgressBar, StatusBadge, Toast } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";

export function TaskWorkspacePanel({initial}:{initial:TaskWorkspace}){
  const {locale,t}=useI18n();const {formatDate}=useUserPreferences();
  const [workspace,setWorkspace]=useState(initial);const [selected,setSelected]=useState<string[]>([]);
  const [confirmOpen,setConfirmOpen]=useState(false);const [pending,setPending]=useState(false);const [error,setError]=useState("");const [toast,setToast]=useState("");
  const [now]=useState(()=>Date.now());
  const summary=useMemo(()=>({
    open:workspace.items.length,
    overdue:workspace.items.filter(item=>item.dueAt&&new Date(item.dueAt).getTime()<now).length,
    week:workspace.items.filter(item=>item.dueAt&&new Date(item.dueAt).getTime()>=now&&new Date(item.dueAt).getTime()<now+7*86400000).length,
    sla:workspace.items.filter(item=>item.slaDueAt&&new Date(item.slaDueAt).getTime()<now).length,
  }),[now,workspace.items]);
  const reload=async()=>setWorkspace(await apiFetch<TaskWorkspace>("/api/tasks"));
  const completeOne=async(id:string)=>{setPending(true);setError("");try{await apiFetch(`/api/tasks/${id}`,{method:"PATCH"});await reload();setSelected(current=>current.filter(value=>value!==id));setToast(t("dashboard.taskCompleted"));}catch{setError(t("dashboard.taskCompleteFailed"));}finally{setPending(false);}};
  const bulk=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const reason=String(new FormData(event.currentTarget).get("reason")??"").trim();setPending(true);setError("");try{await apiFetch("/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"bulkComplete",ids:selected,reason})});await reload();setSelected([]);setConfirmOpen(false);setToast(t("dashboard.taskCompleted"));}catch{setError(t("dashboard.taskCompleteFailed"));}finally{setPending(false);}};
  const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  return <section className="task-workspace">
    <div className="quick-summary">
      <span><b>{summary.open}</b><small>{t("tasks.workQueue")}</small></span><span><b>{summary.overdue}</b><small>{t("tasks.overdue")}</small></span><span><b>{summary.week}</b><small>{t("tasks.dueThisWeek")}</small></span><span><b>{summary.sla}</b><small>{t("tasks.slaBreached")}</small></span>
    </div>
    {error&&<InlineMessage type="error">{error}</InlineMessage>}
    <div className="task-workspace-grid">
      <article className="surface task-work-list"><div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.priorityQueue")}</p><h2>{t("tasks.workQueue")}</h2></div>{selected.length>0&&<button className="secondary-button" type="button" onClick={()=>setConfirmOpen(true)}>{t("tasks.bulkComplete")} · {selected.length}</button>}</div>
        {workspace.items.slice(0,12).map(item=>{const overdue=item.dueAt&&new Date(item.dueAt).getTime()<now;const sla=item.slaDueAt&&new Date(item.slaDueAt).getTime()<now;return <div className="task-work-row" key={item.id}><label><input type="checkbox" checked={selected.includes(item.id)} onChange={()=>toggle(item.id)} aria-label={t("tasks.select")}/></label><Link href={`/tasks/${item.id}`}><b>{locale==="zh-CN"?item.titleZh:item.titleEn}</b><small>{item.related||"—"} · {item.ownerName}</small></Link><span><time>{item.dueAt?formatDate(item.dueAt,{includeTime:true}):"—"}</time><StatusBadge tone={overdue||sla?"red":item.priority==="URGENT"?"amber":"blue"}>{overdue?t("tasks.overdue"):sla?t("tasks.slaBreached"):t(`modules.priority.${item.priority.toLowerCase()}`)}</StatusBadge></span><button className="icon-button" type="button" disabled={pending} onClick={()=>void completeOne(item.id)} aria-label={t("tasks.complete")}><Check size={17}/></button></div>;})}
        {!workspace.items.length&&<div className="empty-state"><span>{t("tasks.noWork")}</span></div>}
      </article>
      <article className="surface capacity-list"><div className="surface-heading"><div><p className="eyebrow">{t("modules.myTeam")}</p><h2>{t("tasks.teamCapacity")}</h2></div><UsersRound size={20}/></div>
        {workspace.canViewTeam?workspace.capacity.map(member=>{const score=Math.min(100,member.open*8+member.overdue*15+member.slaBreached*20);const level=score>=75?"high":score>=45?"medium":"low";return <div className="capacity-row" key={member.userId}><span className="record-avatar">{member.name.slice(0,1)}</span><div><b>{member.name}</b><small>{member.team} · {member.open} {t("tasks.workQueue")}</small><ProgressBar value={score} label={t(`tasks.load.${level}`)}/></div><span><b>{member.overdue}</b><small>{t("tasks.overdue")}</small></span></div>}):<InlineMessage type="info">{t("tasks.teamOnly")}</InlineMessage>}
      </article>
    </div>
    {confirmOpen&&<AccessibleDrawer title={t("tasks.bulkComplete")} description={t("common.actionCannotUndo")} onClose={()=>setConfirmOpen(false)}><form onSubmit={bulk}><InlineMessage type="warning">{t("modules.selected",{count:selected.length})}</InlineMessage><label className="field"><span>{t("finance.reason")}</span><textarea name="reason" minLength={3} maxLength={500} required/></label><div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setConfirmOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}><Clock3 size={16}/>{pending?t("common.processing"):t("common.confirm")}</button></div></form></AccessibleDrawer>}
    {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </section>;
}
