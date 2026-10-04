"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import type {ApplicationPage} from "@/lib/application-repository";
import {useI18n} from "./i18n-provider";
import {InlineMessage} from "./ui";
import {ApplicationStatus} from "./application-detail";
export function EnrollmentApplicationsSection({enrollmentId,canEdit}:{enrollmentId:string;canEdit:boolean}){
 const {t,locale}=useI18n(),[data,setData]=useState<ApplicationPage|null>(null),[error,setError]=useState(false),[reload,setReload]=useState(0);
 useEffect(()=>{const controller=new AbortController();void apiFetch<ApplicationPage>(`/api/applications?enrollmentId=${enrollmentId}&pageSize=5`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setData(result);setError(false);}}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[enrollmentId,reload]);
 return <section className="detail-section"><h3>{t("applications.title")}{data?` (${data.total})`:""}</h3>{error?<InlineMessage type="error">{t("applications.loadFailed")}<button type="button" className="text-button" onClick={()=>setReload(value=>value+1)}>{t("common.retry")}</button></InlineMessage>:data?<><div className="detail-record-list">{data.items.map(row=><article key={row.id}><div><Link href={`/applications?focus=${row.id}`}>{(locale==="en"?row.target_name_en:row.target_name_zh)||row.external_application_id||t("applications.title")}</Link><small>{row.decision?t(`applications.decision.${row.decision}`):"—"} · {t("applications.deadline")}: {row.deadline_on||"—"}</small><small>{(locale==="en"?row.owner_name_en:row.owner_name_zh)||"—"}</small></div><ApplicationStatus status={row.status}/></article>)}</div>{!data.total&&<p className="detail-empty">{t("applications.empty")}</p>}</>:<p role="status">{t("common.loading")}</p>}<div className="detail-actions"><Link className="secondary-button" href={`/applications?enrollmentId=${enrollmentId}`}>{t("applications.title")}</Link>{canEdit&&<Link className="primary-button" href={`/applications?enrollmentId=${enrollmentId}&create=1`}>{t("applications.create")}</Link>}</div></section>;
}
