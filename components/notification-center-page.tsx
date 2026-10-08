"use client";
import {WorkspaceHeading} from "./workspace-heading";


import Link from "next/link";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import type { NotificationRecord } from "@/lib/notifications-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage, Pagination } from "./ui";
import { useUserPreferences } from "./user-preferences-context";
import { useNotifications } from "@/hooks/use-notifications";
import { notificationHref } from "@/lib/notification-link";

export function NotificationCenterPage({initialItems,initialTotal}:{initialItems:NotificationRecord[];initialTotal:number}){
  const {t}=useI18n();
  const {formatDate}=useUserPreferences();
  const {items,total,page,pageSize,error,loading,pending,load,markRead}=useNotifications({items:initialItems,total:initialTotal});
  return <div className="page-stack">
    <section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.teamInbox")}</p><WorkspaceHeading>{t("nav.notifications")}</WorkspaceHeading><p>{t("notifications.description")}</p></div><button className="secondary-button" type="button" disabled={loading||pending} onClick={()=>void load(page)}><RefreshCw size={16}/>{t("notifications.refresh")}</button></section>
    {error&&<div className="table-error"><InlineMessage type="error">{error}</InlineMessage><button className="secondary-button" type="button" disabled={loading||pending} onClick={()=>void load(page)}>{t("common.retry")}</button></div>}
    <section className="surface notification-center" aria-busy={loading||pending}>
      {items.map(item=><article key={item.id}><span><Bell size={18}/></span><div><Link href={notificationHref(item)}><b>{t(item.titleKey,item.values)}</b></Link><p>{t(item.bodyKey,item.values)}</p><time>{formatDate(item.createdAt,{includeTime:true})}</time></div><button className="secondary-button" type="button" disabled={pending||loading} onClick={()=>void markRead({ids:[item.id]})}><CheckCheck size={16}/>{t("nav.markRead")}</button></article>)}
      {!items.length&&!loading&&!error&&<div className="empty-state"><span>{t("nav.notification.empty")}</span></div>}
      <Pagination page={Math.min(page,Math.max(1,Math.ceil(total/pageSize)))} totalPages={Math.max(1,Math.ceil(total/pageSize))} total={total} pageSize={pageSize} onPage={value=>{if(!pending)void load(value);}} onPageSize={value=>{if(!pending)void load(1,value);}}/>
    </section>
  </div>;
}
