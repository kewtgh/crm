"use client";

import { useEffect, useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "./i18n-provider";

// Native disclosure keeps keyboard activation without pretending to be an ARIA menu.
export function ActionDisclosure({ children, label, menu = false }: {children: React.ReactNode; label?: string; menu?: boolean}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <details ref={ref} className="action-disclosure" onKeyDown={event => {
    if (event.key === "Escape" && ref.current?.open) {
      event.stopPropagation(); ref.current.open = false; ref.current.querySelector("summary")?.focus();
    }
    if (menu && ["ArrowDown","ArrowUp","Home","End"].includes(event.key) && ref.current) {
      event.preventDefault(); ref.current.open = true;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index <= 0 ? items.length : index) - 1;
      items[next]?.focus();
    }
  }}>
    <summary aria-haspopup={menu ? "menu" : undefined} aria-label={label || t("ui.moreActions")} title={t("ui.moreActions")}><MoreHorizontal size={18}/></summary>
    <div className="action-disclosure-content" role={menu ? "menu" : undefined} aria-label={menu ? label || t("ui.moreActions") : undefined} onClick={event => {
      if (event.target instanceof Element && event.target.closest("button:not(:disabled)") && ref.current) { ref.current.open = false; if(menu) ref.current.querySelector("summary")?.focus(); }
    }}>{children}</div>
  </details>;
}
