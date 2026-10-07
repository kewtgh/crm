import type { Locale } from "./i18n";
import type { Messages } from "./i18n/types";

const labels = {
  "zh-CN": { unknown: "未知状态", missing: "未记录", notSet: "未设置", restricted: "无权查看", unavailable: "暂不可用" },
  en: { unknown: "Unknown status", missing: "Not recorded", notSet: "Not set", restricted: "Restricted", unavailable: "Unavailable" },
};
export function localeIdentity(locale: Locale, nameZh?: string | null, nameEn?: string | null) {
  const zh = nameZh?.trim(), en = nameEn?.trim();
  const primary = (locale === "zh-CN" ? zh || en : en || zh) || labels[locale].missing;
  const alternate = locale === "zh-CN" ? en : zh;
  const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ");
  return { primary, alternate: alternate && normalized(alternate) !== normalized(primary) ? alternate : undefined };
}
export function presentMissing(locale: Locale, value: string | number | null | undefined, state: "missing" | "notSet" | "restricted" | "unavailable" = "missing") {
  if (state === "restricted" || state === "unavailable") return labels[locale][state];
  return value === null || value === undefined || value === "" ? labels[locale][state] : String(value);
}
export function presentEnum(locale: Locale, messages: Messages, key: string) {
  const label = messages[key];
  return { label: label || labels[locale].unknown, known: Boolean(label) };
}
export function safeTranslation(locale: Locale, messages: Messages, key: string, values?: Record<string, string | number>, onMissing?: () => void) {
  let template = messages[key];
  if (!template) { onMissing?.(); template = labels[locale].unavailable; }
  return values ? Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), template) : template;
}
