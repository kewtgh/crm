"use client";
import type {ReactNode} from "react";
import type {CommercialContact,OrganizationCommercialSnapshot} from "@/lib/education-business-repository";
import {UiIcon,type UiIconName} from "./ui-icon";
import {SectionHeader} from "./responsive-detail-layout";
import {ContactWechatEditor} from "./contact-wechat-editor";
import {MarkdownContent} from "./markdown-content";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";

/** Presentation of authorized Contact facts; no inferred scores or recommendations. */
export function ContactCommercialOverview({contact:c,intelligence:i,relationships,canEdit,onEdit,onSaved}:{contact:CommercialContact;intelligence?:OrganizationCommercialSnapshot["intelligence"][number];relationships:OrganizationCommercialSnapshot["relationships"];canEdit:boolean;onEdit:()=>void;onSaved:()=>Promise<boolean>}){
 const {t,locale}=useI18n(),{formatDate}=useUserPreferences(),en=locale==="en",unknown=t("channel.unknown");
 const score=(value:number|null|undefined)=>value==null?unknown:`${value} / 100`;
 const row=(icon:UiIconName,title:string,content:ReactNode)=><section className="contact-fact-row"><span className="contact-fact-icon"><UiIcon name={icon}/></span><div><h3>{title}</h3>{content}</div></section>;
 const summary:[UiIconName,string,string][]=[
  ["person",t("channel.decisionRole"),t(`contact.decisionRole.${c.decision_role.toLowerCase()}`)],
  ["metric",t("channel.field.decision_power_score"),score(i?.decision_power_score)],
  ["partnership",t("channel.field.contribution_score"),score(i?.contribution_score)],
  ["calendar",t("customerOps.field.next_follow_up_at"),c.next_follow_up_at?formatDate(c.next_follow_up_at,{includeTime:true}):unknown],
 ];
 const notes=(field:"working_style_markdown"|"cooperation_notes"|"potential_notes")=><MarkdownContent value={String(i?.[field]??"")} empty={unknown}/>;
 return <div className="contact-commercial-overview">
  <dl className="contact-commercial-metrics">{summary.map(([icon,title,value])=><div key={icon}><span className="contact-metric-icon"><UiIcon name={icon} size={24}/></span><div><dt>{title}</dt><dd>{value}</dd></div></div>)}</dl>
  <div className="contact-commercial-columns">
   <section className="detail-section contact-commercial-card">
    <SectionHeader icon={<UiIcon name="application"/>} title={en?"Commercial intelligence":"商业情报概览"} help={t("channel.internalHelp")} action={canEdit&&(!i||i.can_edit)&&<button type="button" className="secondary-button" onClick={onEdit}><UiIcon name="edit" size={16}/>{t("crm.edit")}</button>}/>
    {row("person",en?"Role / title":"职务／角色",<p>{c.title||unknown}</p>)}
    <div className="contact-communication-grid">
     {row("message",t("channel.wechat"),<><p>{c.wechat_id||unknown}</p>{canEdit&&<ContactWechatEditor key={c.updated_at} contact={c} onSaved={async()=>{await onSaved();}}/>}</>)}
     {row("activity",t("channel.field.working_style_markdown"),notes("working_style_markdown"))}
    </div>
    {row("partnership",t("channel.field.cooperation_notes"),notes("cooperation_notes"))}
    {row("potential",t("channel.field.potential_notes"),notes("potential_notes"))}
   </section>
   <section className="detail-section contact-commercial-card">
    <SectionHeader icon={<UiIcon name="opportunity"/>} title={en?"Relationship & assessment":"关系与合作评估"} help={en?"Recorded assessments and contact relationships.":"联系人评估与已记录的决策关系。"}/>
    {row("people",t("channel.field.key_contact_status"),<p><span className="contact-assessment-badge">{t(`channel.option.${i?.key_contact_status??"UNKNOWN"}`)}</span></p>)}
    {row("channel",t("channel.decisionMap"),relationships.length?<ul className="contact-relationship-list">{relationships.map(r=><li key={r.id}><span>{(en?r.source_name_en:r.source_name_zh)||r.source_name_zh||r.source_name_en}</span><span>{t(`channel.option.${r.relationship_type}`)} → {(en?r.target_name_en:r.target_name_zh)||r.target_name_zh||r.target_name_en}</span></li>)}</ul>:<p className="muted">{t("channel.emptyMap")}</p>)}
    {row("calendar",t("customerOps.field.next_follow_up_at"),<p>{c.next_follow_up_at?formatDate(c.next_follow_up_at,{includeTime:true}):unknown}</p>)}
   </section>
  </div>
 </div>;
}
