"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { filterTaskQueue, readTaskQueueView, writeTaskQueueView, taskPriorities, taskQueueFilters, TASK_QUEUE_PAGE_SIZE, taskIsDueToday } from "@/lib/task-queue";
import { Check, Clock3, UsersRound } from "lucide-react";
import type { TaskWorkspace } from "@/lib/task-workspace-repository";
import { useI18n } from "@/components/i18n-provider";
import { useUserPreferences } from "@/components/user-preferences-context";
import { AccessibleDrawer, InlineMessage, ProgressBar, StatusBadge, Toast, Pagination, SearchField } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import {useTaskCompletion} from "@/hooks/use-task-completion";
import type {TaskCompletionDraft} from "@/lib/task-completion";
import { useAppUser } from "@/components/app-user-context";

export function TaskWorkspacePanel({initial,refreshKey,onMutated}:{initial:TaskWorkspace;refreshKey:number;onMutated:()=>void}){
  const {locale,t}=useI18n();const {formatDate,timezone}=useUserPreferences();
  const router=useRouter(),pathname=usePathname(),searchParams=useSearchParams();
  const view=readTaskQueueView(new URLSearchParams(searchParams.toString()));
  const {filter,search,priority}=view;
  const user=useAppUser();
  const [workspace,setWorkspace]=useState(initial);const [selected,setSelected]=useState<string[]>([]);
  const completion=useTaskCompletion();
  const [confirmOpen,setConfirmOpen]=useState(false),[pending,setPending]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(""),[readFailed,setReadFailed]=useState(false),[toast,setToast]=useState("");
  const [refreshOnly,setRefreshOnly]=useState(false),[bulkTasks,setBulkTasks]=useState<Array<{id:string;expectedRevision:number}>>([]);
  const busy=useRef(false),readSequence=useRef(0),readController=useRef<AbortController|null>(null);
  const cancelRead=useCallback(()=>{readSequence.current++;readController.current?.abort();},[]);
  const [now,setNow]=useState(()=>Date.now());
  const uncertain=completion.uncertain;
  const refresh=useCallback(async(force=false)=>{
    if(!force&&(busy.current||uncertain))return false;
    const sequence=++readSequence.current;
    readController.current?.abort();
    const controller=new AbortController();readController.current=controller;
    setRefreshing(true);setError("");
    try{
      const result=await apiFetch<TaskWorkspace>("/api/tasks",{signal:controller.signal});
      if(sequence!==readSequence.current||controller.signal.aborted)return false;
      if(!Array.isArray(result.items)||!Array.isArray(result.capacity))throw new Error("INVALID_TASK_WORKSPACE");
      setNow(Date.now());setWorkspace(result);setReadFailed(false);
      setRefreshOnly(false);
      setSelected(current=>current.filter(id=>result.items.some(item=>item.id===id)));
      return true;
    }catch{
      if(sequence===readSequence.current&&!controller.signal.aborted){setReadFailed(true);setError(t("tasks.refreshFailed"));}
      return false;
    }finally{if(sequence===readSequence.current&&!controller.signal.aborted)setRefreshing(false);}
  },[t,uncertain]);
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
  const visible=filterTaskQueue(workspace.items,filter,search,user.id,now,timezone,priority);
  const totalPages=Math.max(1,Math.ceil(visible.length/TASK_QUEUE_PAGE_SIZE));
  const page=Math.min(view.page,totalPages);
  const paramsKey=searchParams.toString();
  useEffect(()=>{
    if(view.page===page||pending||uncertain||refreshing||readFailed)return;
    const params=new URLSearchParams(paramsKey);
    const query=writeTaskQueueView(params,{...readTaskQueueView(params),page}).toString();
    router.replace(query?`${pathname}?${query}`:pathname,{scroll:false});
  },[view.page,page,pending,uncertain,refreshing,readFailed,paramsKey,router,pathname]);
  const pageItems=visible.slice((page-1)*TASK_QUEUE_PAGE_SIZE,page*TASK_QUEUE_PAGE_SIZE);
  const selectedOnPage=selected.filter(id=>pageItems.some(item=>item.id===id));
  const selectView=(change:Partial<typeof view>,replace=false)=>{
    if(pending||completion.uncertain)return;
    const params=writeTaskQueueView(new URLSearchParams(searchParams.toString()),{...view,...change});
    const query=params.toString();(replace?router.replace:router.push)(query?`${pathname}?${query}`:pathname,{scroll:false});setSelected([]);
  };
  const locked=pending||completion.uncertain||refreshing||readFailed||refreshOnly;
  const complete=async(draft?:TaskCompletionDraft)=>{
    if(busy.current||draft&&locked)return;
    busy.current=true;invalidateRead();setPending(true);setError("");
    try{
      const result=await completion.send(draft);
      if(!result){setReadFailed(true);return;}
      setWorkspace(current=>({...current,items:current.items.filter(item=>!result.ids.includes(item.id))}));
      setSelected([]);setConfirmOpen(false);onMutated();
      if(await refresh(true))setToast(t("dashboard.taskCompleted"));else setRefreshOnly(true);
    }finally{busy.current=false;setPending(false);}
  };
  const bulk=(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(locked||!bulkTasks.length)return;const reason=String(new FormData(event.currentTarget).get("reason")??"").trim();void complete({operation:"bulkComplete",tasks:bulkTasks,reason});};
  const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  return <section className="task-workspace">
    <div className="quick-summary task-queue-summary">
      <span><b>{summary.today}</b><small>{t("tasks.filter.today")}</small></span><span><b>{summary.open}</b><small>{t("tasks.workQueue")}</small></span><span><b>{summary.overdue}</b><small>{t("tasks.overdue")}</small></span><span><b>{summary.week}</b><small>{t("tasks.dueThisWeek")}</small></span><span><b>{summary.sla}</b><small>{t("tasks.slaBreached")}</small></span>
    </div>
    <p className="task-queue-scope">{t("tasks.queueScope",{count:workspace.items.length})}</p>
    {error&&<InlineMessage type="error">{error}</InlineMessage>}
    {completion.error&&!confirmOpen&&<InlineMessage type="error">{completion.error}</InlineMessage>}
    {refreshOnly&&<InlineMessage type="warning">{t("taskQueue.refreshOnly")}</InlineMessage>}
    {completion.uncertain&&!confirmOpen&&<button type="button" className="secondary-button" disabled={pending} onClick={()=>void complete()}>{t("business.retrySame")}</button>}
    <div className="page-actions"><button type="button" className="secondary-button" disabled={pending||refreshing||completion.uncertain} onClick={()=>void refresh()}>{t(refreshing?"common.loading":"taskQueue.refresh")}</button><span className="field-help" role="status">{t("taskQueue.scope")}</span></div>
    <div className="task-workspace-grid">
      <article className="surface task-work-list" aria-busy={pending||refreshing}><div className="surface-heading"><div><p className="eyebrow">{t("eyebrow.priorityQueue")}</p><h2>{t("tasks.workQueue")}</h2></div>{selectedOnPage.length>0&&<button className="secondary-button" type="button" disabled={locked} onClick={()=>{setBulkTasks(pageItems.filter(item=>selectedOnPage.includes(item.id)).map(item=>({id:item.id,expectedRevision:item.revision})));setConfirmOpen(true);}}>{t("tasks.bulkComplete")} · {selectedOnPage.length}</button>}</div>
        <fieldset className="task-queue-controls" disabled={pending||completion.uncertain}>
        <div className="task-queue-filters" role="group" aria-label={t("tasks.filterLabel")}>{taskQueueFilters.map(value=><button key={value} className={filter===value?"secondary-button active":"secondary-button"} type="button" aria-pressed={filter===value} onClick={()=>selectView({filter:value,page:1})}>{t(`tasks.filter.${value}`)}</button>)}</div>
        <SearchField value={search} onChange={value=>selectView({search:value.slice(0,100),page:1},true)} placeholder={t("taskQueue.search")}/>
        <label className="field"><span>{t("taskQueue.priority")}</span><select value={priority} onChange={event=>selectView({priority:event.target.value as typeof priority,page:1})}>{taskPriorities.map(value=><option value={value} key={value}>{t(value==="all"?"common.all":`modules.priority.${value.toLowerCase()}`)}</option>)}</select></label>
        {(filter!=="all"||search||priority!=="all")&&<button type="button" className="secondary-button" onClick={()=>selectView({filter:"all",search:"",priority:"all",page:1})}>{t("taskQueue.reset")}</button>}
        </fieldset>
        {refreshing&&<p role="status">{t("common.loading")}</p>}
        {pageItems.map(item=>{const overdue=item.dueAt&&new Date(item.dueAt).getTime()<now;const sla=item.slaDueAt&&new Date(item.slaDueAt).getTime()<now;return <div className="task-work-row" key={item.id}><label><input type="checkbox" checked={selectedOnPage.includes(item.id)} disabled={locked||!Number.isSafeInteger(item.revision)} onChange={()=>toggle(item.id)} aria-label={`${t("tasks.select")}: ${locale==="zh-CN"?item.titleZh:item.titleEn}`}/></label><Link href={`/tasks/${item.id}`}><b>{locale==="zh-CN"?item.titleZh:item.titleEn}</b><small>{item.related||"—"} · {item.ownerName}</small></Link><span><time>{item.dueAt?formatDate(item.dueAt,{includeTime:true}):"—"}</time><StatusBadge tone={overdue||sla?"red":item.priority==="URGENT"?"amber":"blue"}>{overdue?t("tasks.overdue"):sla?t("tasks.slaBreached"):t(`modules.priority.${item.priority.toLowerCase()}`)}</StatusBadge></span><button className="icon-button" type="button" disabled={locked||!Number.isSafeInteger(item.revision)} onClick={()=>void complete({operation:"complete",tasks:[{id:item.id,expectedRevision:item.revision}]})} aria-label={`${t("tasks.complete")}: ${locale==="zh-CN"?item.titleZh:item.titleEn}`}><Check size={17}/></button></div>;})}
        {!visible.length&&!readFailed&&!refreshing&&<div className="empty-state"><span>{t(filter==="all"&&!search?"tasks.noWork":"tasks.noFilterResults")}</span></div>}
        {visible.length>TASK_QUEUE_PAGE_SIZE&&<Pagination page={page} totalPages={totalPages} total={visible.length} pageSize={TASK_QUEUE_PAGE_SIZE} onPage={value=>selectView({page:value})}/>}
        {visible.length>TASK_QUEUE_PAGE_SIZE&&<InlineMessage type="info">{t("tasks.queueTruncated",{shown:pageItems.length,total:visible.length})} <Link href="#record-list">{t("tasks.viewCompleteList")}</Link></InlineMessage>}
      </article>
      <article className="surface capacity-list"><div className="surface-heading"><div><p className="eyebrow">{t("modules.myTeam")}</p><h2>{t("tasks.teamCapacity")}</h2></div><UsersRound size={20}/></div>
        {workspace.canViewTeam?workspace.capacity.map(member=>{const score=Math.min(100,member.open*8+member.overdue*15+member.slaBreached*20);const level=score>=75?"high":score>=45?"medium":"low";return <div className="capacity-row" key={member.userId}><span className="record-avatar">{member.name.slice(0,1)}</span><div><b>{member.name}</b><small>{member.team} · {member.open} {t("tasks.workQueue")}</small><ProgressBar value={score} label={t(`tasks.load.${level}`)}/></div><span><b>{member.overdue}</b><small>{t("tasks.overdue")}</small></span></div>}):<InlineMessage type="info">{t("tasks.teamOnly")}</InlineMessage>}
      </article>
    </div>
    {confirmOpen&&<AccessibleDrawer pending={pending||completion.uncertain} title={t("tasks.bulkComplete")} description={t("common.actionCannotUndo")} onClose={()=>setConfirmOpen(false)}><form onSubmit={bulk}><InlineMessage type="warning">{t("modules.selected",{count:bulkTasks.length})}</InlineMessage>{completion.error&&<InlineMessage type="error">{completion.error}</InlineMessage>}<label className="field"><span>{t("finance.reason")}</span><textarea name="reason" minLength={3} maxLength={500} disabled={pending||completion.uncertain} required/></label><div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending||completion.uncertain} onClick={()=>setConfirmOpen(false)}>{t("common.cancel")}</button>{completion.uncertain?<button className="primary-button" type="button" disabled={pending} onClick={()=>void complete()}>{t("business.retrySame")}</button>:<button className="primary-button" disabled={locked}><Clock3 size={16}/>{pending?t("common.processing"):t("common.confirm")}</button>}</div></form></AccessibleDrawer>}
    {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </section>;
}
