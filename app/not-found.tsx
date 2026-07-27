"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";

export default function NotFound(){
  const {t}=useI18n();
  return <main className="boundary-page"><section className="surface data-state"><div><h1>{t("notFound.title")}</h1><p>{t("notFound.description")}</p></div><Link className="primary-button" href="/dashboard">{t("notFound.back")}</Link></section></main>;
}
