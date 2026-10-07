import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";
import type { Locale, Messages } from "./types";
import { safeTranslation } from "../ux-presentation";

export const dictionaries: Record<Locale, Messages> = { "zh-CN": zhCN, en };

export function translate(locale: Locale, key: string, values?: Record<string, string | number>) {
  return safeTranslation(locale, dictionaries[locale], key, values);
}

export type { Locale } from "./types";
export { isLocale, supportedLocales } from "./types";
