"use client";
import {useState,useRef} from "react";
import {apiFetch,ApiClientError} from "@/lib/api-client";
import {useI18n} from "./i18n-provider";
import {useAppUser} from "./app-user-context";
import {InlineMessage} from "./ui";
import type {CommercialContact} from "@/lib/education-business-repository";
export function ContactWechatEditor({contact,onSaved}:{contact:CommercialContact;onSaved:()=>Promise<void>}){
 const {t}=useI18n(),user=useAppUser(),busy=useRef(false),[pending,setPending]=useState(false),[error,setError]=useState("");
 if(!contact.can_edit||!["SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER","SALES_SPECIALIST"].includes(user.role))return null;
 const save=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();if(busy.current)return;const value=String(new FormData(e.currentTarget).get("wechatId")??"").trim();busy.current=true;setPending(true);setError("");try{await apiFetch(`/api/contacts/${contact.id}/communication`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedUpdatedAt:contact.updated_at,wechatId:value||null})});await onSaved();}catch(caught){setError(t(caught instanceof ApiClientError&&caught.code.includes("VERSION_CONFLICT")?"channel.conflict":"channel.invalid"));}finally{busy.current=false;setPending(false);}};
 return <details><summary>{t("channel.wechat")}</summary><form onSubmit={e=>void save(e)}><fieldset className="follow-up-fields" disabled={pending}><label className="field"><span>{t("channel.wechat")}</span><input name="wechatId" maxLength={100} defaultValue={contact.wechat_id??""}/></label><button className="secondary-button" disabled={pending}>{t(pending?"common.saving":"common.save")}</button></fieldset>{error&&<InlineMessage type="error">{error}</InlineMessage>}</form></details>;
}
