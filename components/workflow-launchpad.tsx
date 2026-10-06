"use client";
import {useState} from "react";
import Link from "next/link";
import {ArrowUpRight,Users,GraduationCap,CheckSquare,ChartNoAxesCombined} from "lucide-react";
import {visibleWorkflowEntries} from "@/lib/workflow-navigation";
import {useAppUser} from "./app-user-context";
import {useI18n} from "./i18n-provider";
export function WorkflowLaunchpad(){const {t}=useI18n(),{role}=useAppUser(),items=visibleWorkflowEntries(role);const [audience,setAudience]=useState<'daily'|'management'>('daily');if(!items.length)return null;
 return <section className="surface workflow-launchpad"><header className="surface-heading"><div><p className="eyebrow">{t("flow.launchEyebrow")}</p><h2>{t("flow.launchTitle")}</h2><p>{t("flow.launchHelp")}</p></div></header><div className="workflow-audience" role="group" aria-label={t("flow.audience")} >{(['daily','management'] as const).map(value=><button key={value} type="button" aria-pressed={audience===value} onClick={()=>setAudience(value)}>{t(`flow.audience.${value}`)}</button>)}</div><div className="workflow-launch-grid">{items.filter(item=>item.audience===audience).map(item=>{const Icon=item.group==='management'?ChartNoAxesCombined:item.group==='delivery'?GraduationCap:item.group==='relationships'?Users:CheckSquare;return <Link key={item.key} href={item.href} className="workflow-launch-card"><span className="workflow-launch-icon"><Icon size={20}/></span><div><strong>{t(`flow.launch.${item.key}`)}</strong><p>{t(`flow.launch.${item.key}Help`)}</p></div><ArrowUpRight size={16}/></Link>;})}</div></section>;
}
