"use client";
import {useEffect,useState} from "react";
import {apiFetch} from "@/lib/api-client";
import type {CohortEnrollmentSnapshot as Snapshot} from "@/lib/cohort-repository";
import type {ChannelEnrollmentSnapshot} from "@/lib/enrollment-repository";
import {useI18n} from "./i18n-provider";
import {InlineMessage} from "./ui";
export function CohortEnrollmentSnapshot({cohortId}:{cohortId:string}) {
 const {t,locale}=useI18n(),[open,setOpen]=useState(false),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[channels,setChannels]=useState<ChannelEnrollmentSnapshot[]>([]),[page,setPage]=useState(1),[error,setError]=useState(false);
 useEffect(()=>{if(!open)return;const controller=new AbortController();Promise.all([apiFetch<{item:Snapshot}>(`/api/product-cohorts/${cohortId}/snapshot`,{signal:controller.signal}),apiFetch<{items:ChannelEnrollmentSnapshot[]}>(`/api/enrollments/snapshots?cohortId=${cohortId}&page=${page}`,{signal:controller.signal})]).then(([data,sources])=>{if(!controller.signal.aborted){setSnapshot(data.item);setChannels(sources.items);setError(false);}}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[cohortId,open,page]);
 return <div><button type="button" className="text-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{t("cohortSnapshot.title")}</button>{open&&<div>
  {error?<InlineMessage type="error">{t("enrollments.loadFailed")}</InlineMessage>:!snapshot?<p role="status">{t("common.loading")}</p>:<><p className="field-help">{t("cohortSnapshot.scope")}</p><dl className="cohort-dates">{(["lead","interested","registering","active","completed","withdrawn","cancelled"] as const).map(key=><div key={key}><dt>{t(`enrollments.status.${key.toUpperCase()}`)}</dt><dd>{snapshot[key]}</dd></div>)}<div><dt>{t("cohortSnapshot.totalRecords")}</dt><dd>{snapshot.total_records}</dd></div><div><dt>{t("cohortSnapshot.currentOpen")}</dt><dd>{snapshot.current_open}</dd></div></dl>
   <p className="field-help">{t("cohortSnapshot.currentOpenHelp")}</p><h4>{t("cohortSnapshot.channels")}</h4>{channels.length===0?<p>{t("cohortSnapshot.noChannels")}</p>:<div className="detail-record-list">{channels.map(row=><article key={row.organization_id}><div><b>{locale==="en"?row.name_en:row.name_zh}</b><small>{t("cohortSnapshot.channelCounts",{primary:row.primary_enrollment_count,assist:row.assist_enrollment_count,active:row.active_enrollment_count})}</small></div></article>)}</div>}
   <div className="drawer-actions"><button type="button" className="secondary-button" disabled={page===1} onClick={()=>setPage(value=>value-1)}>{t("cohorts.previous")}</button><span>{page}</span><button type="button" className="secondary-button" disabled={channels.length<50} onClick={()=>setPage(value=>value+1)}>{t("cohorts.next")}</button></div>
  </>}
 </div>}</div>;
}
