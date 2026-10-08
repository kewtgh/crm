"use client";
import {AutomaticRecordNumber} from "./automatic-record-number";
import {useState} from "react";
import {apiFetch} from "@/lib/api-client";
import {presentApiError} from "@/lib/api-error-presenter";
import {useI18n} from "./i18n-provider";
import {AccessibleDrawer,InlineMessage} from "./ui";
import {EnrollmentRelation} from "./enrollment-relation";
import {DateInput,CurrencySelect,MoneyInput} from "./structured-inputs";

type Draft={id:string;contract_number:string;product_id:string|null;start_date:string;end_date:string;currency:string;contract_value:string;status:string;updated_at:string};
export function OrganizationContractEditor({organizationId,contractId,onSaved}:{organizationId:string;contractId?:string;onSaved:()=>void}){
 const {t}=useI18n(),[open,setOpen]=useState(false),[item,setItem]=useState<Draft|null>(null),[product,setProduct]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const show=async()=>{setError("");setBusy(true);try{if(contractId){const result=await apiFetch<{item:Draft}>(`/api/contracts/${contractId}/draft`);setItem(result.item);setProduct(result.item.product_id??"");}setOpen(true);}catch(e){setError(presentApiError(e,t,"contracts.createFailed").message);}finally{setBusy(false);}};
 const save=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(busy)return;setBusy(true);setError("");const f=new FormData(event.currentTarget),fields={contractNumber:String(f.get("number")),productId:product||null,startDate:String(f.get("start")),endDate:String(f.get("end")),currency:String(f.get("currency")),amount:String(f.get("amount"))};try{
  await apiFetch(item?`/api/contracts/${item.id}/draft`:"/api/contracts",{method:item?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(item?{...fields,expectedUpdatedAt:item.updated_at}:{operation:"create",contractNumber:fields.contractNumber,productId:fields.productId,organizationId,startDate:fields.startDate,endDate:fields.endDate,currency:fields.currency,value:Number(fields.amount),relationshipLevel:1})});setOpen(false);onSaved();
 }catch(e){setError(presentApiError(e,t,"contracts.createFailed").message);}finally{setBusy(false);}};
 return <><button type="button" className="secondary-button" disabled={busy} onClick={()=>void show()}>{t(contractId?"common.edit":"contracts.new")}</button>{error&&!open&&<InlineMessage type="error">{error}</InlineMessage>}{open&&<AccessibleDrawer guardChanges pending={busy} title={t(contractId?"common.edit":"contracts.new")} onClose={()=>setOpen(false)}><form onSubmit={save}><fieldset disabled={busy||!!item&&item.status!=="DRAFT"} className="follow-up-fields"><label className="field"><span>{t("contracts.number")}</span>{item?<input name="number" defaultValue={item.contract_number} required minLength={2} maxLength={80}/>:<AutomaticRecordNumber name="number"/>}</label><EnrollmentRelation type="PRODUCT" label={t("products.product")} value={product} onChange={setProduct}/><div className="form-grid two-column"><label className="field"><span>{t("contracts.startDate")}</span><DateInput name="start" required defaultValue={item?.start_date}/></label><label className="field"><span>{t("contracts.endDate")}</span><DateInput name="end" required defaultValue={item?.end_date}/></label><label className="field"><span>{t("products.currency")}</span><CurrencySelect name="currency" defaultValue={item?.currency??"CNY"}/></label><label className="field"><span>{t("pipeline.amount")}</span><MoneyInput name="amount" defaultValue={item?.contract_value??""} required/></label></div>{error&&<InlineMessage type="error">{error}</InlineMessage>}<button className="primary-button" disabled={busy}>{t("common.save")}</button></fieldset></form></AccessibleDrawer>}</>;
}
