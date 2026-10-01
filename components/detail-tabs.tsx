"use client";

import { useId } from "react";
import { useI18n } from "./i18n-provider";

export function DetailTabs({ items, active, onChange, children, label }: {
  items: Array<{key: string; label: string}>; active: string;
  onChange: (key: string) => void; children: React.ReactNode; label: string;
}) {
  const id = useId();
  const { t } = useI18n();
  return <>
    <div className="page-tabs detail-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => <button key={item.key} type="button" role="tab"
        id={`${id}-${item.key}`} aria-selected={active === item.key} tabIndex={active === item.key ? 0 : -1}
        aria-controls={`${id}-panel`} onClick={() => onChange(item.key)}
        onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % items.length
            : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
            : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); onChange(items[next].key);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{t(item.label)}</button>)}
    </div>
    <div id={`${id}-panel`} className="detail-tab-panel" role="tabpanel" tabIndex={0} aria-labelledby={`${id}-${active}`}>{children}</div>
  </>;
}
