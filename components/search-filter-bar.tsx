"use client";

import type { ReactNode } from "react";
import { SearchField } from "./ui";
import { useI18n } from "./i18n-provider";

/** Shared layout only: each owning resource retains its server-side filtering. */
export function SearchFilterBar({value,onChange,placeholder,children,actions,onSearch,pending=false,onReset,activeCount=0}: {
  value?:string; onChange?:(value:string)=>void; placeholder?:string;
  onReset?:()=>void; activeCount?:number;
  pending?:boolean; children?:ReactNode; actions?:ReactNode; onSearch?:()=>void;
}) {
  const {t}=useI18n();
  return <section className="search-filter-bar" aria-label={t("common.search")}>
    {onChange&&<div className="search-filter-query" onKeyDown={event=>{if(event.key==="Enter"&&onSearch&&!pending){event.preventDefault();onSearch();}}}>
      <SearchField value={value??""} onChange={onChange} placeholder={placeholder??t("common.search")}/>
    </div>}
    {children}
    {(actions||onSearch||onReset&&activeCount>0)&&<div className="search-filter-actions">{onReset&&activeCount>0&&<button type="button" className="secondary-button" disabled={pending} onClick={onReset}>{t("flow.resetFilters",{count:activeCount})}</button>}{onSearch&&<button type="button" className="primary-button" disabled={pending} onClick={onSearch}>{t("common.search")}</button>}{actions}</div>}
  </section>;
}
