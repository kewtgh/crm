"use client";

import { useEffect, useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "./i18n-provider";

// Native disclosure keeps keyboard activation without pretending to be an ARIA menu.
export function ActionDisclosure({ children, label }: {children: React.ReactNode; label?: string}) {
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
  }}>
    <summary aria-label={label || t("ui.moreActions")} title={t("ui.moreActions")}><MoreHorizontal size={18}/></summary>
    <div className="action-disclosure-content" onClick={event => {
      if (event.target instanceof Element && event.target.closest("button:not(:disabled)") && ref.current) ref.current.open = false;
    }}>{children}</div>
  </details>;
}
