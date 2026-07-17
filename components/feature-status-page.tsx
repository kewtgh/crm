"use client";

import Link from "next/link";
import {FileBarChart} from "lucide-react";
import {useI18n} from "@/components/i18n-provider";
import {InlineMessage} from "@/components/ui";

export function ReportsHubPage(){const{t}=useI18n();const reports=[{href:"/analytics/consumption",title:"reports.consumption",description:"reports.consumptionHelp"},{href:"/sales/performance",title:"reports.performance",description:"reports.performanceHelp"},{href:"/contracts",title:"reports.contracts",description:"reports.contractsHelp"},{href:"/reports/marketing",title:"marketingExport.title",description:"marketingExport.cardHelp"},{href:"/reports/exports",title:"reports.exports",description:"reports.exportsHelp"}];return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.reportsInsights")}</p><h1>{t("ops.reports.title")}</h1><p>{t("reports.description")}</p></div></section><section className="report-cards">{reports.map(item=><Link className="report-card" href={item.href} key={item.href}><span className="blue"><FileBarChart size={22}/></span><div><b>{t(item.title)}</b><small>{t(item.description)}</small></div></Link>)}</section><InlineMessage type="warning">{t("reports.exportApprovalHelp")}</InlineMessage></div>}
