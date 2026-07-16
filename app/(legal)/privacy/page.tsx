"use client";
import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
export default function PrivacyPage(){const{t}=useI18n();return <main className="legal-page"><Link href="/register">← {t("auth.goRegister")}</Link><h1>{t("legal.privacy")}</h1><p>{t("legal.privacyBody")}</p><h2>{t("legal.yourChoices")}</h2><p>{t("legal.privacyChoices")}</p></main>}
