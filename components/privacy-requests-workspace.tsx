"use client";

import { useCallback, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useCapability } from "./app-user-context";
import { useI18n } from "./i18n-provider";
import { AccessibleDrawer, InlineMessage, Pagination, SearchableSelect, StatusBadge, Toast } from "./ui";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import type { PageResult, PrivacyRequestRecord } from "@/lib/v200-repository";

const statusTone = (status: string) => status === "FULFILLED" ? "green" : status === "REJECTED" || status.includes("FAILED") ? "red" : "amber";

export function PrivacyRequestsWorkspace({ initial }: { initial: PageResult<PrivacyRequestRecord> }) {
  const { locale, t } = useI18n();
  const canManage = useCapability("privacyRequests.manage");
  const [data, setData] = useState(initial);
  const [contact, setContact] = useState("");
  const [requestType,setRequestType]=useState("ACCESS");
  const [contactOptions, setContactOptions] = useState<Array<{ value: string; label: string; detail?: string }>>([]);
  const [reviewing, setReviewing] = useState<PrivacyRequestRecord | null>(null);
  const [nextStatus, setNextStatus] = useState("");
  const [identityStatus, setIdentityStatus] = useState("PENDING");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [pending, setPending] = useState(false);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const reload = async (page = data.page, pageSize = data.pageSize) => {
    setData(await apiFetch<PageResult<PrivacyRequestRecord>>(`/api/privacy-requests?page=${page}&pageSize=${pageSize}`));
  };
  const searchContacts = useCallback(async (query: string) => {
    if (query.trim().length < 2) return;
    const result = await apiFetch<{ items: Array<{ value: string; labelZh: string; labelEn: string; type: string }> }>(`/api/search/related?q=${encodeURIComponent(query)}`).catch(() => ({ items: [] }));
    setContactOptions(result.items.filter((item) => item.type === "CONTACT").map((item) => ({
      value: item.value.split(":")[1] ?? "",
      label: locale === "zh-CN" ? item.labelZh : item.labelEn,
      detail: t("nav.people"),
    })));
  }, [locale, t]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setError("");
    if (!contact) { setError(t("privacyRequests.contactRequired")); return; }
    setPending(true);
    try {
      const changes=requestType==="CORRECTION"?Object.fromEntries(["nameZh","nameEn","email","phone","title"].map(key=>[key,String(form.get(key)??"").trim()]).filter(([,value])=>value)):undefined;
      if(requestType==="CORRECTION"&&!Object.keys(changes??{}).length){setError(t("privacyRequests.correctionRequired"));setPending(false);return;}
      await apiFetch("/api/privacy-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "create", type: requestType, note: form.get("note"), contactId: contact,changes }) });
      event.currentTarget.reset(); setContact("");setRequestType("ACCESS"); await reload(1); setToast(t("privacyRequests.created"));
    } catch (caught) { setError(presentApiError(caught, t, "privacyRequests.failed").message); } finally { setPending(false); }
  };
  const availableStatuses = (item: PrivacyRequestRecord) => {
    if (item.status === "RECEIVED") return ["IDENTITY_REVIEW", "CANCELLED"];
    if (item.status === "IDENTITY_REVIEW") return ["IN_PROGRESS", "REJECTED", "CANCELLED"];
    if (item.status === "IN_PROGRESS") return item.type === "EXPORT" || item.type === "DELETION"
      ? ["WAITING_APPROVAL", "REJECTED", "CANCELLED"] : ["FULFILLED", "REJECTED", "CANCELLED"];
    if (item.status === "WAITING_APPROVAL") return ["FULFILLED", "REJECTED"];
    if (item.status === "EXECUTION_FAILED") return ["IN_PROGRESS", "REJECTED", "CANCELLED"];
    return [];
  };
  const openReview = (item: PrivacyRequestRecord) => {
    const statuses = availableStatuses(item);
    setReviewing(item);
    setNextStatus(statuses[0] ?? "");
    setIdentityStatus(item.status === "IDENTITY_REVIEW" ? "VERIFIED" : item.identityStatus);
    setError("");
  };
  const manage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewing || !nextStatus) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      await apiFetch("/api/privacy-requests", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "manage", id: reviewing.id, status: nextStatus, identityStatus, decision: form.get("decision") }),
      });
      setReviewing(null); await reload(); setToast(t("privacyRequests.updated"));
    } catch (caught) { setError(presentApiError(caught, t, "privacyRequests.manageFailed").message); } finally { setPending(false); }
  };
  return <div className="page-stack v200-workspace">
    <section className="page-heading-row"><div><p className="eyebrow">{t("privacyRequests.eyebrow")}</p><h1>{t("privacyRequests.title")}</h1><p>{t("privacyRequests.help")}</p></div></section>
    <InlineMessage type="info">{t("privacyRequests.identityHelp")}</InlineMessage>
    <form className="surface v200-action-form" onSubmit={submit}>
      <SearchableSelect label={t("privacyRequests.contact")} value={contact} options={contactOptions} onChange={setContact} onSearch={searchContacts}/>
      <label className="field"><span>{t("privacyRequests.type")}</span><select name="type" value={requestType} onChange={(event)=>setRequestType(event.target.value)}>{["ACCESS","EXPORT","CORRECTION","RESTRICTION","DELETION"].map((type) => <option value={type} key={type}>{t(`privacyRequests.type.${type.toLowerCase()}`)}</option>)}</select></label>
      {requestType==="CORRECTION"&&<fieldset className="form-grid two-column"><legend>{t("privacyRequests.correctionFields")}</legend><label className="field"><span>{t("education.nameZh")}</span><input name="nameZh" maxLength={160}/></label><label className="field"><span>{t("education.nameEn")}</span><input name="nameEn" maxLength={160}/></label><label className="field"><span>{t("modules.email")}</span><input name="email" type="email" maxLength={320}/></label><label className="field"><span>{t("modules.phone")}</span><input name="phone" maxLength={80}/></label><label className="field"><span>{t("modules.title")}</span><input name="title" maxLength={160}/></label></fieldset>}
      <label className="field"><span>{t("privacyRequests.note")}</span><textarea name="note" minLength={10} rows={4} required/></label>
      {error && !reviewing && <InlineMessage type="error">{error}</InlineMessage>}
      <button className="primary-button" disabled={pending}><ShieldCheck size={16}/>{pending ? t("common.processing") : t("privacyRequests.submit")}</button>
    </form>
    <section className="surface"><div className="v200-list">{data.items.map((item) => <article key={item.id}>
      <span className="product-icon"><ShieldCheck size={18}/></span>
      <div><b>{t(`privacyRequests.type.${item.type.toLowerCase()}`)}</b><small>{item.note} · {t("privacyRequests.identity", { status: t(`privacyRequests.identity.${item.identityStatus.toLowerCase()}`) })} · {t("privacyRequests.due", { date: item.dueAt.slice(0, 10) })}</small>{item.executionStatus&&<small>{t("privacyRequests.execution",{status:item.executionStatus})}{item.receiptSha256?` · ${t("privacyRequests.receipt",{hash:item.receiptSha256.slice(0,12)})}`:""}{item.artifactExpiresAt?` · ${t("privacyRequests.expires",{date:item.artifactExpiresAt.slice(0,10)})}`:""}</small>}{item.executionFailure&&<small className="danger-text">{item.executionFailure}</small>}</div>
      <StatusBadge tone={statusTone(item.status)}>{t(`privacyRequests.status.${item.status.toLowerCase()}`)}</StatusBadge>
      {canManage && availableStatuses(item).length > 0 && <button className="secondary-button" onClick={() => openReview(item)}>{t("privacyRequests.review")}</button>}
    </article>)}</div>
      {!data.items.length && <div className="empty-state"><span>{t("privacyRequests.empty")}</span></div>}
      <Pagination page={data.page} totalPages={pages} total={data.total} pageSize={data.pageSize} onPage={(page) => void reload(page)} onPageSize={(pageSize) => void reload(1, pageSize)}/>
    </section>
    {reviewing && <AccessibleDrawer title={t("privacyRequests.reviewTitle")} description={t("privacyRequests.reviewHelp")} onClose={() => setReviewing(null)}>
      <form onSubmit={manage}>
        <label className="field"><span>{t("privacyRequests.nextStatus")}</span><select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>{availableStatuses(reviewing).map((status) => <option key={status} value={status}>{t(`privacyRequests.status.${status.toLowerCase()}`)}</option>)}</select></label>
        <label className="field"><span>{t("privacyRequests.identityStatus")}</span><select value={identityStatus} onChange={(event) => setIdentityStatus(event.target.value)}>{["PENDING","VERIFIED","FAILED"].map((status) => <option key={status} value={status}>{t(`privacyRequests.identity.${status.toLowerCase()}`)}</option>)}</select></label>
        <label className="field"><span>{t("privacyRequests.decision")}</span><textarea name="decision" rows={4} minLength={3} maxLength={2000} required/></label>
        {(reviewing.type === "EXPORT" || reviewing.type === "DELETION") && <InlineMessage type="warning">{t("privacyRequests.dualReview")}</InlineMessage>}
        {error && <InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setReviewing(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending ? t("common.processing") : t("common.confirm")}</button></div>
      </form>
    </AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}

