"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import { useI18n } from "./i18n-provider";
import { SearchableSelect, InlineMessage } from "./ui";

export type EnrollmentRelationType = "PRODUCT" | "STUDENT" | "COHORT" | "HOUSEHOLD" | "USER" | "OPPORTUNITY" | "ORGANIZATION" | "CONTACT" | "EVENT" | "CAMPAIGN" | "REFERRAL";
export function EnrollmentRelation({type, label, value, initialLabel, required = false, disabled = false, onChange}: {
  type: EnrollmentRelationType; label: string; value: string; initialLabel?: string; required?: boolean; disabled?: boolean; onChange: (value: string) => void;
}) {
  const {t, locale} = useI18n(), latest = useRemoteSearch();
  const [options, setOptions] = useState<Array<{value: string; label: string}>>([]), [error, setError] = useState("");
  const search = async (q: string) => {
    const scoped = ["COHORT", "EVENT", "CAMPAIGN", "REFERRAL"].includes(type);
    const url = scoped ? `/api/enrollments?resource=options&type=${type}&q=${encodeURIComponent(q)}` : `/api/search/related?types=${type}&q=${encodeURIComponent(q)}`;
    const outcome = await latest(signal => apiFetch<{items: Array<{value: string; labelZh: string; labelEn: string}>}>(url, {signal}));
    if (!outcome.current) return;
    if ("error" in outcome) {setError(t("modules.relatedSearchFailed")); return;}
    setOptions(outcome.value.items.map(item => ({value: scoped ? item.value : item.value.split(":")[1], label: locale === "en" ? item.labelEn : item.labelZh}))); setError("");
  };
  const selected = value && !options.some(item => item.value === value) ? [{value, label: initialLabel || t("flow.selectedRecord")}] : [];
  return <fieldset className="follow-up-fields" disabled={disabled}><SearchableSelect label={label} required={required} value={value} options={[...selected, ...options]} onSearch={search} onChange={onChange}/>{!required && value && <button className="text-button" type="button" onClick={() => onChange("")}>{t("business.clear")}</button>}{error && <InlineMessage type="error">{error}</InlineMessage>}</fieldset>;
}
