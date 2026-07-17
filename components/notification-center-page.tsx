"use client";
import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import type { NotificationRecord } from "@/lib/notifications-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage,Pagination } from "./ui";

export function NotificationCenterPage({initialItems,initialTotal}:{initialItems:NotificationRecord[];initialTotal:number}){
  const {locale,t}=useI18n();const [items,setItems]=useState(initialItems);const [total,setTotal]=useState(initialTotal);const [page,setPage]=useState(1);const [error,setError]=useState("");const pageSize=10;
  const load=async(next:number)=>{setError("");const response=await fetch(`/api/notifications?page=${next}&pageSize=${pageSize}`);const result=await response.json() as {items?:NotificationRecord[];total?:number};if(!response.ok||!result.items){setError(t("nav.notification.loadFailed"));return;}setPage(next);setItems(result.items);setTotal(result.total??0);};
  const read=async(item:NotificationRecord)=>{const response=await fetch("/api/notifications",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({ids:[item.id]})});if(!response.ok){setError(t("nav.notification.markFailed"));return;}setItems(current=>current.filter(entry=>entry.id!==item.id));setTotal(value=>Math.max(0,value-1));};
  return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.teamInbox")}</p><h1>{t("ops.messages.title")}</h1><p>{t("ops.messages.description")}</p></div></section>{error&&<InlineMessage type="error">{error}</InlineMessage>}<section className="surface notification-center">{items.map(item=><article key={item.id}><span><Bell size={18}/></span><div><b>{t(item.titleKey,item.values)}</b><p>{t(item.bodyKey,item.values)}</p><time>{new Intl.DateTimeFormat(locale==="zh-CN"?"zh-CN":"en",{dateStyle:"medium",timeStyle:"short"}).format(new Date(item.createdAt))}</time></div><button className="secondary-button" type="button" onClick={()=>read(item)}><CheckCheck size={16}/>{t("nav.markRead")}</button></article>)}{!items.length&&<div className="empty-state"><span>{t("nav.notification.empty")}</span></div>}<Pagination page={page} totalPages={Math.max(1,Math.ceil(total/pageSize))} total={total} pageSize={pageSize} onPage={load}/></section></div>;
}
