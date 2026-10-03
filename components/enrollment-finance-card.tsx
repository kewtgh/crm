"use client";
import {useEffect,useState} from "react";
import {apiFetch,ApiClientError} from "@/lib/api-client";
import {financeAmountFields,formatFinanceAmount,type EnrollmentFinanceProjection,type FinanceAmounts} from "@/lib/enrollment-finance";
import {useI18n} from "./i18n-provider";
import {InlineMessage} from "./ui";
import Link from "next/link";
export function EnrollmentFinanceCard({enrollmentId}:{enrollmentId:string}) {
 const {t,locale}=useI18n(),[data,setData]=useState<EnrollmentFinanceProjection|null>(null),[error,setError]=useState(false),[unavailable,setUnavailable]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();apiFetch<{item:EnrollmentFinanceProjection}>(`/api/enrollments/${enrollmentId}/finance`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setData(result.item);setError(false);setUnavailable(false);}}).catch(error=>{if(!controller.signal.aborted){setUnavailable(error instanceof ApiClientError&&error.status===403);setError(true);}});return()=>controller.abort();},[enrollmentId,retry]);
 const amounts=(values:FinanceAmounts,currency:string)=><dl className="enrollment-summary">{financeAmountFields.map(field=><div key={field}><dt>{t(`enrollmentFinance.${field}`)}</dt><dd>{currency} {formatFinanceAmount(values[field],locale)}</dd></div>)}</dl>;
 return <section className="detail-section"><h3>{t("enrollmentFinance.title")}</h3>
  {error?<InlineMessage type={unavailable?"warning":"error"}>{t(unavailable?"enrollmentFinance.unavailable":"finance.loadFailed")}{!unavailable&&<button type="button" className="secondary-button" onClick={()=>setRetry(value=>value+1)}>{t("common.retry")}</button>}</InlineMessage>:!data?<p role="status">{t("common.loading")}</p>:<>
   {!data.available&&<InlineMessage type="warning">{t("enrollmentFinance.unavailable")}</InlineMessage>}
   <p className="field-help">{t("enrollmentFinance.scope")}</p>
   {data.contracts.length===0?<p>{t("enrollmentFinance.none")}</p>:<>
    {data.allocationStatus&&<p>{t("enrollmentFinance.allocation")}: {t(`enrollmentFinance.allocation.${data.allocationStatus}`)}</p>}
    {data.exclusiveTotalsByCurrency.length>0&&<><h4>{t("enrollmentFinance.exclusiveTotals")}</h4>{data.exclusiveTotalsByCurrency.map(total=><div key={total.currency}>{amounts(total,total.currency)}</div>)}</>}
    {data.sharedContracts.length>0&&<InlineMessage type="warning">{t("enrollmentFinance.sharedWarning",{count:data.sharedContracts.length})}</InlineMessage>}
    <div className="detail-record-list">{data.contracts.map(contract=><article key={contract.contract_id}><div><Link href={`/contracts?focus=${contract.contract_id}`}>{contract.contract_number}</Link><small>{t(`enrollmentFinance.allocation.${contract.allocationMode}`)}</small>{amounts(contract,contract.currency)}{!contract.has_schedule&&<p className="field-help">{t("enrollmentFinance.noSchedule")}</p>}</div></article>)}</div>
   </>}
  </>}
 </section>;
}
