"use client";
import { useI18n } from "./i18n-provider";
export function RecipientFilters({regions,tags,types,region,tag,type,onRegion,onTag,onType}:{regions:string[];tags:string[];types:string[];region:string;tag:string;type:string;onRegion:(value:string)=>void;onTag:(value:string)=>void;onType:(value:string)=>void}){
  const {t}=useI18n();
  const values=(items:string[])=>[...new Set(items)].filter(value=>value.trim());
  return <div className="form-grid email-recipient-filters">
    <label className="field"><span>{t("ux.region")}</span><select value={region} onChange={event=>onRegion(event.target.value)}><option value="">{t("ux.all")}</option>{values(regions).map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    <label className="field"><span>{t("ux.tag")}</span><select value={tag} onChange={event=>onTag(event.target.value)}><option value="">{t("ux.all")}</option>{values(tags).map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    <label className="field"><span>{t("ux.customerType")}</span><select value={type} onChange={event=>onType(event.target.value)}><option value="">{t("ux.all")}</option>{values(types).map(value=><option key={value} value={value}>{t(`contact.type.${value.toLowerCase()}`)}</option>)}</select></label>
  </div>;
}
