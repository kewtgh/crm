"use client";

import { useId } from "react";
import { useI18n } from "./i18n-provider";

export function DetailTabs({ items, active, onChange, children, label, disabled=false, hideNavigation=false }: {
  items: Array<{key: string; label: string}>; active: string;
  onChange: (key: string) => void; children: React.ReactNode; label: string; disabled?:boolean; hideNavigation?:boolean;
}) {
  const id = useId();
  const { t } = useI18n();
  if (hideNavigation) return <>{children}</>;
  return <>
    <div className="page-tabs detail-tabs" role="tablist" aria-label={label}>
      {items.map((item, index) => <button key={item.key} type="button" role="tab" disabled={disabled}
        id={`${id}-${item.key}`} aria-selected={active === item.key} tabIndex={active === item.key ? 0 : -1}
        aria-controls={`${id}-panel`} onClick={() => onChange(item.key)}
        onKeyDown={event => {
          const next = event.key === "ArrowRight" ? (index + 1) % items.length
            : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
            : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
          if (next < 0 || disabled) return;
          event.preventDefault(); onChange(items[next].key);
          const target=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
          target?.focus(); target?.scrollIntoView({block:"nearest",inline:"nearest"});
        }}>{t(item.label)}</button>)}
    </div>
    <div id={`${id}-panel`} className="detail-tab-panel" role="tabpanel" tabIndex={0} aria-labelledby={`${id}-${active}`}>{children}</div>
  </>;
}
