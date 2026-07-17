"use client";

import Link from "next/link";
import { Construction, FileBarChart, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { InlineMessage, StatusBadge } from "@/components/ui";

export function FeatureUnavailablePage({featureKey}:{featureKey:string}){const {t}=useI18n();return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">{t("feature.status.eyebrow")}</p><h1>{t(`${featureKey}.title`)}</h1><p>{t(`${featureKey}.description`)}</p></div><StatusBadge tone="amber"><Construction size={14}/>{t("feature.status.notEnabled")}</StatusBadge></section><section className="surface feature-status-card"><span><ShieldCheck size={28}/></span><div><h2>{t("feature.status.noFakeData")}</h2><p>{t("feature.status.explanation")}</p></div><InlineMessage type="warning">{t("feature.status.adminHelp")}</InlineMessage></section></div>;}

export function ReportsHubPage(){const {t}=useI18n();const reports=[{href:"/analytics/consumption",title:"reports.consumption",description:"reports.consumptionHelp"},{href:"/sales/performance",title:"reports.performance",description:"reports.performanceHelp"},{href:"/contracts",title:"reports.contracts",description:"reports.contractsHelp"},{href:"/reports/exports",title:"reports.exports",description:"reports.exportsHelp"}];return <div className="page-stack"><section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.reportsInsights")}</p><h1>{t("ops.reports.title")}</h1><p>{t("reports.description")}</p></div></section><section className="report-cards">{reports.map(item=><Link className="report-card" href={item.href} key={item.href}><span className="blue"><FileBarChart size={22}/></span><div><b>{t(item.title)}</b><small>{t(item.description)}</small></div></Link>)}</section><InlineMessage type="warning">{t("reports.exportApprovalHelp")}</InlineMessage></div>;}
