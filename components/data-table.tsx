"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import type { DataRow, ModuleConfig } from "@/lib/crm-data";
import type { CrmMetrics, PersistentResource } from "@/lib/crm-repository";
import { AccessibleDrawer, InlineMessage, Pagination, ProgressBar, SearchField, StatusBadge } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import { apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";
import { savedViewSchema, viewConfigSchema, type SavedView } from "@/lib/saved-view-schema";
import { usePagedResource } from "@/hooks/use-paged-resource";

type SortKey = "primary" | "secondary" | "status" | "meta" | "extra" | "completeness";
const validPageSize=(value:string|null)=>[10,20,50].includes(Number(value))?Number(value):10;

export function DataTable({ config, resource, initialTotal, refreshKey = 0, onMetrics, savedViewsOpen=false, onCloseSavedViews }: { config: ModuleConfig; resource?: PersistentResource; initialTotal?: number; refreshKey?: number; onMetrics?:(metrics:CrmMetrics)=>void;savedViewsOpen?:boolean;onCloseSavedViews?:()=>void }) {
  const { t } = useI18n();
  const prefix = `modules.${config.key}`;
  const {
    query,setQuery,page,setPage,pageSize,setPageSize,status,setStatus,sort,setSort,
    direction,setDirection,items:rows,total,loading,error,retry,
  }=usePagedResource<DataRow,CrmMetrics>({
    endpoint:resource?`/api/crm/${resource}`:"",
    enabled:Boolean(resource),
    initialItems:config.rows,
    initialTotal:initialTotal??config.rows.length,
    refreshKey,
    onMetrics,
    errorMessage:t("modules.loadFailed"),
    requestIdLabel:t("common.requestId"),
  });
  const [savedViews,setSavedViews]=useState<SavedView[]>([]);
  const [savedViewError,setSavedViewError]=useState("");
  const storageKey=`lumina-saved-views:${resource??config.key}`;

  useEffect(()=>{
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
        void apiFetch<{items:SavedView[]}>(`/api/views?resource=${resource}`).then(result=>setSavedViews(current=>[...current.filter(item=>item.source==="LOCAL"),...result.items])).catch(()=>setSavedViewError(t("savedViews.loadFailed")));
      }
    },0);
    return()=>window.clearTimeout(timer);
  },[resource,storageKey,t]);
  const persistViews=(views:SavedView[])=>{setSavedViews(views);window.localStorage.setItem(storageKey,JSON.stringify(views.filter(item=>item.source==="LOCAL")));};

  const localRows = useMemo(() => {
    if (resource) return rows;
    const search = query.trim().toLowerCase();
    const filtered = config.rows.filter((row) => (!search || Object.values(row).join(" ").toLowerCase().includes(search)) && (status === "all" || row.status === status));
    return [...filtered].sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (direction === "asc" ? 1 : -1));
  }, [config.rows, direction, query, resource, rows, sort, status]);
  const effectiveTotal = resource ? total : localRows.length;
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = resource ? rows : localRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const statusOptions = useMemo(() => resource==="schools"?["HEALTHY","ATTENTION","DEVELOPING","RISK","UNVERIFIED"]:resource==="people"?["ACTIVE","FOLLOW_UP","VERIFIED","PROTECTED","UNVERIFIED"]:resource==="tasks"?["TODO","IN_PROGRESS","WAITING_APPROVAL","DONE","OVERDUE"]:Array.from(new Set(config.rows.map(row=>row.status))), [config.rows,resource]);
  const changeSort = (key: SortKey) => { if (sort === key) setDirection((value) => value === "asc" ? "desc" : "asc"); else { setSort(key); setDirection("asc"); } setPage(1); };
  const setSearch = (value: string) => { setQuery(value); setPage(1); };
  const applyView=(view:SavedView)=>{setQuery(view.query);setStatus(view.status);setSort(view.sort);setDirection(view.direction);setPageSize(validPageSize(String(view.pageSize)));setPage(1);onCloseSavedViews?.();};
  const saveView=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget);const name=String(form.get("name")??"").trim();const visibility=String(form.get("visibility")??"PERSONAL") as "PERSONAL"|"TEAM";if(!name)return;const config={version:1 as const,query,status,sort,direction,pageSize:pageSize as 10|20|50};setSavedViewError("");if(visibility==="TEAM"&&resource){try{await apiFetch("/api/views",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"save",resource,name,visibility,config})});const result=await apiFetch<{items:SavedView[]}>(`/api/views?resource=${resource}`);setSavedViews(current=>[...current.filter(item=>item.source==="LOCAL"),...result.items]);}catch{setSavedViewError(t("savedViews.saveFailed"));return;}}else{persistViews([...savedViews.filter(item=>item.source!=="LOCAL"||item.name!==name),{...config,id:crypto.randomUUID(),name,visibility:"PERSONAL",source:"LOCAL",owned:true}]);}event.currentTarget.reset();};
  const deleteView=async(view:SavedView)=>{setSavedViewError("");if(view.source==="SERVER"){if(!view.owned)return;try{await apiFetch("/api/views",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"delete",id:view.id})});setSavedViews(current=>current.filter(item=>item.id!==view.id));}catch{setSavedViewError(t("savedViews.saveFailed"));}}else persistViews(savedViews.filter(item=>item.id!==view.id));};
  const labels = {
    primary: t(`${prefix}.column.primary`),
    secondary: t(`${prefix}.column.secondary`),
    status: t("common.status"),
    meta: t(`${prefix}.column.meta`),
    extra: t(`${prefix}.column.extra`),
    completeness: t("modules.completeness"),
  };

  return <><div className={`data-surface ${loading ? "is-loading" : ""}`} aria-busy={loading}>
    <div className="table-toolbar"><SearchField value={query} onChange={setSearch} placeholder={t(`${prefix}.search`)} /><div className="filter-chips"><label className="compact-select"><span>{t("common.status")}</span><select value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">{t("common.all")}</option>{statusOptions.map(value=><option value={value} key={value}>{t(`crm.status.${value}`)}</option>)}</select></label></div></div>
    {error && <div className="table-error"><InlineMessage type="error">{error}</InlineMessage><button className="secondary-button" type="button" onClick={retry}>{t("common.retry")}</button></div>}
    <div className="table-scroll"><table className="data-table"><thead><tr>
      <SortHead field="primary" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.primary`)}</SortHead><SortHead field="secondary" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.secondary`)}</SortHead><SortHead field="status" active={sort} direction={direction} onSort={changeSort}>{t("common.status")}</SortHead><SortHead field="meta" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.meta`)}</SortHead><SortHead field="extra" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.extra`)}</SortHead><SortHead field="completeness" active={sort} direction={direction} onSort={changeSort}>{t("modules.completeness")}</SortHead></tr></thead>
      <tbody>{visible.map((row) => <DataTableRow key={row.id} row={row} labels={labels} />)}</tbody></table>{!visible.length && !loading && !error && <div className="empty-state"><span>{t("modules.noRecords")}</span><p>{t("modules.noRecordsHelp")}</p></div>}</div>
    <Pagination page={safePage} totalPages={totalPages} total={effectiveTotal} pageSize={pageSize} onPage={setPage} onPageSize={(value)=>{setPageSize(value);setPage(1);}} />
  </div>{savedViewsOpen&&<AccessibleDrawer title={t("modules.savedViews")} eyebrow={t("modules.savedViewsEyebrow")} description={t("modules.savedViewsHelp")} onClose={()=>onCloseSavedViews?.()}><form className="saved-view-form" onSubmit={saveView}><label className="field"><span>{t("modules.savedViewName")}</span><input name="name" required maxLength={60}/></label><label className="field"><span>{t("savedViews.source")}</span><select name="visibility" defaultValue="PERSONAL"><option value="PERSONAL">{t("savedViews.personal")}</option>{resource&&<option value="TEAM">{t("savedViews.team")}</option>}</select></label><button className="primary-button" type="submit"><Save size={16}/>{t("modules.saveCurrentView")}</button></form>{savedViewError&&<InlineMessage type="error">{savedViewError}</InlineMessage>}<div className="saved-view-list">{savedViews.map(view=><article key={`${view.source}:${view.id}`}><button type="button" className="saved-view-main" onClick={()=>applyView(view)}><b>{view.name}</b><small>{view.query||t("common.all")} · {view.status==="all"?t("common.all"):t(`crm.status.${view.status}`)} · {view.pageSize} · {t(view.visibility==="TEAM"?"savedViews.team":"savedViews.personal")}</small></button>{view.owned&&<button className="icon-button" type="button" aria-label={t("modules.deleteSavedView",{name:view.name})} onClick={()=>void deleteView(view)}><Trash2 size={16}/></button>}</article>)}{!savedViews.length&&<p className="select-empty">{t("modules.noSavedViews")}</p>}</div><button className="secondary-button" type="button" onClick={()=>{setQuery("");setStatus("all");setSort("primary");setDirection("asc");setPageSize(10);setPage(1);onCloseSavedViews?.();}}>{t("modules.restoreDefaultView")}</button></AccessibleDrawer>}</>;
}

function SortHead({ field, active, direction, onSort, children }: { field: SortKey; active: SortKey; direction: "asc" | "desc"; onSort: (field: SortKey) => void; children: React.ReactNode }) {
  const Icon = active === field ? direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th aria-sort={active === field ? direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="sort-head" onClick={() => onSort(field)}>{children}<Icon size={13} /></button></th>;
}

function DataTableRow({ row, labels }: { row: DataRow; labels: Record<"primary" | "secondary" | "status" | "meta" | "extra" | "completeness", string> }) {
  const { locale,t } = useI18n();const {formatDate}=useUserPreferences();const primary=row.bilingualName?`${row.primary} / ${row.primaryEn??""}`:locale==="en"&&row.primaryEn?row.primaryEn:row.primary;const secondary=locale==="en"&&row.secondaryEn?row.secondaryEn:row.secondary;const extra=row.extra==="—"?"—":formatDate(row.extra,{includeTime:true});
  const identity=<><span className="record-avatar">{primary.slice(0,1)}</span><span><b>{primary}</b></span></>;
  return <tr><td data-label={labels.primary}>{row.href?<Link className="record-link" href={row.href}>{identity}</Link>:<div className="record-link static">{identity}</div>}</td><td data-label={labels.secondary}><span className="table-main">{secondary}</span><small className="table-sub">{t("common.owner")} {row.owner}</small></td><td data-label={labels.status}><StatusBadge tone={row.statusTone}>{t(row.statusKey ?? `crm.status.${row.status}`)}</StatusBadge></td><td data-label={labels.meta}>{row.meta}</td><td data-label={labels.extra}>{extra}</td><td data-label={labels.completeness}><ProgressBar value={row.completeness} label={`${Math.round(row.completeness)}%`} /></td></tr>;
}
