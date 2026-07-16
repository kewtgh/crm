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

export function StatusBadge({ tone = "gray", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`status-badge ${tone}`}><i />{children}</span>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <span className="progress-with-label">
      <span className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></span>
      {label ?? `${value}%`}
    </span>
  );
}

export function SearchField({ value, onChange, placeholder, compact = false }: { value: string; onChange: (value: string) => void; placeholder: string; compact?: boolean }) {
  return (
    <label className={`search-field ${compact ? "compact" : ""}`}>
      <Search size={17} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button type="button" onClick={() => onChange("")} aria-label="清除搜索"><X size={15} /></button>}
    </label>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (value) => value === 1 || value === totalPages || Math.abs(value - page) <= 1,
  );
  return (
    <nav className="pagination" aria-label="分页">
      <span>共 {total} 条 · 每页 {pageSize} 条</span>
      <div>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="上一页"><ChevronLeft size={16} /></button>
        {pages.map((value, index) => (
          <span key={value} className="page-number-wrap">
            {index > 0 && pages[index - 1] !== value - 1 ? <i>…</i> : null}
            <button type="button" className={value === page ? "active" : ""} onClick={() => onPage(value)} aria-current={value === page ? "page" : undefined}>{value}</button>
          </span>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="下一页"><ChevronRight size={16} /></button>
      </div>
    </nav>
  );
}

export type SelectOption = { value: string; label: string; detail?: string };

export function SearchableSelect({ label, options, value, onChange, placeholder = "请选择…" }: { label: string; options: SelectOption[]; value?: string; onChange: (value: string) => void; placeholder?: string }) {
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
      <button ref={triggerRef} type="button" className="select-trigger" onClick={() => { if (!open) setActiveIndex(0); setOpen((current) => !current); }} aria-expanded={open} aria-haspopup="listbox" aria-controls={listboxId}>
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder}</span><ChevronDown size={17} />
      </button>
      {open && (
        <div className="select-popover">
          <SearchField value={search} onChange={(nextSearch) => { setSearch(nextSearch); setActiveIndex(0); }} placeholder="输入关键词搜索…" compact />
          <div className="select-options" id={listboxId} role="listbox" aria-label={label}>
            {filtered.map((option, index) => (
              <button key={option.value} type="button" className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option.value)} role="option" aria-selected={option.value === value}>
                <span><b>{option.label}</b>{option.detail && <small>{option.detail}</small>}</span>
                {option.value === value ? <Check size={16} /> : null}
              </button>
            ))}
            {!filtered.length && <p className="select-empty">没有匹配选项</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function InlineMessage({ type, children }: { type: "error" | "success" | "warning"; children: React.ReactNode }) {
  return <div className={`inline-message ${type}`} role={type === "error" ? "alert" : "status"}>{type === "error" || type === "warning" ? <CircleAlert size={17} /> : <Check size={17} />}<span>{children}</span></div>;
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 3200); return () => window.clearTimeout(timer); }, [onClose]);
  return <div className="toast" role="status"><span className="toast-check"><Check size={15} /></span><span>{message}</span><button type="button" onClick={onClose}><X size={15} /></button></div>;
}
