"use client";
import {organizationFilterDefaults,contactFilterDefaults,noDirectoryFilters} from "@/lib/directory-filter-query";
import { FilterBar } from "./filter-bar";
import { RecordIdentity } from "./record-header";
import { presentMissing } from "@/lib/ux-presentation";
import { organizationAdvancedCount } from "@/lib/organization-filter-presentation";
import {EnrollmentRelation} from "./enrollment-relation";


import {commercialTiers} from "@/lib/channel-commercial-input";
import {useCapability} from "./app-user-context";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppUser } from "@/components/app-user-context";
import { ArrowDown, ArrowUp, ArrowUpDown, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import type { DataRow, ModuleConfig } from "@/lib/crm-data";
import type { CrmMetrics, PersistentResource } from "@/lib/crm-repository";
import { AccessibleDrawer, ConfirmDialog, InlineMessage, Pagination, ProgressBar, StatusBadge } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import { apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";
import { savedViewSchema, viewConfigSchema, type SavedView } from "@/lib/saved-view-schema";
import { usePagedResource } from "@/hooks/use-paged-resource";

type SortKey = "primary" | "secondary" | "status" | "meta" | "extra" | "completeness";
const validPageSize=(value:string|null)=>[10,20,50].includes(Number(value))?Number(value):10;

export function DataTable({ config, resource, initialTotal, refreshKey = 0, onMetrics, savedViewsOpen=false, onCloseSavedViews }: { config: ModuleConfig; resource?: PersistentResource; initialTotal?: number; refreshKey?: number; onMetrics?:(metrics:CrmMetrics)=>void;savedViewsOpen?:boolean;onCloseSavedViews?:()=>void }) {
  const { t } = useI18n();
  const user = useAppUser();
  const canViewCommercial=useCapability("education.view");
  const [savePending, setSavePending] = useState(false);
  const savingView = useRef(false);
  const prefix = `modules.${config.key}`;
  const {
    query,setQuery,page,setPage,pageSize,setPageSize,status,setStatus,sort,setSort,
    direction,setDirection,filters,setFilters,items:rows,total,loading,error,retry,
  }=usePagedResource<DataRow,CrmMetrics>({
    endpoint:resource?`/api/crm/${resource}`:"",
    filterDefaults:resource==="schools"?organizationFilterDefaults:resource==="people"?contactFilterDefaults:noDirectoryFilters,
    enabled:Boolean(resource),
    initialItems:config.rows,
    initialTotal:initialTotal??config.rows.length,
    refreshKey,
    onMetrics,
    errorMessage:t("modules.loadFailed"),
    requestIdLabel:t("common.requestId"),
  });
  const commercialFilter=filters as typeof organizationFilterDefaults;
  const contactFilters=filters as typeof contactFilterDefaults;
  const setCommercialFilter:React.Dispatch<React.SetStateAction<typeof organizationFilterDefaults>>=value=>setFilters(previous=>typeof value==="function"?value(previous as typeof organizationFilterDefaults):value);
  const setContactFilters:React.Dispatch<React.SetStateAction<typeof contactFilterDefaults>>=value=>setFilters(previous=>typeof value==="function"?value(previous as typeof contactFilterDefaults):value);
  const hasAppliedFilters=Boolean(query)||status!=="all"||Object.values(filters).some(Boolean);
  const resetFilters=()=>{setQuery("");setStatus("all");setFilters(resource==="schools"?{...organizationFilterDefaults}:resource==="people"?{...contactFilterDefaults}:{});setPage(1);};
  const [savedViews,setSavedViews]=useState<SavedView[]>([]);
  const [savedViewError,setSavedViewError]=useState("");
  const [deleteConfirmation,setDeleteConfirmation]=useState<SavedView|null>(null);
  const [deletePending,setDeletePending]=useState(false);
  const storageKey=`lumina-saved-views:${user.id}:${resource??config.key}`;

  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      try{
        const raw=JSON.parse(window.localStorage.getItem(storageKey)??"[]") as unknown;
        const local=Array.isArray(raw)?raw.flatMap(item=>{
          if(!item||typeof item!=="object")return[];
          const candidate=item as Record<string,unknown>;
          const config=viewConfigSchema.safeParse({version:1,query:candidate.query??"",status:candidate.status??"all",sort:candidate.sort??"primary",direction:candidate.direction??"asc",pageSize:candidate.pageSize??10});
          const parsed=savedViewSchema.safeParse({...(config.success?config.data:{}),id:String(candidate.id??crypto.randomUUID()),name:candidate.name,visibility:"PERSONAL",source:"LOCAL",owned:true});
          return parsed.success?[parsed.data]:[];
        }):[];
        setSavedViews(local);
      }catch{setSavedViews([]);setSavedViewError(t("savedViews.versionInvalid"));}
      if(resource){
        void apiFetch<{items:SavedView[]}>(`/api/views?resource=${resource}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setSavedViews(current=>[...current.filter(item=>item.source==="LOCAL"),...result.items]);}).catch(()=>{if(!controller.signal.aborted)setSavedViewError(t("savedViews.loadFailed"));});
      }
    },0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[resource,storageKey,t]);
  const persistViews=(views:SavedView[])=>{try{window.localStorage.setItem(storageKey,JSON.stringify(views.filter(item=>item.source==="LOCAL")));setSavedViews(views);return true;}catch{setSavedViewError(t("savedViews.saveFailed"));return false;}};

  const localRows = useMemo(() => {
    if (resource) return rows;
    const search = query.trim().toLowerCase();
    const filtered = config.rows.filter((row) => (!search || Object.values(row).join(" ").toLowerCase().includes(search)) && (status === "all" || row.status === status));
    return [...filtered].sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (direction === "asc" ? 1 : -1));
  }, [config.rows, direction, query, resource, rows, sort, status]);
  const effectiveTotal = resource ? total : localRows.length;
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = error ? [] : resource ? rows : localRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const statusOptions = useMemo(() => resource==="schools"?["HEALTHY","ATTENTION","DEVELOPING","RISK","UNVERIFIED"]:resource==="people"?["NEW","ATTEMPTING","CONNECTED","FOLLOW_UP","DORMANT"]:resource==="tasks"?["TODO","IN_PROGRESS","WAITING_APPROVAL","DONE","OVERDUE"]:Array.from(new Set(config.rows.map(row=>row.status))), [config.rows,resource]);
  const changeSort = (key: SortKey) => { if (sort === key) setDirection((value) => value === "asc" ? "desc" : "asc"); else { setSort(key); setDirection("asc"); } setPage(1); };
  const setSearch = (value: string) => { setQuery(value); };
  const applyView=(view:SavedView)=>{setQuery(view.query);setStatus(view.status);setSort(view.sort);setDirection(view.direction);setPageSize(validPageSize(String(view.pageSize)));setPage(1);onCloseSavedViews?.();};
  const saveView=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(savingView.current)return;
    const formElement=event.currentTarget;
    const form=new FormData(formElement);
    const name=String(form.get("name")??"").trim();
    const visibility=String(form.get("visibility")??"PERSONAL") as "PERSONAL"|"TEAM";
    if(!name)return;
    const config={version:1 as const,query,status,sort,direction,pageSize:pageSize as 10|20|50};
    savingView.current=true;setSavePending(true);setSavedViewError("");
    try{
      if(visibility==="TEAM"&&resource){
        const result=await apiFetch<{item:{id:string}}>("/api/views",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"save",resource,name,visibility,config})});
        // Commit the accepted write locally; a separate read failure must not invite a duplicate save.
        setSavedViews(current=>[...current.filter(item=>item.id!==result.item.id),{...config,id:result.item.id,name,visibility,source:"SERVER",owned:true}]);
      }else if(!persistViews([...savedViews.filter(item=>item.source!=="LOCAL"||item.name!==name),{...config,id:crypto.randomUUID(),name,visibility:"PERSONAL",source:"LOCAL",owned:true}]))return;
      formElement.reset();
    }catch{setSavedViewError(t("savedViews.saveFailed"));}
    finally{savingView.current=false;setSavePending(false);}
  };
  const deleteView=async(view:SavedView)=>{setSavedViewError("");setDeletePending(true);if(view.source==="SERVER"){if(!view.owned){setDeletePending(false);return;}try{await apiFetch("/api/views",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"delete",id:view.id})});setSavedViews(current=>current.filter(item=>item.id!==view.id));}catch{setSavedViewError(t("savedViews.saveFailed"));}}else persistViews(savedViews.filter(item=>item.id!==view.id));setDeletePending(false);setDeleteConfirmation(null);};
  const labels = {
    primary: t(`${prefix}.column.primary`),
    secondary: t(`${prefix}.column.secondary`),
    status: t("common.status"),
    meta: t(`${prefix}.column.meta`),
    extra: t(`${prefix}.column.extra`),
    completeness: t("modules.completeness"),
  };

  return <><div id="record-list" className={`data-surface ${resource === "schools" ? "ux-organization-directory" : ""} ${loading ? "is-loading" : ""}`} aria-busy={loading}>
    {resource === "schools" ? <FilterBar search={query} onSearchChange={setSearch} placeholder={t(`${prefix}.search`)} pending={loading}
      applied={commercialFilter} defaults={{commercialTier:"", keyContact:"", ownerId:commercialFilter.ownerId, potentialMin:"",city:"",curriculum:"",organizationType:""}}
      advancedCount={organizationAdvancedCount(commercialFilter)}
      activeCount={Number(Boolean(query))+Number(status!=="all")+Object.values(commercialFilter).filter(Boolean).length}
      onReset={()=>{setQuery("");setStatus("all");setCommercialFilter({commercialTier:"",keyContact:"",ownerId:"",potentialMin:"",city:"",curriculum:"",organizationType:""});setPage(1);}}
      onApply={value=>{setCommercialFilter(value);setPage(1);}}
      primaryFilters={<><label className="field"><span>{t("common.status")}</span><select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">{t("common.all")}</option>{statusOptions.map(value=><option key={value} value={value}>{t(`crm.status.${value}`)}</option>)}</select></label>{canViewCommercial&&<EnrollmentRelation type="USER" label={t("crm.owner")} value={commercialFilter.ownerId} onChange={value=>{setCommercialFilter(f=>({...f,ownerId:value}));setPage(1);}}/>}</>}
      renderAdvanced={canViewCommercial?(draft,change)=><div className="ux-advanced-fields"><label className="field"><span>{t("modules.city")}</span><input value={draft.city} maxLength={80} onChange={e=>change({...draft,city:e.target.value})}/></label><label className="field"><span>{t("modules.curriculum")}</span><input value={draft.curriculum} maxLength={120} onChange={e=>change({...draft,curriculum:e.target.value})}/></label><label className="field"><span>{t("repair.organizationType")}</span><select value={draft.organizationType} onChange={e=>change({...draft,organizationType:e.target.value})}><option value="">{t("common.all")}</option>{["SCHOOL","PARTNER","OTHER"].map(value=><option key={value} value={value}>{t("repair.orgType."+value)}</option>)}</select></label>{["commercialTier","keyContact","potentialMin"].map(k=><label className="field" key={k}><span>{t("channel.filter."+k)}</span>{k==="potentialMin"?<input type="number" min={10} max={100} step={1} value={draft.potentialMin} onChange={e=>change({...draft,potentialMin:e.target.value})}/>:<select value={draft[k as "commercialTier"|"keyContact"]} onChange={e=>change({...draft,[k]:e.target.value})}><option value="">{t("common.all")}</option>{(k==="commercialTier"?[...commercialTiers,"UNKNOWN"]:["KEY","MISSING"]).map(v=><option key={v} value={v}>{commercialTiers.includes(v as typeof commercialTiers[number])?v:t("channel.option."+v)}</option>)}</select>}</label>)}</div>:undefined}
    /> : <><FilterBar search={query} onSearchChange={setSearch} placeholder={t(prefix+".search")} applied={contactFilters} defaults={{organizationId:contactFilters.organizationId??"",ownerId:"",contactType:""}} pending={loading} advancedCount={[contactFilters.ownerId,contactFilters.contactType].filter(Boolean).length} activeCount={Number(!!query)+Number(status!=="all")+Object.values(contactFilters).filter(Boolean).length} onApply={value=>{setContactFilters(value);setPage(1);}} onReset={()=>{setQuery("");setStatus("all");setContactFilters({organizationId:"",ownerId:"",contactType:""});setPage(1);}} primaryFilters={<><label className="field"><span>{t("common.status")}</span><select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">{t("common.all")}</option>{statusOptions.map(value=><option value={value} key={value}>{t(resource==="people"?"contact.status."+value.toLowerCase():"crm.status."+value)}</option>)}</select></label>{resource==="people"&&<EnrollmentRelation type="ORGANIZATION" label={t("modules.organization")} value={contactFilters.organizationId} onChange={value=>{setContactFilters(f=>({...f,organizationId:value}));setPage(1);}}/>}</>} renderAdvanced={resource==="people"?(draft,change)=><><EnrollmentRelation type="USER" label={t("crm.owner")} value={draft.ownerId} onChange={value=>change({...draft,ownerId:value})}/><label className="field"><span>{t("contact.type")}</span><select value={draft.contactType} onChange={e=>change({...draft,contactType:e.target.value})}><option value="">{t("common.all")}</option>{["CONTACT","SCHOOL_STAFF","PARENT","STUDENT","PAYER"].map(value=><option key={value} value={value}>{t("contact.type."+value.toLowerCase())}</option>)}</select></label></>:undefined}/></>}
    {error && <div className="table-error"><InlineMessage type="error">{error}</InlineMessage><button className="secondary-button" type="button" onClick={retry}>{t("common.retry")}</button></div>}
    {loading&&<p className="directory-load-status" role="status">{t("common.loading")}</p>}
    <div className="table-scroll"><table className="data-table"><thead><tr>
      <SortHead field="primary" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.primary`)}</SortHead><SortHead field="secondary" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.secondary`)}</SortHead><SortHead field="status" active={sort} direction={direction} onSort={changeSort}>{t("common.status")}</SortHead><SortHead field="meta" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.meta`)}</SortHead><SortHead field="extra" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.extra`)}</SortHead><SortHead field="completeness" active={sort} direction={direction} onSort={changeSort}>{t("modules.completeness")}</SortHead></tr></thead>
      <tbody>{visible.map((row) => <DataTableRow key={row.id} row={row} labels={labels} organization={resource==="schools"} />)}</tbody></table>{!visible.length && !loading && !error && <div className="empty-state"><span>{t(hasAppliedFilters?"reliability.noMatches":"modules.noRecords")}</span><p>{t(hasAppliedFilters?"reliability.adjustFilters":"modules.noRecordsHelp")}</p></div>}</div>
    {resource==="schools"&&<div className="ux-organization-mobile-list"><div className="ux-mobile-sort"><label>{t("ux.sort")}<select aria-label={t("ux.sort")} value={sort} onChange={event=>{setSort(event.target.value as SortKey);setPage(1);}}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button className="icon-button" type="button" aria-label={t("ux.sort.reverse")} onClick={()=>{setDirection(value=>value==="asc"?"desc":"asc");setPage(1);}}>{direction==="asc"?<ArrowUp size={16}/>:<ArrowDown size={16}/>}</button></div>{visible.map(row=><OrganizationMobileRow key={row.id} row={row} labels={labels}/>)}{!visible.length&&!loading&&!error&&<div className="empty-state"><span>{t(hasAppliedFilters?"reliability.noMatches":"modules.noRecords")}</span><p>{t(hasAppliedFilters?"reliability.adjustFilters":"modules.noRecordsHelp")}</p></div>}</div>}
    {!loading&&!error&&<Pagination page={safePage} totalPages={totalPages} total={effectiveTotal} pageSize={pageSize} onPage={setPage} onPageSize={(value)=>{setPageSize(value);setPage(1);}} />}
  </div>{savedViewsOpen&&<AccessibleDrawer pending={savePending} title={t("modules.savedViews")} eyebrow={t("modules.savedViewsEyebrow")} description={(resource==="schools"||resource==="people")?t("ux.savedViews.scope"):t("modules.savedViewsHelp")} onClose={()=>onCloseSavedViews?.()}><form className="saved-view-form" onSubmit={saveView}><label className="field"><span>{t("modules.savedViewName")}</span><input name="name" required maxLength={60}/></label><label className="field"><span>{t("savedViews.source")}</span><select name="visibility" defaultValue="PERSONAL" required><option value="PERSONAL">{t("savedViews.personal")}</option>{resource&&<option value="TEAM">{t("savedViews.team")}</option>}</select></label><button className="primary-button" type="submit" disabled={savePending}><Save size={16}/>{t("modules.saveCurrentView")}</button></form>{savedViewError&&<InlineMessage type="error">{savedViewError}</InlineMessage>}<div className="saved-view-list">{savedViews.map(view=><article key={`${view.source}:${view.id}`}><button type="button" className="saved-view-main" onClick={()=>applyView(view)}><b>{view.name}</b><small>{view.query||t("common.all")} · {view.status==="all"?t("common.all"):t(`crm.status.${view.status}`)} · {view.pageSize} · {t(view.visibility==="TEAM"?"savedViews.team":"savedViews.personal")}</small></button>{view.owned&&<button className="icon-button" type="button" aria-label={t("modules.deleteSavedView",{name:view.name})} onClick={()=>setDeleteConfirmation(view)}><Trash2 size={16}/></button>}</article>)}{!savedViews.length&&<p className="select-empty">{t("modules.noSavedViews")}</p>}</div><button className="secondary-button" type="button" onClick={()=>{resetFilters();setSort("primary");setDirection("asc");setPageSize(10);setPage(1);onCloseSavedViews?.();}}>{t("modules.restoreDefaultView")}</button></AccessibleDrawer>}{deleteConfirmation&&<ConfirmDialog title={t("common.confirmAction")} description={t("savedViews.deleteConfirm",{name:deleteConfirmation.name})} confirmLabel={t("common.delete")} pending={deletePending} onClose={()=>setDeleteConfirmation(null)} onConfirm={()=>void deleteView(deleteConfirmation)}/>}</>;
}

function SortHead({ field, active, direction, onSort, children }: { field: SortKey; active: SortKey; direction: "asc" | "desc"; onSort: (field: SortKey) => void; children: React.ReactNode }) {
  const Icon = active === field ? direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th aria-sort={active === field ? direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="sort-head" onClick={() => onSort(field)}>{children}<Icon size={13} /></button></th>;
}

function DataTableRow({ row, labels, organization=false }: { organization?:boolean; row: DataRow; labels: Record<"primary" | "secondary" | "status" | "meta" | "extra" | "completeness", string> }) {
  const { locale,t,enumLabel } = useI18n();const status=enumLabel(row.statusKey ?? `crm.status.${row.status}`);const {formatDate}=useUserPreferences();const primary=row.bilingualName?`${row.primary} / ${row.primaryEn??""}`:locale==="en"&&row.primaryEn?row.primaryEn:row.primary;const secondary=locale==="en"&&row.secondaryEn?row.secondaryEn:row.secondary;const extra=row.extra==="—"?"—":formatDate(row.extra,{includeTime:true});
  const identity=<><span className="record-avatar">{primary.slice(0,1)}</span><span>{row.bilingualName||organization?<RecordIdentity nameZh={row.primary} nameEn={row.primaryEn}/>:<b>{primary}</b>}{row.classificationKey&&<small className="table-sub">{t(row.classificationKey)}</small>}</span></>;
  return <tr><td data-label={labels.primary}>{row.href?<Link className="record-link" href={row.href}>{identity}</Link>:<div className="record-link static">{identity}</div>}</td><td data-label={labels.secondary}><span className="table-main">{secondary}</span><small className="table-sub">{t("common.owner")} {row.owner}</small></td><td data-label={labels.status}><StatusBadge tone={!status.known?"gray":row.statusTone}>{status.label}</StatusBadge>{row.statusDetailKey&&<small className="table-sub">{t(row.statusDetailKey)}</small>}</td><td data-label={labels.meta}>{row.meta}</td><td data-label={labels.extra}>{extra}</td><td data-label={labels.completeness}><ProgressBar value={row.completeness} label={`${Math.round(row.completeness)}%`} /></td></tr>;
}

function OrganizationMobileRow({row,labels}:{row:DataRow;labels:Record<"primary"|"secondary"|"status"|"meta"|"extra"|"completeness",string>}) {
  const {locale,t,enumLabel}=useI18n();
  const {formatDate}=useUserPreferences();
  const status=enumLabel(row.statusKey??`crm.status.${row.status}`);
  const context=locale==="en"&&row.secondaryEn?row.secondaryEn:row.secondary;
  const identity=<RecordIdentity nameZh={row.primary} nameEn={row.primaryEn}/>;
  return <article className="ux-organization-row" data-record-id={row.id}>
    <div className="ux-organization-row-heading">{row.href?<Link className="record-link" href={row.href}>{identity}</Link>:identity}<StatusBadge tone={status.known?row.statusTone:"gray"}>{status.label}</StatusBadge></div>
    <p>{presentMissing(locale,context==="—"?null:context)}</p>
    <small>{t("common.owner")} · {presentMissing(locale,row.owner==="—"?null:row.owner)}</small>
    <details><summary>{t("ux.record.more")}</summary><dl><dt>{labels.meta}</dt><dd>{presentMissing(locale,row.meta==="—"?null:row.meta)}</dd><dt>{labels.extra}</dt><dd>{row.extra==="—"?presentMissing(locale,null):formatDate(row.extra,{includeTime:true})}</dd><dt>{labels.completeness}</dt><dd><ProgressBar value={row.completeness} label={`${Math.round(row.completeness)}%`}/></dd></dl></details>
  </article>;
}
