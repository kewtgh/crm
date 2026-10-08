"use client";
import {useEffect,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {useReceiptMutation} from "@/hooks/use-receipt-mutation";
import {EnrollmentRelation} from "./enrollment-relation";
import {useI18n} from "./i18n-provider";
import {InlineMessage} from "./ui";
type Access={ownerId:string;scope:string;canEdit:boolean;canShare:boolean;shares:Array<{userId:string;name?:string;access:string}>};
export function ContactRecordAccess({id,ownerName}:{id:string;ownerName:string}){
 const {locale,t}=useI18n(),en=locale==="en",[data,setData]=useState<Access|null>(null),[recipient,setRecipient]=useState(""),[level,setLevel]=useState("READ"),[notice,setNotice]=useState("");
 const mutation=useReceiptMutation(`/api/contacts/${id}/access`);
 const refresh=async()=>{try{setData(await apiFetch<Access>(`/api/contacts/${id}/access`));setNotice("");}catch{setNotice(t("audit.savedRefreshFailed"));}};
 useEffect(()=>{const c=new AbortController();void apiFetch<Access>(`/api/contacts/${id}/access`,{signal:c.signal}).then(v=>{if(!c.signal.aborted)setData(v);}).catch(()=>{if(!c.signal.aborted)setNotice(t("modules.loadFailed"));});return()=>c.abort();},[id,t]);
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(await mutation.send({recipient,level})){setRecipient("");await refresh();}};
 return <section className="detail-section contact-access"><h2>{en?"Record access":"档案访问权限"}</h2><p>{en?"Visible to the owner, their actual management chain within the same department and explicitly shared members. Admin can read employee records; Super Admin has full workspace access. Communication consent does not grant access.":"联系人对负责人、同部门真实汇报链上的上级及明确共享成员可见。Admin 可读取员工档案；Super Admin 拥有所属工作区内的全部权限。通信同意不会授予档案访问权限。"}</p><dl className="workspace-info-grid"><div><dt>{t("crm.owner")}</dt><dd>{ownerName}</dd></div><div><dt>{en?"Visibility":"可见范围"}</dt><dd>{en?"Owner and same-department management chain":"负责人及同部门汇报链上级"}</dd></div>{data&&<div><dt>{en?"Your edit access":"当前编辑权限"}</dt><dd>{data.canEdit?(en?"Allowed by your record grant and role":"已获得记录编辑授权及角色权限"):(en?"Read only; management visibility does not grant editing":"只读；上级可见性不等于编辑授权")}</dd></div>}</dl>
 {data?.shares.map(g=><p key={g.userId}><span>{g.name||(en?"Shared member":"共享成员")}</span> · {g.access==="EDIT"?(en?"Read and edit":"读取及编辑"):(en?"Read only":"只读")}</p>)}
 {data?.canShare&&<details><summary>{en?"Manage explicit sharing":"管理明确共享"}</summary><form onSubmit={save}><fieldset className="follow-up-fields" disabled={mutation.pending||mutation.uncertain}><EnrollmentRelation type="USER" label={en?"Member":"成员"} required value={recipient} onChange={setRecipient}/><label className="field"><span>{en?"Access":"权限"}</span><select value={level} onChange={e=>setLevel(e.target.value)}><option value="READ">{en?"Read":"读取"}</option><option value="EDIT">{en?"Read and edit":"读取及编辑"}</option><option value="REVOKE">{en?"Revoke":"撤销共享"}</option></select></label></fieldset><button className="secondary-button" disabled={mutation.pending||!recipient}>{t(mutation.uncertain?"enrollments.retry":"common.save")}</button></form></details>}
 {mutation.error&&<InlineMessage type="error">{mutation.error}</InlineMessage>}{notice&&<InlineMessage type="info">{notice}<button className="text-button" onClick={()=>void refresh()}>{t("common.retry")}</button></InlineMessage>}</section>;
}
