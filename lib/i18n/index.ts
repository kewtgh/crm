import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";
import type { Locale, Messages } from "./types";

export const dictionaries: Record<Locale, Messages> = { "zh-CN": zhCN, en };

export function translate(locale: Locale, key: string, values?: Record<string, string | number>) {
  const template = dictionaries[locale][key] ?? dictionaries["zh-CN"][key] ?? key;
  if (!values) return template;
  return Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), template);
}

export type { Locale } from "./types";
export { isLocale, supportedLocales } from "./types";
