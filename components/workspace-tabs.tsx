"use client";
import Link from "next/link";
import { useI18n } from "./i18n-provider";
import { useAppUser } from "./app-user-context";
import { hasCapability,type Capability } from "@/lib/capabilities";
export function WorkspaceNav({items,active}:{items:Array<{href:string;label:string;capability?:Capability}>;active:string}){
  const {t}=useI18n(),user=useAppUser();
  return <nav className="page-tabs" aria-label={t("customerOps.sections")}>{items.filter(item=>!item.capability||hasCapability(user.role,item.capability)).map(item=><Link href={item.href} key={item.href} aria-current={active===item.href?"page":undefined}>{t(item.label)}</Link>)}</nav>;
}
// Compatibility for unaffected workspaces: route links retain their semantics.
export const WorkspaceTabs = WorkspaceNav;
export const familyTabs=[{href:"/students",label:"ux.nav.students",capability:"education.view" as const},{href:"/households?tab=families",label:"ux.nav.families",capability:"education.view" as const}];
export const performanceTabs=[{href:"/sales/performance",label:"nav.performance"},{href:"/sales/allocation",label:"nav.allocation",capability:"performance.manage" as const}];
export const governanceTabs=[{href:"/data-quality",label:"nav.quality",capability:"dataQuality.manage" as const},{href:"/imports",label:"nav.imports",capability:"imports.view" as const},{href:"/duplicates",label:"nav.duplicates",capability:"duplicates.manage" as const}];
export const reportTabs=[{href:"/reports/executive",label:"management.title",capability:"education.view" as const},{href:"/reports/channels",label:"channelAnalytics.title",capability:"education.view" as const},{href:"/reports",label:"nav.reportCenter"},{href:"/analytics/consumption",label:"nav.consumption"},{href:"/reports/exports",label:"nav.exports",capability:"exports.request" as const}];
export const communicationTabs=[{href:"/messages",label:"customerOps.inbox",capability:"messages.view" as const},{href:"/messages?tab=bulk",label:"emailHistory.title",capability:"messages.view" as const},{href:"/messages?tab=templates",label:"customerOps.templates",capability:"messages.manage" as const},{href:"/messages?tab=portal",label:"nav.guardianPortal",capability:"portal.manage" as const}];
