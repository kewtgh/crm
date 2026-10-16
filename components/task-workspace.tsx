"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { filterTaskQueue, parseTaskQueueFilter, taskQueueFilters, TASK_QUEUE_PAGE_SIZE, taskIsDueToday } from "@/lib/task-queue";
import { Check, Clock3, UsersRound } from "lucide-react";
import type { TaskWorkspace } from "@/lib/task-workspace-repository";
import { useI18n } from "@/components/i18n-provider";
import { useUserPreferences } from "@/components/user-preferences-context";
import { AccessibleDrawer, InlineMessage, ProgressBar, StatusBadge, Toast, Pagination, SearchField } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { useAppUser } from "@/components/app-user-context";

export function TaskWorkspacePanel({initial,refreshKey,onMutated}:{initial:TaskWorkspace;refreshKey:number;onMutated:()=>void}){
  const {locale,t}=useI18n();const {formatDate,timezone}=useUserPreferences();
  const router=useRouter(),pathname=usePathname(),searchParams=useSearchParams();
  const filter=parseTaskQueueFilter(searchParams.get("queue"));
  const user=useAppUser();
  const [workspace,setWorkspace]=useState(initial);const [selected,setSelected]=useState<string[]>([]);
  const [search,setSearch]=useState("");
  const [queuePage,setQueuePage]=useState({filter:filter as string,search:"",page:1});
  const [confirmOpen,setConfirmOpen]=useState(false),[pending,setPending]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(""),[readFailed,setReadFailed]=useState(false),[toast,setToast]=useState("");
  const busy=useRef(false),readSequence=useRef(0),readController=useRef<AbortController|null>(null);
  const cancelRead=useCallback(()=>{readSequence.current++;readController.current?.abort();},[]);
  const [now,setNow]=useState(()=>Date.now());
  const refresh=useCallback(async()=>{
    if(busy.current)return;
    const sequence=++readSequence.current;
    readController.current?.abort();
    const controller=new AbortController();readController.current=controller;
    setRefreshing(true);setError("");
    try{
      const result=await apiFetch<TaskWorkspace>("/api/tasks",{signal:controller.signal});
      if(sequence!==readSequence.current||controller.signal.aborted)return;
      setNow(Date.now());setWorkspace(result);setReadFailed(false);
      setSelected(current=>current.filter(id=>result.items.some(item=>item.id===id)));
    }catch{
      if(sequence===readSequence.current&&!controller.signal.aborted){setReadFailed(true);setError(t("tasks.refreshFailed"));}
    }finally{if(sequence===readSequence.current&&!controller.signal.aborted)setRefreshing(false);}
  },[t]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>void refresh(),0);
    return()=>{window.clearTimeout(timer);cancelRead();};
  },[refreshKey,refresh,cancelRead]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),30_000);return()=>window.clearInterval(timer);},[]);
  const invalidateRead=()=>{cancelRead();setRefreshing(false);};
  const summary=useMemo(()=>({
    open:workspace.items.length,
    overdue:workspace.items.filter(item=>item.ownerId===user.id&&item.dueAt&&new Date(item.dueAt).getTime()<now).length,
    today:workspace.items.filter(item=>item.ownerId===user.id&&taskIsDueToday(item.dueAt,now,timezone)).length,
    week:workspace.items.filter(item=>item.dueAt&&new Date(item.dueAt).getTime()>=now&&new Date(item.dueAt).getTime()<now+7*86400000).length,
    sla:workspace.items.filter(item=>item.slaDueAt&&new Date(item.slaDueAt).getTime()<now).length,
  }),[now,timezone,user.id,workspace.items]);
  const visible=useMemo(()=>filterTaskQueue(workspace.items,filter,search,user.id,now,timezone),[filter,now,search,timezone,user.id,workspace.items]);
  const totalPages=Math.max(1,Math.ceil(visible.length/TASK_QUEUE_PAGE_SIZE));
  const page=Math.min(queuePage.filter===filter&&queuePage.search===search?queuePage.page:1,totalPages);
  const pageItems=visible.slice((page-1)*TASK_QUEUE_PAGE_SIZE,page*TASK_QUEUE_PAGE_SIZE);
  const selectedOnPage=selected.filter(id=>pageItems.some(item=>item.id===id));
  const selectFilter=(value:string)=>{
    const params=new URLSearchParams(searchParams.toString());
    if(value==="all")params.delete("queue");else params.set("queue",value);
    const query=params.toString();router.push(query?`${pathname}?${query}`:pathname,{scroll:false});setSelected([]);
  };
  const completeOne=async(id:string)=>{if(busy.current)return;busy.current=true;invalidateRead();setPending(true);setError("");try{await apiFetch(`/api/tasks/${id}`,{method:"PATCH"});setWorkspace(current=>({...current,items:current.items.filter(item=>item.id!==id)}));setSelected(current=>current.filter(value=>value!==id));setToast(t("dashboard.taskCompleted"));onMutated();}catch(caught){setError(presentApiError(caught,t,"dashboard.taskCompleteFailed").message);}finally{busy.current=false;setPending(false);}};
  const bulk=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(busy.current||!selectedOnPage.length)return;const reason=String(new FormData(event.currentTarget).get("reason")??"").trim();const completed=[...selectedOnPage];busy.current=true;invalidateRead();setPending(true);setError("");try{await apiFetch("/api/tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"bulkComplete",ids:completed,reason})});setWorkspace(current=>({...current,items:current.items.filter(item=>!completed.includes(item.id))}));setSelected([]);setConfirmOpen(false);setToast(t("dashboard.taskCompleted"));onMutated();}catch(caught){setError(presentApiError(caught,t,"dashboard.taskCompleteFailed").message);}finally{busy.current=false;setPending(false);}};
  const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  return <section className="task-workspace">
    <div className="quick-summary task-queue-summary">
      <span><b>{summary.today}</b><small>{t("tasks.filter.today")}</small></span><span><b>{summary.open}</b><small>{t("tasks.workQueue")}</small></span><span><b>{summary.overdue}</b><small>{t("tasks.overdue")}</small></span><span><b>{summary.week}</b><small>{t("tasks.dueThisWeek")}</small></span><span><b>{summary.sla}</b><small>{t("tasks.slaBreached")}</small></span>
    </div>
    <p className="task-queue-scope">{t("tasks.queueScope",{count:workspace.items.length})}</p>
    {error&&<InlineMessage type="error">{error}</InlineMessage>}
    <div className="page-actions"><button type="button" className="secondary-button" disabled={pending||refreshing} onClick={()=>void refresh()}>{t(refreshing?"common.loading":"taskQueue.refresh")}</button><span className="field-help" role="status">{t("taskQueue.scope")}</span></div>
    <div className="task-workspace-grid">
      <article className="surface task-work-list"><div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.priorityQueue")}</p><h2>{t("tasks.workQueue")}</h2></div>{selectedOnPage.length>0&&<button className="secondary-button" type="button" onClick={()=>setConfirmOpen(true)}>{t("tasks.bulkComplete")} · {selectedOnPage.length}</button>}</div>
        <div className="task-queue-filters" role="group" aria-label={t("tasks.filterLabel")}>{taskQueueFilters.map(value=><button key={value} className={filter===value?"secondary-button active":"secondary-button"} type="button" aria-pressed={filter===value} onClick={()=>selectFilter(value)}>{t(`tasks.filter.${value}`)}</button>)}</div>
        <SearchField value={search} onChange={value=>{setSearch(value);setSelected([]);}} placeholder={t("taskQueue.search")}/>
        {refreshing&&<p role="status">{t("common.loading")}</p>}
        {pageItems.map(item=>{const overdue=item.dueAt&&new Date(item.dueAt).getTime()<now;const sla=item.slaDueAt&&new Date(item.slaDueAt).getTime()<now;return <div className="task-work-row" key={item.id}><label><input type="checkbox" checked={selectedOnPage.includes(item.id)} disabled={pending} onChange={()=>toggle(item.id)} aria-label={`${t("tasks.select")}: ${locale==="zh-CN"?item.titleZh:item.titleEn}`}/></label><Link href={`/tasks/${item.id}`}><b>{locale==="zh-CN"?item.titleZh:item.titleEn}</b><small>{item.related||"—"} · {item.ownerName}</small></Link><span><time>{item.dueAt?formatDate(item.dueAt,{includeTime:true}):"—"}</time><StatusBadge tone={overdue||sla?"red":item.priority==="URGENT"?"amber":"blue"}>{overdue?t("tasks.overdue"):sla?t("tasks.slaBreached"):t(`modules.priority.${item.priority.toLowerCase()}`)}</StatusBadge></span><button className="icon-button" type="button" disabled={pending} onClick={()=>void completeOne(item.id)} aria-label={`${t("tasks.complete")}: ${locale==="zh-CN"?item.titleZh:item.titleEn}`}><Check size={17}/></button></div>;})}
        {!visible.length&&!readFailed&&!refreshing&&<div className="empty-state"><span>{t(filter==="all"&&!search?"tasks.noWork":"tasks.noFilterResults")}</span></div>}
        {visible.length>TASK_QUEUE_PAGE_SIZE&&<Pagination page={page} totalPages={totalPages} total={visible.length} pageSize={TASK_QUEUE_PAGE_SIZE} onPage={value=>{setQueuePage({filter,search,page:value});setSelected([]);}}/>}
        {visible.length>TASK_QUEUE_PAGE_SIZE&&<InlineMessage type="info">{t("tasks.queueTruncated",{shown:pageItems.length,total:visible.length})} <Link href="#record-list">{t("tasks.viewCompleteList")}</Link></InlineMessage>}
      </article>
      <article className="surface capacity-list"><div className="surface-heading"><div><p className="eyebrow">{t("modules.myTeam")}</p><h2>{t("tasks.teamCapacity")}</h2></div><UsersRound size={20}/></div>
        {workspace.canViewTeam?workspace.capacity.map(member=>{const score=Math.min(100,member.open*8+member.overdue*15+member.slaBreached*20);const level=score>=75?"high":score>=45?"medium":"low";return <div className="capacity-row" key={member.userId}><span className="record-avatar">{member.name.slice(0,1)}</span><div><b>{member.name}</b><small>{member.team} · {member.open} {t("tasks.workQueue")}</small><ProgressBar value={score} label={t(`tasks.load.${level}`)}/></div><span><b>{member.overdue}</b><small>{t("tasks.overdue")}</small></span></div>}):<InlineMessage type="info">{t("tasks.teamOnly")}</InlineMessage>}
      </article>
    </div>
    {confirmOpen&&<AccessibleDrawer pending={pending} title={t("tasks.bulkComplete")} description={t("common.actionCannotUndo")} onClose={()=>setConfirmOpen(false)}><form onSubmit={bulk}><InlineMessage type="warning">{t("modules.selected",{count:selectedOnPage.length})}</InlineMessage><label className="field"><span>{t("finance.reason")}</span><textarea name="reason" minLength={3} maxLength={500} required/></label><div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={()=>setConfirmOpen(false)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}><Clock3 size={16}/>{pending?t("common.processing"):t("common.confirm")}</button></div></form></AccessibleDrawer>}
    {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </section>;
}
