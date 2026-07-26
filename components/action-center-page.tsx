"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, Filter, ShieldCheck } from "lucide-react";
import type { ActionCenterSnapshot } from "@/lib/action-center-repository";
import { roleMessageKey } from "@/lib/roles";
import { useI18n } from "./i18n-provider";
import { StatusBadge } from "./ui";

type FilterValue="all"|ActionCenterSnapshot["items"][number]["category"];
export function ActionCenterPage({snapshot}:{snapshot:ActionCenterSnapshot}){const {t}=useI18n();const [filter,setFilter]=useState<FilterValue>("all");const visible=filter==="all"?snapshot.items:snapshot.items.filter(item=>item.category===filter);return <div className="page-stack action-center-page">
  <section className="page-heading-row"><div><p className="eyebrow">{t("actionCenter.eyebrow")}</p><h1>{t("actionCenter.title")}</h1><p>{t("actionCenter.description",{role:t(roleMessageKey[snapshot.role])})}</p></div><StatusBadge tone={snapshot.urgent?"red":"green"}>{t(snapshot.urgent?"actionCenter.urgentCount":"actionCenter.clear",{count:snapshot.urgent})}</StatusBadge></section>
  <section className="quick-summary action-center-summary" aria-label={t("actionCenter.summary")}><span><b>{snapshot.total}</b><small>{t("actionCenter.total")}</small></span><span><b>{snapshot.urgent}</b><small>{t("actionCenter.urgent")}</small></span><span><b>{snapshot.items.length}</b><small>{t("actionCenter.workstreams")}</small></span></section>
  <nav className="action-center-filters" aria-label={t("actionCenter.filters")}><Filter size={17}/>{(["all","work","sales","service","governance"] as const).map(value=><button key={value} className={filter===value?"active":""} type="button" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{t(`actionCenter.category.${value}`)}</button>)}</nav>
  <section className="action-center-grid">{visible.map(item=><Link className={`surface action-center-card ${item.priority}`} href={item.href} key={item.id}><span className="action-center-icon">{item.priority==="urgent"?<CircleAlert size={21}/>:<ShieldCheck size={21}/>}</span><div><span>{t(`actionCenter.category.${item.category}`)}</span><h2>{t(item.titleKey,{count:item.count})}</h2><p>{t(item.detailKey)}</p><small>{t("actionCenter.source")}</small></div><strong>{item.count}</strong><ArrowRight size={18}/></Link>)}</section>
  {!visible.length&&<section className="surface action-center-empty"><CheckCircle2 size={28}/><h2>{t("actionCenter.empty")}</h2><p>{t("actionCenter.emptyHelp")}</p></section>}
  </div>;}
