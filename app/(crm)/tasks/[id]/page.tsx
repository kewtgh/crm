import Link from "next/link";
import { DataLoadError } from "@/components/data-state";
import { CrmRecordEditor } from "@/components/crm-record-editor";
import { StatusBadge } from "@/components/ui";
import { loadCrmRecord } from "@/lib/crm-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { getRequestLocale } from "@/lib/page-metadata";
import { translate } from "@/lib/i18n";

export async function generateMetadata(){return localizedPageMetadata("meta.tasks");}

export default async function Page({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const [record,locale]=await Promise.all([loadCrmRecord("tasks",id).catch(()=>null),getRequestLocale()]);
  if(!record)return <DataLoadError/>;
  return <div className="page-stack">
    <section className="page-heading-row">
      <div><p className="eyebrow">{translate(locale,"modules.tasks.eyebrow")}</p><h1>{record.nameZh} / {record.nameEn}</h1><p>{translate(locale,"crm.taskDetails")}</p></div>
      <div className="page-actions"><Link className="secondary-button" href="/tasks">{translate(locale,"crm.backToTasks")}</Link><CrmRecordEditor resource="tasks" id={id} initial={record}/></div>
    </section>
    <section className="quick-summary">
      <span><b><StatusBadge tone={record.status==="DONE"?"green":record.status==="OVERDUE"?"red":"blue"}>{translate(locale,`crm.status.${record.status}`)}</StatusBadge></b><small>{translate(locale,"common.status")}</small></span>
      <span><b>{record.ownerName}</b><small>{translate(locale,"crm.owner")}</small></span>
      <span><b>{record.relatedLabel||"—"}</b><small>{translate(locale,"crm.related")}</small></span>
      <span><b>{record.priority?translate(locale,`modules.priority.${record.priority.toLowerCase()}`):"—"}</b><small>{translate(locale,"modules.priority")}</small></span>
    </section>
  </div>;
}
