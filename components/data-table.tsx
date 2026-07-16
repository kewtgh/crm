"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import type { DataRow, ModuleConfig } from "@/lib/crm-data";
import { Pagination, ProgressBar, SearchField, StatusBadge } from "@/components/ui";

export function DataTable({ config }: { config: ModuleConfig }) {
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
        <SearchField value={query} onChange={setSearch} placeholder={config.searchPlaceholder} />
        <div className="filter-chips">
          <button type="button">状态 <span>全部</span></button>
          <button type="button">负责人 <span>我的团队</span></button>
          <button type="button">更多筛选 <b>+</b></button>
        </div>
      </div>
      {selected.length > 0 && <div className="bulk-bar"><span>已选择 {selected.length} 项</span><button type="button">分配负责人</button><button type="button">添加标签</button><button type="button">取消</button></div>}
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr>
            <th className="check-cell"><input type="checkbox" checked={visible.length > 0 && visible.every((row) => selected.includes(row.id))} onChange={togglePage} aria-label="选择本页" /></th>
            <SortHead>{config.primaryColumn}</SortHead><SortHead>{config.secondaryColumn}</SortHead><SortHead>状态</SortHead><SortHead>{config.metaColumn}</SortHead><SortHead>{config.extraColumn}</SortHead><SortHead>完整度</SortHead><th />
          </tr></thead>
          <tbody>
            {visible.map((row) => <DataTableRow key={row.id} row={row} checked={selected.includes(row.id)} onToggle={() => toggle(row.id)} />)}
          </tbody>
        </table>
        {!visible.length && <div className="empty-state"><span>没有找到匹配记录</span><p>尝试缩短关键词或清除筛选条件。</p></div>}
      </div>
      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} />
    </div>
  );
}
function SortHead({ children }: { children: React.ReactNode }) { return <th><button type="button" className="sort-head">{children}<ArrowUpDown size={13} /></button></th>; }

function DataTableRow({ row, checked, onToggle }: { row: DataRow; checked: boolean; onToggle: () => void }) {
  const [cn, ...rest] = row.secondary.split(" · ");
  return <tr>
    <td className="check-cell"><input type="checkbox" checked={checked} onChange={onToggle} aria-label={`选择 ${row.primary}`} /></td>
    <td><button className="record-link" type="button"><span className="record-avatar">{row.primary.slice(0, 1)}</span><span><b>{row.primary}</b><small>{cn}</small></span></button></td>
    <td><span className="table-main">{rest.join(" · ")}</span><small className="table-sub">负责人 {row.owner}</small></td>
    <td><StatusBadge tone={row.statusTone}>{row.status}</StatusBadge></td>
    <td>{row.meta}</td><td>{row.extra}</td><td><ProgressBar value={row.completeness} /></td>
    <td><button className="icon-button" type="button" aria-label="更多操作"><MoreHorizontal size={18} /></button></td>
  </tr>;
}
