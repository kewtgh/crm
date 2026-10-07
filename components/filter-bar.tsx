"use client";
import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { AccessibleDrawer } from "./ui";
import { SearchFilterBar } from "./search-filter-bar";
import { useI18n } from "./i18n-provider";

/** Values are presentation drafts; the owner performs queries, paging and persistence. */
export function FilterBar<Values extends object>({ search, onSearchChange, onSearch, placeholder, primaryFilters, summary, applied, defaults, onApply, onOpen, advancedCount, renderAdvanced, pending = false, onReset, activeCount }: {
  search?: string; onSearchChange?: (value: string) => void; onSearch?: () => void; placeholder?: string; primaryFilters?: ReactNode; summary?: ReactNode;
  applied: Values; defaults: Values; onApply: (value: Values) => boolean | void; onOpen?: () => void; advancedCount: number;
  renderAdvanced?: (draft: Values, change: (value: Values) => void) => ReactNode;
  pending?: boolean; onReset: () => void; activeCount: number;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(applied);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const actions = <div className="ux-filter-actions">{renderAdvanced && <button className="secondary-button" type="button" disabled={pending} onClick={() => { onOpen?.(); setDraft({ ...applied }); setOpen(true); }}><SlidersHorizontal size={16}/>{t("ux.filters.more", { count: advancedCount })}</button>}{activeCount > 0 && <button className="secondary-button" type="button" disabled={pending} onClick={onReset}>{t("ux.filters.resetApplied")}</button>}</div>;
  return <div className="ux-filter-bar">
    {onSearchChange ? <SearchFilterBar value={search ?? ""} onChange={onSearchChange} onSearch={onSearch} placeholder={placeholder ?? ""} pending={pending}><div className="ux-primary-filters">{primaryFilters}</div>{actions}</SearchFilterBar> : <div className="ux-scope-bar">{summary}{actions}</div>}
    {open && renderAdvanced && <AccessibleDrawer title={t("ux.filters.title")} description={t("ux.filters.draftHelp")} onClose={close} pending={pending}>
      <form className="ux-filter-form" onSubmit={event => { event.preventDefault(); if (!pending && onApply({ ...draft }) !== false) close(); }}>
        {renderAdvanced(draft, setDraft)}
        <div className="ux-filter-footer"><button className="secondary-button" type="button" disabled={pending} onClick={() => setDraft({ ...defaults })}>{t("ux.filters.resetDraft")}</button><button className="secondary-button" type="button" disabled={pending} onClick={close}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={pending}>{t("ux.filters.apply")}</button></div>
      </form>
    </AccessibleDrawer>}
  </div>;
}
