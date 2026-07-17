"use client";

import Link from "next/link";
import { BookOpen, CalendarDays, FileCheck2, ShieldCheck, Users } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

export function HelpPage(){const {t}=useI18n();const links=[{href:"/people",icon:Users,title:"ops.help.people",meta:"ops.help.peopleMeta"},{href:"/calendar",icon:CalendarDays,title:"calendar.title",meta:"calendar.description"},{href:"/contracts",icon:FileCheck2,title:"contracts.title",meta:"contracts.description"},{href:"/settings/security",icon:ShieldCheck,title:"ops.help.security",meta:"ops.help.securityMeta"}];return <div className="page-stack help-page"><section className="page-heading-row"><div><p className="eyebrow">{t("eyebrow.helpSupport")}</p><h1>{t("ops.help.title")}</h1><p>{t("ops.help.description")}</p></div></section><section className="simple-hub-grid">{links.map(({href,icon:Icon,title,meta})=><Link href={href} key={href}><span><Icon size={21}/></span><div><b>{t(title)}</b><small>{t(meta)}</small></div></Link>)}</section><section className="surface help-contact"><BookOpen size={22}/><div><h2>{t("ops.help.still")}</h2><p>{t("ops.help.hours")}</p></div><a className="primary-button" href="mailto:support@lumina-edu.com">{t("ops.help.contact")}</a></section></div>;}
