"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Search,
  X,
} from "lucide-react";
import { useI18n } from "./i18n-provider";

export function StatusBadge({ tone = "gray", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`status-badge ${tone}`}><i />{children}</span>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const normalized=Math.min(100,Math.max(0,value));
  return (
    <span className="progress-with-label" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(normalized)} aria-label={label??`${Math.round(normalized)}%`}>
      <span className="progress-track" aria-hidden="true"><span style={{ width: `${normalized}%` }} /></span>
      {label ?? `${value}%`}
    </span>
  );
}

export function SearchField({ value, onChange, placeholder, compact = false }: { value: string; onChange: (value: string) => void; placeholder: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <label className={`search-field ${compact ? "compact" : ""}`}>
      <Search size={17} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button type="button" onClick={() => onChange("")} aria-label={t("common.clearSearch")}><X size={15} /></button>}
    </label>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const { t } = useI18n();
  const pages = [...new Set([1,page-1,page,page+1,totalPages].filter(value=>value>=1&&value<=totalPages))].sort((a,b)=>a-b);
  return (
    <nav className="pagination" aria-label={t("common.pagination")}>
      <span>{t("common.paginationSummary",{total,pageSize})}</span>
      <div>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label={t("common.previousPage")}><ChevronLeft size={16} /></button>
        {pages.map((value, index) => (
          <span key={value} className="page-number-wrap">
            {index > 0 && pages[index - 1] !== value - 1 ? <i>…</i> : null}
            <button type="button" className={value === page ? "active" : ""} onClick={() => onPage(value)} aria-current={value === page ? "page" : undefined}>{value}</button>
          </span>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label={t("common.nextPage")}><ChevronRight size={16} /></button>
      </div>
    </nav>
  );
}

export type SelectOption = { value: string; label: string; detail?: string };

export function SearchableSelect({ label, options, value, onChange, placeholder, onSearch, loading = false }: { label: string; options: SelectOption[]; value?: string; onChange: (value: string) => void; placeholder?: string; onSearch?: (query: string) => void; loading?: boolean }) {
  const { t } = useI18n();
  const resolvedPlaceholder = placeholder ?? t("common.select");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(search.toLowerCase())), [options, search]);
  const choose = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setSearch("");
    triggerRef.current?.focus();
  };
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => ref.current?.querySelector<HTMLInputElement>(".search-field input")?.focus());
  }, [open]);
  useEffect(() => {
    if (!open || !onSearch) return;
    const timer = window.setTimeout(() => onSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [onSearch, open, search]);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!filtered.length) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + direction + filtered.length) % filtered.length);
      return;
    }
    if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex].value);
    }
  };
  return (
    <div className="select-field" ref={ref} onKeyDown={handleKeyDown}>
      <span className="select-label">{label}</span>
      <button ref={triggerRef} type="button" role="combobox" aria-label={label} aria-autocomplete="list" aria-activedescendant={open&&filtered[activeIndex]?`${listboxId}-${activeIndex}`:undefined} className="select-trigger" onClick={() => { if (!open) setActiveIndex(0); setOpen((current) => !current); }} aria-expanded={open} aria-haspopup="listbox" aria-controls={listboxId}>
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? resolvedPlaceholder}</span><ChevronDown size={17} />
      </button>
      {open && (
        <div className="select-popover">
          <SearchField value={search} onChange={(nextSearch) => { setSearch(nextSearch); setActiveIndex(0); }} placeholder={t("common.typeToSearch")} compact />
          <div className="select-options" id={listboxId} role="listbox" aria-label={label}>
            {filtered.map((option, index) => (
              <button id={`${listboxId}-${index}`} key={option.value} type="button" className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option.value)} role="option" aria-selected={option.value === value}>
                <span><b>{option.label}</b>{option.detail && <small>{option.detail}</small>}</span>
                {option.value === value ? <Check size={16} /> : null}
              </button>
            ))}
            {loading && <p className="select-empty" role="status">{t("common.loading")}</p>}
            {!loading && !filtered.length && <p className="select-empty">{t("common.noOptions")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function InlineMessage({ type, children }: { type: "error" | "success" | "warning" | "info"; children: React.ReactNode }) {
  return <div className={`inline-message ${type}`} role={type === "error" ? "alert" : "status"}>{type === "error" || type === "warning" ? <CircleAlert size={17} /> : <Check size={17} />}<span>{children}</span></div>;
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 3200); return () => window.clearTimeout(timer); }, [onClose]);
  const { t } = useI18n();
  return <div className="toast" role="status"><span className="toast-check"><Check size={15} /></span><span>{message}</span><button type="button" aria-label={t("common.close")} onClick={onClose}><X size={15} /></button></div>;
}
