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

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  const { t } = useI18n();
  const pages = [...new Set([1,page-1,page,page+1,totalPages].filter(value=>value>=1&&value<=totalPages))].sort((a,b)=>a-b);
  return (
    <nav className="pagination" aria-label={t("common.pagination")}>
      <div className="pagination-summary">
        <span>{t("common.paginationSummary",{total,pageSize})}</span>
        <label>
          <span>{t("common.pageSize")}</span>
          <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
            {PAGE_SIZE_OPTIONS.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="pagination-pages">
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
  const searchRef=useRef<HTMLInputElement>(null);
  const optionRefs=useRef<Array<HTMLButtonElement|null>>([]);
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
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);
  useEffect(()=>{
    if(!open||!filtered[activeIndex])return;
    optionRefs.current[activeIndex]?.scrollIntoView({block:"nearest"});
  },[activeIndex,filtered,open]);
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
    if((event.key==="Home"||event.key==="End")&&open&&filtered.length){
      event.preventDefault();setActiveIndex(event.key==="Home"?0:filtered.length-1);return;
    }
    if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex].value);
    }
  };
  return (
    <div className="select-field" ref={ref} onKeyDown={handleKeyDown} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setOpen(false);setSearch("");}}}>
      <span className="select-label">{label}</span>
      <button ref={triggerRef} type="button" aria-label={label} className="select-trigger" onClick={() => { if (!open) setActiveIndex(0); setOpen((current) => !current); }} aria-expanded={open} aria-haspopup="listbox" aria-controls={listboxId}>
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? resolvedPlaceholder}</span><ChevronDown size={17} />
      </button>
      {open && (
        <div className="select-popover">
          <label className="search-field compact">
            <Search size={17}/>
            <input ref={searchRef} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded="true" aria-controls={listboxId} aria-activedescendant={filtered[activeIndex]?`${listboxId}-${activeIndex}`:undefined} value={search} onChange={event=>{setSearch(event.target.value);setActiveIndex(0);}} placeholder={t("common.typeToSearch")}/>
            {search&&<button type="button" onClick={()=>{setSearch("");setActiveIndex(0);}} aria-label={t("common.clearSearch")}><X size={15}/></button>}
          </label>
          <div className="select-options" id={listboxId} role="listbox" aria-label={label}>
            {filtered.map((option, index) => (
              <button ref={element=>{optionRefs.current[index]=element;}} id={`${listboxId}-${index}`} key={option.value} type="button" tabIndex={-1} className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option.value)} role="option" aria-selected={option.value === value}>
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

export function AccessibleDrawer({
  title,
  eyebrow,
  description,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const preferred = drawerRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      );
      (preferred ?? closeRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        closeRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, []);
  return <>
    <button className="drawer-overlay" type="button" aria-label={t("common.close")} onClick={onClose}/>
    <aside
      ref={drawerRef}
      className="record-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div className="drawer-heading">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button ref={closeRef} className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}><X size={20}/></button>
      </div>
      {children}
    </aside>
  </>;
}
