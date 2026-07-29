"use client";

import { useI18n } from "@/components/i18n-provider";

export default function Loading(){
  const {t}=useI18n();
  return <div className="page-stack" aria-busy="true" aria-live="polite"><section className="page-loading-skeleton"><span/><span/><span/></section><section className="surface page-loading-panel"><span/><span/><span/><span/></section><span className="sr-only">{t("common.loading")}</span></div>;
}
