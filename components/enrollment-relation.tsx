"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import { useI18n } from "./i18n-provider";
import { SearchableSelect, InlineMessage } from "./ui";

export type EnrollmentRelationType = "PRODUCT" | "STUDENT" | "COHORT" | "HOUSEHOLD" | "USER" | "OPPORTUNITY" | "ORGANIZATION" | "CONTACT" | "EVENT" | "CAMPAIGN" | "REFERRAL";
export function EnrollmentRelation({type, label, value, initialLabel, required = false, disabled = false, onChange, onSelection,organizationId}: {
  organizationId?:string;type: EnrollmentRelationType; label: string; value: string; initialLabel?: string; required?: boolean; disabled?: boolean; onChange: (value: string) => void; onSelection?: (value: string, label: string) => void;
}) {
  const {t, locale} = useI18n(), latest = useRemoteSearch();
  const [options, setOptions] = useState<Array<{value: string; label: string}>>([]), [error, setError] = useState("");
  const [pending,setPending]=useState(false),[selection,setSelection]=useState<{value:string;label:string}|null>(null);
  const search = async (q: string) => {
    setPending(true);setError("");setOptions([]);
    const scoped = ["COHORT", "EVENT", "CAMPAIGN", "REFERRAL"].includes(type);
    const url = scoped ? `/api/enrollments?resource=options&type=${type}&q=${encodeURIComponent(q)}` : `/api/search/related?types=${type}${organizationId?`&organizationId=${encodeURIComponent(organizationId)}`:""}&q=${encodeURIComponent(q)}`;
    const outcome = await latest(signal => apiFetch<{items: Array<{value: string; labelZh: string; labelEn: string}>}>(url, {signal}));
    if (!outcome.current) return;
    setPending(false);
    if ("error" in outcome) {setError(t("modules.relatedSearchFailed")); return;}
    setOptions(outcome.value.items.filter(item=>scoped||item.value.startsWith(`${type}:`)).map(item => ({value: scoped ? item.value : item.value.split(":")[1], label: locale === "en" ? item.labelEn : item.labelZh}))); setError("");
  };
  const selected = value && !options.some(item => item.value === value) ? [{value, label: initialLabel || (selection?.value===value?selection.label:t("flow.selectedRecord"))}] : [];
  const select = (next: string) => {const label=options.find(item=>item.value===next)?.label??selected.find(item=>item.value===next)?.label??"";setSelection(next?{value:next,label}:null);onChange(next);onSelection?.(next,label);};
  return <fieldset className="follow-up-fields" disabled={disabled}><SearchableSelect label={label} required={required} value={value} options={[...selected, ...options]} loading={pending} onSearch={search} onChange={select}/>{!required && value && <button className="text-button" type="button" onClick={() => select("")}>{t("business.clear")}</button>}{error && <InlineMessage type="error">{error}</InlineMessage>}</fieldset>;
}
