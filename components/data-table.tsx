"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import type { DataRow, ModuleConfig } from "@/lib/crm-data";
import type { CrmMetrics, PersistentResource } from "@/lib/crm-repository";
import { AccessibleDrawer, InlineMessage, Pagination, ProgressBar, SearchField, StatusBadge } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";

type SortKey = "primary" | "secondary" | "status" | "meta" | "extra" | "completeness";
type SavedView={id:string;name:string;query:string;status:string;sort:SortKey;direction:"asc"|"desc";pageSize:number};
const validPage=(value:string|null)=>{const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>0?parsed:1;};
const validPageSize=(value:string|null)=>[10,25,50].includes(Number(value))?Number(value):10;

export function DataTable({ config, resource, initialTotal, refreshKey = 0, onMetrics, savedViewsOpen=false, onCloseSavedViews }: { config: ModuleConfig; resource?: PersistentResource; initialTotal?: number; refreshKey?: number; onMetrics?:(metrics:CrmMetrics)=>void;savedViewsOpen?:boolean;onCloseSavedViews?:()=>void }) {
  const { t } = useI18n();
  const router=useRouter();const pathname=usePathname();const searchParams=useSearchParams();
  const prefix = `modules.${config.key}`;
  const [query, setQuery] = useState(()=>searchParams.get("q")??"");
  const [page, setPage] = useState(()=>validPage(searchParams.get("page")));
  const [rows, setRows] = useState(config.rows);
  const [total, setTotal] = useState(initialTotal ?? config.rows.length);
  const [status, setStatus] = useState(()=>searchParams.get("status")??"all");
  const [sort, setSort] = useState<SortKey>(()=>["primary","secondary","status","meta","extra","completeness"].includes(searchParams.get("sort")??"")?searchParams.get("sort") as SortKey:"primary");
  const [direction, setDirection] = useState<"asc" | "desc">(()=>searchParams.get("direction")==="desc"?"desc":"asc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [pageSize,setPageSize]=useState(()=>validPageSize(searchParams.get("pageSize")));
  const [savedViews,setSavedViews]=useState<SavedView[]>([]);
  const storageKey=`lumina-saved-views:${resource??config.key}`;

  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      try{const parsed=JSON.parse(window.localStorage.getItem(storageKey)??"[]") as SavedView[];setSavedViews(Array.isArray(parsed)?parsed.filter(item=>item&&typeof item.name==="string"):[]);}
      catch{setSavedViews([]);}
    },0);
    return()=>window.clearTimeout(timer);
  },[storageKey]);
  const persistViews=(views:SavedView[])=>{setSavedViews(views);window.localStorage.setItem(storageKey,JSON.stringify(views));};

  useEffect(() => {
    if (!resource) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize), status, sort, direction });
      try {
        const result = await apiFetch<{items:DataRow[];total:number;metrics:CrmMetrics}>(`/api/crm/${resource}?${params}`, { signal: controller.signal });
        const totalPages=Math.max(1,Math.ceil(result.total/pageSize));
        if(page>totalPages){setPage(totalPages);return;}
        setRows(result.items);
        setTotal(result.total);
        onMetrics?.(result.metrics);
      } catch(caught) {
        if (!controller.signal.aborted) {
          const requestId=caught instanceof ApiClientError?caught.requestId:undefined;
          setError(`${t("modules.loadFailed")}${requestId?` · ${t("common.requestId")}: ${requestId}`:""}`);
        }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [direction, onMetrics, page, pageSize, query, refreshKey, resource, retryKey, sort, status, t]);

  useEffect(()=>{if(!resource)return;const params=new URLSearchParams(searchParams.toString());if(query)params.set("q",query);else params.delete("q");if(page>1)params.set("page",String(page));else params.delete("page");if(pageSize!==10)params.set("pageSize",String(pageSize));else params.delete("pageSize");if(status!=="all")params.set("status",status);else params.delete("status");if(sort!=="primary")params.set("sort",sort);else params.delete("sort");if(direction!=="asc")params.set("direction",direction);else params.delete("direction");const next=params.toString();if(next!==searchParams.toString())router.replace(next?`${pathname}?${next}`:pathname,{scroll:false});},[direction,page,pageSize,pathname,query,resource,router,searchParams,sort,status]);

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
  const cycleStatus = () => { const values = ["all", ...statusOptions]; setStatus(values[(values.indexOf(status) + 1) % values.length]); setPage(1); };
  const changeSort = (key: SortKey) => { if (sort === key) setDirection((value) => value === "asc" ? "desc" : "asc"); else { setSort(key); setDirection("asc"); } setPage(1); };
  const setSearch = (value: string) => { setQuery(value); setPage(1); };
  const applyView=(view:SavedView)=>{setQuery(view.query);setStatus(view.status);setSort(view.sort);setDirection(view.direction);setPageSize(validPageSize(String(view.pageSize)));setPage(1);onCloseSavedViews?.();};
  const saveView=(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const name=String(new FormData(event.currentTarget).get("name")??"").trim();if(!name)return;persistViews([...savedViews.filter(item=>item.name!==name),{id:crypto.randomUUID(),name,query,status,sort,direction,pageSize}]);event.currentTarget.reset();};
  const labels = {
    primary: t(`${prefix}.column.primary`),
    secondary: t(`${prefix}.column.secondary`),
    status: t("common.status"),
    meta: t(`${prefix}.column.meta`),
    extra: t(`${prefix}.column.extra`),
    completeness: t("modules.completeness"),
  };

  return <><div className={`data-surface ${loading ? "is-loading" : ""}`} aria-busy={loading}>
    <div className="table-toolbar"><SearchField value={query} onChange={setSearch} placeholder={t(`${prefix}.search`)} /><div className="filter-chips"><button type="button" onClick={cycleStatus}>{t("common.status")} <span>{status === "all" ? t("common.all") : t(visible.find((row) => row.status === status)?.statusKey ?? status)}</span></button><label className="page-size-select"><span>{t("modules.pageSize")}</span><select value={pageSize} onChange={(event)=>{setPageSize(Number(event.target.value));setPage(1);}}>{[10,25,50].map(value=><option value={value} key={value}>{value}</option>)}</select></label></div></div>
    {error && <div className="table-error"><InlineMessage type="error">{error}</InlineMessage><button className="secondary-button" type="button" onClick={() => setRetryKey((value) => value + 1)}>{t("common.retry")}</button></div>}
    <div className="table-scroll"><table className="data-table"><thead><tr>
      <SortHead field="primary" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.primary`)}</SortHead><SortHead field="secondary" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.secondary`)}</SortHead><SortHead field="status" active={sort} direction={direction} onSort={changeSort}>{t("common.status")}</SortHead><SortHead field="meta" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.meta`)}</SortHead><SortHead field="extra" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.extra`)}</SortHead><SortHead field="completeness" active={sort} direction={direction} onSort={changeSort}>{t("modules.completeness")}</SortHead></tr></thead>
      <tbody>{visible.map((row) => <DataTableRow key={row.id} row={row} labels={labels} />)}</tbody></table>{!visible.length && !loading && !error && <div className="empty-state"><span>{t("modules.noRecords")}</span><p>{t("modules.noRecordsHelp")}</p></div>}</div>
    <Pagination page={safePage} totalPages={totalPages} total={effectiveTotal} pageSize={pageSize} onPage={setPage} />
  </div>{savedViewsOpen&&<AccessibleDrawer title={t("modules.savedViews")} eyebrow={t("modules.savedViewsEyebrow")} description={t("modules.savedViewsHelp")} onClose={()=>onCloseSavedViews?.()}><form className="saved-view-form" onSubmit={saveView}><label className="field"><span>{t("modules.savedViewName")}</span><input name="name" required maxLength={60}/></label><button className="primary-button" type="submit"><Save size={16}/>{t("modules.saveCurrentView")}</button></form><div className="saved-view-list">{savedViews.map(view=><article key={view.id}><button type="button" className="saved-view-main" onClick={()=>applyView(view)}><b>{view.name}</b><small>{view.query||t("common.all")} · {view.status==="all"?t("common.all"):view.status} · {view.pageSize}</small></button><button className="icon-button" type="button" aria-label={t("modules.deleteSavedView",{name:view.name})} onClick={()=>persistViews(savedViews.filter(item=>item.id!==view.id))}><Trash2 size={16}/></button></article>)}{!savedViews.length&&<p className="select-empty">{t("modules.noSavedViews")}</p>}</div><button className="secondary-button" type="button" onClick={()=>{setQuery("");setStatus("all");setSort("primary");setDirection("asc");setPageSize(10);setPage(1);onCloseSavedViews?.();}}>{t("modules.restoreDefaultView")}</button></AccessibleDrawer>}</>;
}

function SortHead({ field, active, direction, onSort, children }: { field: SortKey; active: SortKey; direction: "asc" | "desc"; onSort: (field: SortKey) => void; children: React.ReactNode }) {
  const Icon = active === field ? direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th aria-sort={active === field ? direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="sort-head" onClick={() => onSort(field)}>{children}<Icon size={13} /></button></th>;
}

function DataTableRow({ row, labels }: { row: DataRow; labels: Record<"primary" | "secondary" | "status" | "meta" | "extra" | "completeness", string> }) {
  const { locale,t } = useI18n();const {formatDate}=useUserPreferences();const primary=row.bilingualName?`${row.primary} / ${row.primaryEn??""}`:locale==="en"&&row.primaryEn?row.primaryEn:row.primary;const secondary=locale==="en"&&row.secondaryEn?row.secondaryEn:row.secondary;const extra=row.extra==="—"?"—":formatDate(row.extra,{includeTime:true});
  const identity=<><span className="record-avatar">{primary.slice(0,1)}</span><span><b>{primary}</b></span></>;
  return <tr><td data-label={labels.primary}>{row.href?<Link className="record-link" href={row.href}>{identity}</Link>:<div className="record-link static">{identity}</div>}</td><td data-label={labels.secondary}><span className="table-main">{secondary}</span><small className="table-sub">{t("common.owner")} {row.owner}</small></td><td data-label={labels.status}><StatusBadge tone={row.statusTone}>{t(row.statusKey ?? row.status)}</StatusBadge></td><td data-label={labels.meta}>{row.meta}</td><td data-label={labels.extra}>{extra}</td><td data-label={labels.completeness}><ProgressBar value={row.completeness} label={`${Math.round(row.completeness)}%`} /></td></tr>;
}
