"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import type { DataRow, ModuleConfig } from "@/lib/crm-data";
import type { PersistentResource } from "@/lib/crm-repository";
import { InlineMessage, Pagination, ProgressBar, SearchField, StatusBadge } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";

type SortKey = "primary" | "secondary" | "status" | "meta" | "extra" | "completeness";

export function DataTable({ config, resource, initialTotal, refreshKey = 0 }: { config: ModuleConfig; resource?: PersistentResource; initialTotal?: number; refreshKey?: number }) {
  const { t } = useI18n();
  const router=useRouter();const pathname=usePathname();const searchParams=useSearchParams();
  const prefix = `modules.${config.key}`;
  const [query, setQuery] = useState(()=>searchParams.get("q")??"");
  const [page, setPage] = useState(()=>Math.max(1,Number(searchParams.get("page")??1)));
  const [rows, setRows] = useState(config.rows);
  const [total, setTotal] = useState(initialTotal ?? config.rows.length);
  const [status, setStatus] = useState(()=>searchParams.get("status")??"all");
  const [sort, setSort] = useState<SortKey>(()=>["primary","secondary","status","meta","extra","completeness"].includes(searchParams.get("sort")??"")?searchParams.get("sort") as SortKey:"primary");
  const [direction, setDirection] = useState<"asc" | "desc">(()=>searchParams.get("direction")==="desc"?"desc":"asc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const pageSize = 5;

  useEffect(() => {
    if (!resource) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize), status, sort, direction });
      try {
        const response = await fetch(`/api/crm/${resource}?${params}`, { signal: controller.signal });
        const result = await response.json() as { items?: DataRow[]; total?: number };
        if (!response.ok || !result.items) throw new Error();
        setRows(result.items);
        setTotal(result.total ?? result.items.length);
      } catch {
        if (!controller.signal.aborted) setError(t("modules.loadFailed"));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [direction, page, query, refreshKey, resource, retryKey, sort, status, t]);

  useEffect(()=>{if(!resource)return;const params=new URLSearchParams(searchParams.toString());if(query)params.set("q",query);else params.delete("q");if(page>1)params.set("page",String(page));else params.delete("page");if(status!=="all")params.set("status",status);else params.delete("status");if(sort!=="primary")params.set("sort",sort);else params.delete("sort");if(direction!=="asc")params.set("direction",direction);else params.delete("direction");const next=params.toString();if(next!==searchParams.toString())router.replace(next?`${pathname}?${next}`:pathname,{scroll:false});},[direction,page,pathname,query,resource,router,searchParams,sort,status]);

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
  const labels = {
    primary: t(`${prefix}.column.primary`),
    secondary: t(`${prefix}.column.secondary`),
    status: t("common.status"),
    meta: t(`${prefix}.column.meta`),
    extra: t(`${prefix}.column.extra`),
    completeness: t("modules.completeness"),
  };

  return <div className={`data-surface ${loading ? "is-loading" : ""}`} aria-busy={loading}>
    <div className="table-toolbar"><SearchField value={query} onChange={setSearch} placeholder={t(`${prefix}.search`)} /><div className="filter-chips"><button type="button" onClick={cycleStatus}>{t("common.status")} <span>{status === "all" ? t("common.all") : t(visible.find((row) => row.status === status)?.statusKey ?? status)}</span></button></div></div>
    {error && <div className="table-error"><InlineMessage type="error">{error}</InlineMessage><button className="secondary-button" type="button" onClick={() => setRetryKey((value) => value + 1)}>{t("common.retry")}</button></div>}
    <div className="table-scroll"><table className="data-table"><thead><tr>
      <SortHead field="primary" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.primary`)}</SortHead><SortHead field="secondary" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.secondary`)}</SortHead><SortHead field="status" active={sort} direction={direction} onSort={changeSort}>{t("common.status")}</SortHead><SortHead field="meta" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.meta`)}</SortHead><SortHead field="extra" active={sort} direction={direction} onSort={changeSort}>{t(`${prefix}.column.extra`)}</SortHead><SortHead field="completeness" active={sort} direction={direction} onSort={changeSort}>{t("modules.completeness")}</SortHead></tr></thead>
      <tbody>{visible.map((row) => <DataTableRow key={row.id} row={row} labels={labels} />)}</tbody></table>{!visible.length && !loading && !error && <div className="empty-state"><span>{t("modules.noRecords")}</span><p>{t("modules.noRecordsHelp")}</p></div>}</div>
    <Pagination page={safePage} totalPages={totalPages} total={effectiveTotal} pageSize={pageSize} onPage={setPage} />
  </div>;
}

function SortHead({ field, active, direction, onSort, children }: { field: SortKey; active: SortKey; direction: "asc" | "desc"; onSort: (field: SortKey) => void; children: React.ReactNode }) {
  const Icon = active === field ? direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th aria-sort={active === field ? direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="sort-head" onClick={() => onSort(field)}>{children}<Icon size={13} /></button></th>;
}

function DataTableRow({ row, labels }: { row: DataRow; labels: Record<"primary" | "secondary" | "status" | "meta" | "extra" | "completeness", string> }) {
  const { locale,t } = useI18n();const primary=row.bilingualName?`${row.primary} / ${row.primaryEn??""}`:locale==="en"&&row.primaryEn?row.primaryEn:row.primary;const secondary=locale==="en"&&row.secondaryEn?row.secondaryEn:row.secondary;
  const identity=<><span className="record-avatar">{primary.slice(0,1)}</span><span><b>{primary}</b></span></>;
  return <tr><td data-label={labels.primary}>{row.href?<Link className="record-link" href={row.href}>{identity}</Link>:<div className="record-link static">{identity}</div>}</td><td data-label={labels.secondary}><span className="table-main">{secondary}</span><small className="table-sub">{t("common.owner")} {row.owner}</small></td><td data-label={labels.status}><StatusBadge tone={row.statusTone}>{t(row.statusKey ?? row.status)}</StatusBadge></td><td data-label={labels.meta}>{row.meta}</td><td data-label={labels.extra}>{row.extra}</td><td data-label={labels.completeness}><ProgressBar value={row.completeness} label={`${Math.round(row.completeness)}%`} /></td></tr>;
}
