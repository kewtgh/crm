"use client";
import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
export default function TermsPage(){const{t}=useI18n();return <main className="legal-page"><Link href="/register">← {t("auth.goRegister")}</Link><h1>{t("legal.terms")}</h1><p>{t("legal.termsBody")}</p><h2>{t("legal.accountResponsibility")}</h2><p>{t("legal.accountBody")}</p></main>}
