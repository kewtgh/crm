"use client";
import Link from "next/link";
import { useScopeQuery } from "@/hooks/use-scope-query";
import type { OrganizationCommercialSnapshot } from "@/lib/education-business-repository";
import { formatFinanceAmount } from "@/lib/enrollment-finance";
import { useI18n } from "./i18n-provider";
import { RecordIdentity } from "./record-header";
import { InlineMessage, StatusBadge } from "./ui";
function response(value: unknown): OrganizationCommercialSnapshot {
  const result=value as OrganizationCommercialSnapshot;
  if(!Array.isArray(result?.opportunities)||result.opportunities.some(row=>typeof row.id!=="string"||typeof row.stage!=="string"||!["string","number"].includes(typeof row.amount)||typeof row.currency!=="string"||!/^\d+(\.\d{1,2})?$/.test(String(row.amount))||!/^[A-Z]{3}$/.test(row.currency)))throw new Error("RECORD_RESPONSE_INVALID");
  return result;
}
/** Existing commercial read model owns the amounts; this component never totals them. */
export function AccountOpportunitySummary({organizationId,limit}:{organizationId:string;limit?:number}){
  const {t,locale,enumLabel}=useI18n();
  const query=useScopeQuery(`/api/organizations/${organizationId}/commercial`,"",response);
  const rows=query.data?.opportunities.filter(row=>!limit||!["WON","LOST"].includes(String(row.stage)))??[];
  return <div className="detail-record-list" data-testid="account-opportunity-summary">
    {query.loading&&<p role="status">{t("common.loading")}</p>}
    {query.failure&&<InlineMessage type="error">{t("modules.loadFailed")}<button className="text-button" onClick={query.retry}>{t("common.retry")}</button></InlineMessage>}
    {(limit?rows.slice(0,limit):rows).map(row=><article key={String(row.id)}><div><Link href={`/opportunities?focus=${row.id}`}><RecordIdentity nameZh={String(row.title_zh??"")} nameEn={String(row.title_en??"")}/></Link><small>{String(row.currency)} {formatFinanceAmount(String(row.amount),locale)}</small>{Boolean(row.next_action_zh||row.next_action_en)&&<small>{t("ux.record.nextAction")}: {String((locale==="en"?row.next_action_en:row.next_action_zh)||row.next_action_zh||row.next_action_en)}</small>}{Boolean(row.owner_name_zh||row.owner_name_en)&&<small>{t("crm.owner")}: {String((locale==="en"?row.owner_name_en:row.owner_name_zh)||row.owner_name_zh||row.owner_name_en)}</small>}</div><StatusBadge tone="blue">{enumLabel(`sales.stage.${String(row.stage).toLowerCase()}`).label}</StatusBadge></article>)}
    {query.data&&!rows.length&&<p>{t("detail.noBusiness")}</p>}{query.data?.limited&&<p>{t("channel.limited")}</p>}
  </div>;
}
