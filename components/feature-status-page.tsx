"use client";

import Link from "next/link";
import {useState} from "react";
import {FileBarChart,FileDown} from "lucide-react";
import {useCapability} from "@/components/app-user-context";
import {useI18n} from "@/components/i18n-provider";
import {AccessibleDrawer,InlineMessage,Toast} from "@/components/ui";
import {apiFetch} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";

type ReportResource="schools"|"students"|"households"|"sales"|"finance";

export function ReportsHubPage(){
  const{t}=useI18n();
  const canRequest=useCapability("exports.request");
  const[resource,setResource]=useState<ReportResource|null>(null);
  const[pending,setPending]=useState(false);
  const[error,setError]=useState("");
  const[toast,setToast]=useState("");
  const reports=[{href:"/analytics/consumption",title:"reports.consumption",description:"reports.consumptionHelp"},{href:"/sales/performance",title:"reports.performance",description:"reports.performanceHelp"},{href:"/contracts",title:"reports.contracts",description:"reports.contractsHelp"},{href:"/students",title:"reports.students",description:"reports.studentsHelp"},{href:"/households",title:"reports.households",description:"reports.householdsHelp"},{href:"/leads",title:"reports.leads",description:"reports.leadsHelp"},{href:"/reports/marketing",title:"marketingExport.title",description:"marketingExport.cardHelp"},{href:"/reports/exports",title:"reports.exports",description:"reports.exportsHelp"}];
  const exportResources:ReportResource[]=["schools","students","households","sales","finance"];
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!resource)return;
    const form=new FormData(event.currentTarget);setPending(true);setError("");
    try{
      await apiFetch("/api/approvals",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"CRM_EXPORT",resource,query:"",status:"all",sort:"primary",direction:"asc",format:form.get("format"),reason:form.get("reason")})});
      setResource(null);setToast(t("export.submitted"));
    }catch(caught){setError(presentApiError(caught,t,"export.failed").message);}
    finally{setPending(false);}
  };
  return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.reportsInsights")}</p><h1>{t("ops.reports.title")}</h1><p>{t("reports.description")}</p></div></section><section className="report-cards">{reports.map(item=><Link className="report-card" href={item.href} key={item.href}><span className="blue"><FileBarChart size={22}/></span><div><b>{t(item.title)}</b><small>{t(item.description)}</small></div></Link>)}</section>{canRequest&&<section className="surface"><div className="surface-heading"><div><p className="eyebrow">{t("reports.secureExportsEyebrow")}</p><h2>{t("reports.secureExports")}</h2><p>{t("reports.secureExportsHelp")}</p></div></div><div className="page-actions">{exportResources.map(item=><button className="secondary-button" key={item} type="button" onClick={()=>{setResource(item);setError("");}}><FileDown size={16}/>{t(`reports.export.${item}`)}</button>)}</div></section>}<InlineMessage type="warning">{t("reports.exportApprovalHelp")}</InlineMessage>{resource&&<AccessibleDrawer title={t("reports.requestExport",{name:t(`reports.export.${resource}`)})} description={t("export.requestHelp")} onClose={()=>setResource(null)}><form onSubmit={submit}><label className="field"><span>{t("export.format")}</span><select name="format" defaultValue="XLSX"><option>CSV</option><option>XLSX</option><option>PDF</option></select></label><label className="field"><span>{t("export.reason")}</span><textarea name="reason" rows={4} minLength={3} maxLength={1000} required placeholder={t("export.reasonPlaceholder")}/></label>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setResource(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}><FileDown size={16}/>{pending?t("common.processing"):t("export.request")}</button></div></form></AccessibleDrawer>}{toast&&<Toast message={toast} onClose={()=>setToast("")}/>}</div>;
}
