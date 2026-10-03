"use client";
import {useRef,useState} from "react";
import {ApiClientError,apiFetch} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import type {OpportunityRecord} from "@/lib/sales-repository";
import type {QuoteRecord} from "@/lib/phase2-repository";
import {useI18n} from "./i18n-provider";
import {AccessibleDrawer,InlineMessage} from "./ui";
import {EnrollmentRelation} from "./enrollment-relation";
import {ProductCohortSelector} from "./product-cohort-selector";
export function CommercialContextEditor({opportunity,quote,onClose,onSaved}:{opportunity?:OpportunityRecord;quote?:QuoteRecord;onClose:()=>void;onSaved:()=>Promise<void>}){
  const {t,locale}=useI18n(),[product,setProduct]=useState(opportunity?.productId??quote?.productId??""),[cohort,setCohort]=useState(opportunity?.cohortId??quote?.cohortId??""),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
  const attempt=useRef<Record<string,unknown>|null>(null),busy=useRef(false);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(busy.current)return;if(cohort&&!product||quote&&!product){setError(t("commercial.productChanged"));return;}
    if(!attempt.current)attempt.current=opportunity?{stage:opportunity.stage,probability:opportunity.probability,expectedCloseDate:opportunity.expectedCloseDate,nextActionZh:opportunity.nextActionZh,nextActionEn:opportunity.nextActionEn,evidence:opportunity.stage==="WON"?"" :undefined,commercialContext:{productId:product||null,cohortId:cohort||null},expectedRevision:opportunity.revision,requestKey:crypto.randomUUID()}:{operation:"updateQuoteCohort",target_quote:quote!.id,target_product:product,target_cohort:cohort||null,expected_revision:quote!.revision,requestKey:crypto.randomUUID()};
    busy.current=true;setPending(true);setError("");try{await apiFetch(opportunity?`/api/opportunities/${opportunity.id}`:"/api/finance",{method:opportunity?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(attempt.current)});}catch(error){const unknown=!(error instanceof ApiClientError)||error.status===0||error.status>=500;setUncertain(unknown);if(!unknown)attempt.current=null;setError(presentApiError(error,t,"commercial.saveFailed").message);busy.current=false;setPending(false);return;}attempt.current=null;setUncertain(false);await onSaved();busy.current=false;setPending(false);
  };
  return <AccessibleDrawer title={t("commercial.editContext")} pending={pending||uncertain} onClose={onClose}><form onSubmit={submit}><fieldset className="follow-up-fields" disabled={pending||uncertain}><EnrollmentRelation type="PRODUCT" label={t("products.product")} value={product} initialLabel={opportunity?(locale==="en"?opportunity.productEn:opportunity.productZh):undefined} required={!!quote} onChange={setProduct}/><ProductCohortSelector usage={opportunity?"OPPORTUNITY":"QUOTE"} productId={product} value={cohort} onChange={setCohort}/></fieldset>{error&&<InlineMessage type="error">{error}</InlineMessage>}{uncertain&&<InlineMessage type="warning">{t("enrollments.uncertain")}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending||uncertain} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{t(pending?"common.saving":uncertain?"enrollments.retry":"common.save")}</button></div></form></AccessibleDrawer>;
}
