import type { Metadata } from "next";
import { cookies } from "next/headers";
import { isLocale, translate, type Locale } from "./i18n";

export async function getRequestLocale(): Promise<Locale> {
  const locale = (await cookies()).get("lumina-locale")?.value;
  return isLocale(locale) ? locale : "zh-CN";
}

export async function localizedPageMetadata(titleKey: string,descriptionKey=`${titleKey}.description`): Promise<Metadata> {
  const locale = await getRequestLocale();
  const translatedDescription=translate(locale,descriptionKey);
  return {
    title: translate(locale, titleKey),
    description:translatedDescription===descriptionKey?translate(locale,"meta.description"):translatedDescription,
  };
}
