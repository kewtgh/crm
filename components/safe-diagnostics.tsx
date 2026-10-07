"use client";

import {useI18n} from "./i18n-provider";

// Diagnostics are supplied identifiers, never arbitrary server text or record payloads.
export function diagnosticToken(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value !== "string" || value.length > 100 || /^(undefined|null|NaN)$/i.test(value)) return null;
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) || /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value) || /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value) ? value : null;
}

export function SafeDiagnostics({items}: {items: Array<{label: string; value: unknown}>}) {
  const {t}=useI18n();
  const safe=items.flatMap(item=>{const value=diagnosticToken(item.value);return value===null?[]:[{label:item.label,value}];});
  if(!safe.length)return null;
  return <details className="ux-safe-diagnostics"><summary>{t("closure.diagnostics")}</summary><dl>{safe.map((item,index)=><div key={index}><dt>{item.label}</dt><dd><code>{item.value}</code></dd></div>)}</dl></details>;
}
