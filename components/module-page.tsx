"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Download, Plus, ScanSearch, SlidersHorizontal } from "lucide-react";
import type { ModuleConfig } from "@/lib/crm-data";
import type { CrmMetrics, PersistentResource } from "@/lib/crm-repository";
import { DataTable } from "@/components/data-table";
import { AccessibleDrawer, InlineMessage, SearchableSelect, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";
import { useRemoteSearch } from "@/hooks/use-remote-search";

type Duplicate = { nameZh: string; nameEn: string; reason: string };
type RelatedResult = { value: string; labelZh: string; labelEn: string; type: "ORGANIZATION" | "CONTACT" | "USER" | "OPPORTUNITY" | "TASK" | "CONTRACT" | "QUOTE" | "PRODUCT" };

export function ModulePage({
  config,
  resource,
  initialTotal,
  initialMetrics,
  workspacePanel,
}: {
  config: ModuleConfig;
  resource?: PersistentResource;
  initialTotal?: number;
  initialMetrics?: CrmMetrics;
  workspacePanel?:React.ReactNode;
}) {
  const { locale, t } = useI18n();
  const searchParams=useSearchParams();
  const { localDateTimeToIso } = useUserPreferences();
  const prefix = `modules.${config.key}`;
  const [drawer, setDrawer] = useState(false);
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const [duplicateChecked, setDuplicateChecked] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [metrics, setMetrics] = useState<CrmMetrics>(initialMetrics ?? {
    total: initialTotal ?? config.rows.length,
    needsAttention: 0,
    averageCompleteness: 0,
  });
  const [organization, setOrganization] = useState("");
  const [related, setRelated] = useState("");
  const [relatedLabel, setRelatedLabel] = useState("");
  const [owner, setOwner] = useState("");
  const [organizationOptions, setOrganizationOptions] = useState<Array<{ value: string; label: string; detail?: string }>>([]);
  const [relatedOptions, setRelatedOptions] = useState<Array<{ value: string; label: string; detail?: string }>>([]);
  const [ownerOptions, setOwnerOptions] = useState<Array<{ value: string; label: string; detail?: string }>>([]);
  const [exportOpen,setExportOpen]=useState(false);
  const [exportPending,setExportPending]=useState(false);
  const runRelatedSearch=useRemoteSearch();

  const invalidateDuplicateCheck = () => {
    if (duplicateChecked || duplicates.length) {
      setDuplicateChecked(false);
      setDuplicates([]);
    }
  };
  const close = () => {
    setDrawer(false);
    setDuplicateChecked(false);
    setDuplicates([]);
    setError("");
    setOrganization("");
    setRelated("");
    setRelatedLabel("");
    setOwner("");
  };
  const payload = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const common = {
      nameZh: String(data.get("nameZh") ?? "").trim(),
      nameEn: String(data.get("nameEn") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      contact: String(data.get("contact") ?? "").trim(),
    };
    if (resource === "schools") return {
      ...common,
      city: String(data.get("city") ?? "").trim(),
      curriculum: String(data.get("curriculum") ?? "").trim(),
    };
    if (resource === "people") return {
      ...common,
      title: String(data.get("title") ?? "").trim(),
      organizationId: organization,
    };
    if (resource === "tasks") {
      const [relatedType = "", relatedId = ""] = related.split(":");
      const localDueAt = String(data.get("dueAt") ?? "");
      return {
        ...common,
        contact: relatedLabel,
        dueAt: localDueAt ? localDateTimeToIso(localDueAt) : "",
        priority: String(data.get("priority") ?? "NORMAL"),
        relatedType,
        relatedId,
        ownerId: owner || undefined,
      };
    }
    return common;
  };
  const describeError = useCallback((caught: unknown, fallbackKey: string) => {
    const requestId = caught instanceof ApiClientError ? caught.requestId : undefined;
    return `${t(fallbackKey)}${requestId ? ` · ${t("common.requestId")}: ${requestId}` : ""}`;
  }, [t]);
  const validateSpecializedFields = (values: ReturnType<typeof payload>) => {
    if (resource === "people" && !organization) return t("modules.organizationRequired");
    if (resource === "people" && !values.email && !values.phone) return t("modules.contactMethodRequired");
    if (resource === "tasks" && !related) return t("modules.relatedRequired");
    return "";
  };
  const searchRelated = useCallback(async (
    query: string,
    target: "organization" | "related" | "owner",
  ) => {
    const result=await runRelatedSearch(signal=>apiFetch<{ items: RelatedResult[] }>(`/api/search/related?q=${encodeURIComponent(query)}`,{signal}));
    if(!result.current)return;
    if("error" in result){
      setError(describeError(result.error, "modules.relatedSearchFailed"));
      return;
    }
    const toOption = (item: RelatedResult) => ({
      value: target === "related" ? item.value : item.value.split(":")[1],
      label: locale === "zh-CN" ? item.labelZh : item.labelEn,
      detail: t(`search.type.${item.type.toLowerCase()}`),
    });
    if (target === "organization") setOrganizationOptions(result.value.items.filter((item) => item.type === "ORGANIZATION").map(toOption));
    if (target === "related") setRelatedOptions(result.value.items.filter((item) => item.type === "ORGANIZATION"||item.type==="CONTACT").map(toOption));
    if (target === "owner") setOwnerOptions(result.value.items.filter((item) => item.type === "USER").map(toOption));
  }, [describeError, locale, runRelatedSearch, t]);
  const check = async (form: HTMLFormElement) => {
    if (!resource) return;
    const values = payload(form);
    const validationError = validateSpecializedFields(values);
    if (validationError) {
      setError(validationError);
      return;
    }
    setChecking(true);
    setError("");
    try {
      const result = await apiFetch<{ duplicates: Duplicate[] }>(`/api/crm/${resource}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, operation: "check" }),
      });
      setDuplicates(result.duplicates);
      setDuplicateChecked(true);
    } catch (caught) {
      setError(describeError(caught, "records.error.check"));
    } finally {
      setChecking(false);
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resource || !duplicateChecked) return;
    const values = payload(event.currentTarget);
    const validationError = validateSpecializedFields(values);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setSaving(true);
    try {
      await apiFetch(`/api/crm/${resource}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, operation: "create" }),
      });
      close();
      setRefreshKey((value) => value + 1);
      setToast(t("records.created"));
    } catch (caught) {
      const key = caught instanceof ApiClientError && caught.code === "DUPLICATE_FOUND"
        ? "records.error.duplicate"
        : "records.error.save";
      setError(describeError(caught, key));
    } finally {
      setSaving(false);
    }
  };
  const requestExport=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!resource)return;
    const formData=new FormData(event.currentTarget);
    const reason=String(formData.get("reason")??"").trim();
    const format=String(formData.get("format")??"CSV");
    setExportPending(true);setError("");
    try{
      await apiFetch("/api/approvals",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        type:"CRM_EXPORT",resource,query:searchParams.get("q")??"",status:searchParams.get("status")??"all",
        sort:searchParams.get("sort")??"primary",direction:searchParams.get("direction")==="desc"?"desc":"asc",format,reason,
      })});
      setExportOpen(false);setToast(t("export.submitted"));
    }catch(caught){setError(describeError(caught,"export.failed"));}
    finally{setExportPending(false);}
  };

  return <div className="page-stack module-page">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t(`${prefix}.eyebrow`)}</p><h1>{t(`${prefix}.title`)}</h1><p>{t(`${prefix}.description`)}</p></div>
      <div className="page-actions">
        <button className="secondary-button" type="button" disabled={!resource} onClick={()=>setExportOpen(true)}><Download size={16}/>{t("export.request")}</button>
        <button className="primary-button" type="button" onClick={() => setDrawer(true)} disabled={!resource}><Plus size={17}/>{t(`${prefix}.add`)}</button>
      </div>
    </section>
    <section className="quick-summary">
      <span><b>{metrics.total}</b><small>{t("modules.allRecords")}</small></span>
      <span><b>{metrics.needsAttention}</b><small>{t("modules.needsAttention")}</small></span>
      <span><b>{metrics.averageCompleteness}%</b><small>{t("modules.averageCompleteness")}</small></span>
      <button type="button" onClick={() => setSavedViewsOpen(true)}><SlidersHorizontal size={16}/>{t("modules.savedViews")}</button>
    </section>
    {workspacePanel}
    <DataTable
      config={config}
      resource={resource}
      initialTotal={initialTotal}
      refreshKey={refreshKey}
      onMetrics={setMetrics}
      savedViewsOpen={savedViewsOpen}
      onCloseSavedViews={() => setSavedViewsOpen(false)}
    />
    {drawer && <AccessibleDrawer
      title={t("modules.createRecord", { record: t(`${prefix}.singular`) })}
      eyebrow={t("eyebrow.createRecord")}
      description={t("modules.createHelp")}
      onClose={close}
    >
      <form onSubmit={submit} onChange={invalidateDuplicateCheck}>
        <div className="form-grid two-column">
          <label className="field"><span>{t("products.nameZh")} *</span><input name="nameZh" required maxLength={120}/></label>
          <label className="field"><span>{t("products.nameEn")} *</span><input name="nameEn" required maxLength={160}/></label>
        </div>
        {resource === "schools" && <>
          <div className="form-grid two-column">
            <label className="field"><span>{t("modules.city")} *</span><input name="city" required maxLength={80}/></label>
            <label className="field"><span>{t("modules.curriculum")} *</span><input name="curriculum" required maxLength={120}/></label>
          </div>
          <label className="field"><span>{t("modules.contact")}</span><input name="contact" maxLength={200}/></label>
        </>}
        {resource === "people" && <>
          <SearchableSelect label={`${t("modules.organization")} *`} options={organizationOptions} value={organization} onChange={(value) => { setOrganization(value); invalidateDuplicateCheck(); }} onSearch={(query) => searchRelated(query, "organization")}/>
          <label className="field"><span>{t("modules.title")} *</span><input name="title" required maxLength={120}/></label>
          <div className="form-grid two-column">
            <label className="field"><span>{t("modules.email")}</span><input name="email" type="email"/></label>
            <label className="field"><span>{t("modules.phone")}</span><input name="phone" maxLength={40}/></label>
          </div>
          <InlineMessage type="info">{t("modules.contactMethodRequired")}</InlineMessage>
        </>}
        {resource === "tasks" && <>
          <SearchableSelect label={`${t("modules.relatedRecord")} *`} options={relatedOptions} value={related} onChange={(value) => { setRelated(value); setRelatedLabel(relatedOptions.find((item) => item.value === value)?.label ?? ""); invalidateDuplicateCheck(); }} onSearch={(query) => searchRelated(query, "related")}/>
          <SearchableSelect label={t("modules.owner")} options={ownerOptions} value={owner} onChange={(value) => { setOwner(value); invalidateDuplicateCheck(); }} onSearch={(query) => searchRelated(query, "owner")}/>
          <div className="form-grid two-column">
            <label className="field"><span>{t("modules.dueAt")} *</span><input name="dueAt" type="datetime-local" required/></label>
            <label className="field"><span>{t("modules.priority")} *</span><select name="priority" defaultValue="NORMAL"><option value="LOW">{t("modules.priority.low")}</option><option value="NORMAL">{t("modules.priority.normal")}</option><option value="HIGH">{t("modules.priority.high")}</option><option value="URGENT">{t("modules.priority.urgent")}</option></select></label>
          </div>
        </>}
        <div className="duplicate-check">
          <div><span><ScanSearch size={18}/></span><div><b>{t("modules.duplicateTitle")}</b><p>{t("modules.duplicateHelp")}</p></div></div>
          {duplicateChecked
            ? <InlineMessage type={duplicates.length ? "warning" : "success"}>{duplicates.length ? t("records.duplicateCount", { count: duplicates.length }) : t("modules.duplicateClear")}</InlineMessage>
            : <button className="secondary-button" type="button" disabled={checking} onClick={(event) => check(event.currentTarget.form!)}><ScanSearch size={16}/>{checking ? t("records.checking") : t("modules.checkNow")}</button>}
        </div>
        {duplicates.length > 0 && <div className="duplicate-results">{duplicates.map((item) => <p key={`${item.nameZh}-${item.nameEn}`}><b>{resource === "people" ? `${item.nameZh} / ${item.nameEn}` : locale === "zh-CN" ? item.nameZh : item.nameEn}</b><small>{item.reason}</small></p>)}</div>}
        {!duplicateChecked && <InlineMessage type="warning">{t("modules.checkRequired")}</InlineMessage>}
        {error && <InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions">
          <button className="secondary-button" type="button" onClick={close}>{t("common.cancel")}</button>
          <button className="primary-button" type="submit" disabled={!duplicateChecked || duplicates.length > 0 || saving}><CheckCircle2 size={17}/>{saving ? t("common.saving") : t("modules.createRecord", { record: t(`${prefix}.singular`) })}</button>
        </div>
      </form>
    </AccessibleDrawer>}
    {exportOpen&&resource&&<AccessibleDrawer title={t("export.requestTitle")} eyebrow={t("exports.eyebrow")} description={t("export.requestHelp")} onClose={()=>setExportOpen(false)}>
      <form onSubmit={requestExport}>
        <InlineMessage type="info">{t("export.requestHelp")}</InlineMessage>
        <label className="field"><span>{t("export.format")}</span><select name="format" defaultValue="CSV"><option value="CSV">CSV</option><option value="XLSX">XLSX</option><option value="PDF">PDF</option></select><small>{t("export.formatHelp")}</small></label>
        <label className="field"><span>{t("export.reason")} *</span><textarea name="reason" rows={4} minLength={3} maxLength={1000} placeholder={t("export.reasonPlaceholder")} required/></label>
        {error&&<InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setExportOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={exportPending}><Download size={16}/>{exportPending?t("common.processing"):t("export.request")}</button></div>
      </form>
    </AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}
