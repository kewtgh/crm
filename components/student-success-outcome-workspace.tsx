"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {apiFetch} from "@/lib/api-client";
import type {ReportFilter} from "@/lib/management-trend-contract";
import type {SuccessOutcome} from "@/lib/student-success-outcomes-repository";
import {useI18n} from "./i18n-provider";
import {InlineMessage,Pagination} from "./ui";
import {ReportScopeNotice} from "./report-scope-notice";
type OutcomePage={items:SuccessOutcome[];total:number;page:number;pageSize:number};
export function SuccessOutcomeWorkspace({filters}:{filters:ReportFilter}){
 const {t}=useI18n(),[data,setData]=useState<OutcomePage|null>(null),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20),[retry,setRetry]=useState(0),[error,setError]=useState(false);
 const query=new URLSearchParams([...Object.entries({...filters,reportMetric:["outcomesRecorded","recordedOutcomes"].includes(filters.reportMetric??"")?filters.reportMetric:"recordedOutcomes"}).filter(([,v])=>v!==undefined) as [string,string][],["resource","outcomes"],["page",String(page)],["pageSize",String(pageSize)]]).toString();
 useEffect(()=>{const controller=new AbortController();void apiFetch<OutcomePage>(`/api/student-success?${query}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted){setData(data);setError(false);}}).catch(()=>{if(!controller.signal.aborted)setError(true);});return()=>controller.abort();},[query,retry]);
 return <section className="surface page-stack"><h2>{t("successOutcome.title")}</h2><ReportScopeNotice filter={filters}/>{error?<InlineMessage type="error">{t("success.loadFailed")}<button className="secondary-button" onClick={()=>setRetry(n=>n+1)}>{t("common.retry")}</button></InlineMessage>:!data?<p role="status">{t("common.loading")}</p>:<><div className="success-cards">{data.items.map(item=><article className="detail-section" key={item.id}><h3>{item.title}</h3><p>{item.occurred_on} · {t(`successOutcome.result.${item.result}`)}</p><Link href={`/student-success?focus=${item.case_id}`}>{t("success.viewCase")}</Link></article>)}</div>{!data.items.length&&<p>{t("common.noData")}</p>}<Pagination page={page} totalPages={Math.max(1,Math.ceil(data.total/data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1);}}/></>}</section>;
}
