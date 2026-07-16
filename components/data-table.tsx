"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import type { DataRow, ModuleConfig } from "@/lib/crm-data";
import { Pagination, ProgressBar, SearchField, StatusBadge } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";

export function DataTable({ config }: { config: ModuleConfig }) {
  const { t } = useI18n();
  const prefix = `modules.${config.key}`;
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const pageSize = 5;
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search ? config.rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(search)) : config.rows;
  }, [config.rows, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const setSearch = (value: string) => { setQuery(value); setPage(1); };
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const togglePage = () => {
    const ids = visible.map((row) => row.id);
    const allSelected = ids.every((id) => selected.includes(id));
    setSelected((current) => allSelected ? current.filter((id) => !ids.includes(id)) : Array.from(new Set([...current, ...ids])));
  };
  return (
    <div className="data-surface">
      <div className="table-toolbar">
        <SearchField value={query} onChange={setSearch} placeholder={t(`${prefix}.search`)} />
        <div className="filter-chips">
          <button type="button">{t("common.status")} <span>{t("common.all")}</span></button>
          <button type="button">{t("common.owner")} <span>{t("modules.myTeam")}</span></button>
          <button type="button">{t("modules.moreFilters")} <b>+</b></button>
        </div>
      </div>
      {selected.length > 0 && <div className="bulk-bar"><span>{t("modules.selected",{count:selected.length})}</span><button type="button">{t("modules.assignOwner")}</button><button type="button">{t("modules.addTag")}</button><button type="button">{t("common.cancel")}</button></div>}
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr>
            <th className="check-cell"><input type="checkbox" checked={visible.length > 0 && visible.every((row) => selected.includes(row.id))} onChange={togglePage} aria-label={t("common.selectPage")} /></th>
            <SortHead>{t(`${prefix}.column.primary`)}</SortHead><SortHead>{t(`${prefix}.column.secondary`)}</SortHead><SortHead>{t("common.status")}</SortHead><SortHead>{t(`${prefix}.column.meta`)}</SortHead><SortHead>{t(`${prefix}.column.extra`)}</SortHead><SortHead>{t("modules.completeness")}</SortHead><th />
          </tr></thead>
          <tbody>
            {visible.map((row) => <DataTableRow key={row.id} row={row} checked={selected.includes(row.id)} onToggle={() => toggle(row.id)} />)}
          </tbody>
        </table>
        {!visible.length && <div className="empty-state"><span>{t("modules.noRecords")}</span><p>{t("modules.noRecordsHelp")}</p></div>}
      </div>
      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} />
    </div>
  );
}
function SortHead({ children }: { children: React.ReactNode }) { return <th><button type="button" className="sort-head">{children}<ArrowUpDown size={13} /></button></th>; }

function DataTableRow({ row, checked, onToggle }: { row: DataRow; checked: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const [cn, ...rest] = row.secondary.split(" · ");
  return <tr>
    <td className="check-cell"><input type="checkbox" checked={checked} onChange={onToggle} aria-label={t("common.selectRecord",{name:row.primary})} /></td>
    <td><button className="record-link" type="button"><span className="record-avatar">{row.primary.slice(0, 1)}</span><span><b>{row.primary}</b><small>{cn}</small></span></button></td>
    <td><span className="table-main">{rest.join(" · ")}</span><small className="table-sub">{t("common.owner")} {row.owner}</small></td>
    <td><StatusBadge tone={row.statusTone}>{row.status}</StatusBadge></td>
    <td>{row.meta}</td><td>{row.extra}</td><td><ProgressBar value={row.completeness} /></td>
    <td><button className="icon-button" type="button" aria-label={t("common.moreActions")}><MoreHorizontal size={18} /></button></td>
  </tr>;
}
