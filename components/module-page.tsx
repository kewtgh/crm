"use client";
import {WorkspaceHeading} from "./workspace-heading";

import { BilingualNameHint } from "@/components/structured-inputs";
import { OptionInput, TagsInput, YearInput, DateInput } from "@/components/structured-inputs";
import { CURRICULUM_OPTIONS, LANGUAGE_OPTIONS, SOURCE_OPTIONS } from "@/lib/structured-inputs";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Download, Plus, ScanSearch, SlidersHorizontal } from "lucide-react";
import type { ModuleConfig } from "@/lib/crm-data";
import type { CrmMetrics, PersistentResource } from "@/lib/crm-repository";
import { RecordHeader } from "./record-header";
import { DataTable } from "@/components/data-table";
import { AccessibleDrawer, InlineMessage, SearchableSelect, Toast } from "@/components/ui";
import { useI18n } from "@/components/i18n-provider";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { useUserPreferences } from "@/components/user-preferences-context";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import { TaskWorkspacePanel } from "@/components/task-workspace";
import { useAppUser } from "./app-user-context";
import type { TaskWorkspace } from "@/lib/task-workspace-repository";

type Duplicate = { nameZh: string; nameEn: string; reason: string };
type RelatedResult = { value: string; labelZh: string; labelEn: string; type: "ORGANIZATION" | "CONTACT" | "USER" | "OPPORTUNITY" | "TASK" | "CONTRACT" | "QUOTE" | "PRODUCT" };

export function ModulePage({
  config,
  resource,
  initialTotal,
  initialMetrics,
  taskWorkspace,
  organizationId, createOnly=false, onCreated,
}: {
  config: ModuleConfig;
  resource?: PersistentResource;
  initialTotal?: number;
  initialMetrics?: CrmMetrics;
  taskWorkspace?:TaskWorkspace;
  organizationId?:string; createOnly?:boolean; onCreated?:()=>void;
}) {
  const { locale, t } = useI18n();
  const user=useAppUser();
  const canAssignOwner=["SUPER_ADMIN","ADMIN","SALES_DIRECTOR"].includes(user.role);
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
  const [organization, setOrganization] = useState(organizationId??"");
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
    setOrganization(organizationId??"");
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
      shortName:String(data.get("shortName")??"").trim(),
      city: String(data.get("city") ?? "").trim(),
      curriculum: String(data.get("curriculum") ?? "").trim(),
      organizationType:String(data.get("organizationType")??"SCHOOL"),
      courseCategories:String(data.get("courseCategories")??"").split(/[,，]/).map(value=>value.trim()).filter(Boolean),
      affiliationType:String(data.get("affiliationType")??"INDEPENDENT"),parentOrganizationId:organization||null,
      organizationOverviewMarkdown:String(data.get("organizationOverviewMarkdown")??""),structureOverviewMarkdown:String(data.get("structureOverviewMarkdown")??""),
      website:String(data.get("website")??"").trim(),foundedYear:data.get("foundedYear")?Number(data.get("foundedYear")):null,
      studentCount:data.get("studentCount")?Number(data.get("studentCount")):null,facultyCount:data.get("facultyCount")?Number(data.get("facultyCount")):null,campusCount:data.get("campusCount")?Number(data.get("campusCount")):null,
    };
    if (resource === "people") return {
      ...common,
      title: String(data.get("title") ?? "").trim(),
      organizationId: organization||null,
      contactType:String(data.get("contactType")??"CONTACT"),
      contactStatus:String(data.get("contactStatus")??"NEW"),
      communicationLevel:Number(data.get("communicationLevel")??1),
      notesMarkdown:String(data.get("notesMarkdown")??""),
      preferredContactMethod:String(data.get("preferredContactMethod")??"EMAIL"),
      preferredLanguage:String(data.get("preferredLanguage")??"").trim(),
      acquisitionSource:String(data.get("acquisitionSource")??"").trim(),
      decisionRole:String(data.get("decisionRole")??"UNKNOWN"),
      tags:String(data.get("tags")??"").split(/[,，]/).map(value=>value.trim()).filter(Boolean),
      nextFollowUpAt:data.get("nextFollowUpAt")?localDateTimeToIso(String(data.get("nextFollowUpAt"))):null,
      ownerId:owner||undefined,
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
    return presentApiError(caught,t,fallbackKey).message;
  }, [t]);
  const validateSpecializedFields = (values: ReturnType<typeof payload>) => {
    if (resource === "people" && !values.email && !values.phone) return t("modules.contactMethodRequired");
    if (resource === "tasks" && !related) return t("modules.relatedRequired");
    return "";
  };
  const searchRelated = useCallback(async (
    query: string,
    target: "organization" | "related" | "owner",
  ) => {
    const types=target==="owner"?"USER":target==="organization"?"ORGANIZATION":"ORGANIZATION,CONTACT";
    const result=await runRelatedSearch(signal=>apiFetch<{ items: RelatedResult[] }>(`/api/search/related?types=${types}&q=${encodeURIComponent(query)}`,{signal}));
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
      onCreated?.();
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

  return <div data-inline-action={createOnly||undefined} className={`page-stack module-page ${resource==="schools"?"ux-organization-page":""}`}>
    {createOnly?<button type="button" className="secondary-button" onClick={()=>setDrawer(true)}><Plus size={16}/>{t(`${prefix}.add`)}</button>:<>
    {resource==="schools"?<RecordHeader nameZh={t(`${prefix}.title`)} context={<p>{t(`${prefix}.description`)}</p>}
      secondaryActions={<button className="secondary-button" type="button" onClick={()=>setExportOpen(true)}><Download size={16}/>{t("export.request")}</button>}
      primaryAction={<button className="primary-button" type="button" onClick={()=>setDrawer(true)}><Plus size={17}/>{t(`${prefix}.add`)}</button>}/>:<><section className="page-heading-row">
      <div><p className="eyebrow">{t(`${prefix}.eyebrow`)}</p><WorkspaceHeading>{t(`${prefix}.title`)}</WorkspaceHeading><p>{t(`${prefix}.description`)}</p></div>
      <div className="page-actions">
        <button className="secondary-button" type="button" disabled={!resource} onClick={()=>setExportOpen(true)}><Download size={16}/>{t("export.request")}</button>
        <button className="primary-button" type="button" onClick={() => setDrawer(true)} disabled={!resource}><Plus size={17}/>{t(`${prefix}.add`)}</button>
      </div>
    </section></>}
    <section className="quick-summary directory-summary">
      <span><b>{metrics.total}</b><small>{t("modules.allRecords")}</small></span>
      <span><b>{metrics.needsAttention}</b><small>{t("modules.needsAttention")}</small></span>
      <span><b>{metrics.averageCompleteness}%</b><small>{t("modules.averageCompleteness")}</small></span>
      <button type="button" onClick={() => setSavedViewsOpen(true)}><SlidersHorizontal size={16}/>{t("modules.savedViews")}</button>
    </section>
    {taskWorkspace&&<TaskWorkspacePanel initial={taskWorkspace} refreshKey={refreshKey} onMutated={()=>setRefreshKey(value=>value+1)}/>}
    <DataTable
      config={config}
      resource={resource}
      initialTotal={initialTotal}
      refreshKey={refreshKey}
      onMetrics={setMetrics}
      savedViewsOpen={savedViewsOpen}
      onCloseSavedViews={() => setSavedViewsOpen(false)}
    />
    </>}
    {drawer && <AccessibleDrawer
      guardChanges pending={saving}
      title={t("modules.createRecord", { record: t(`${prefix}.singular`) })}
      eyebrow={t("eyebrow.createRecord")}
      description={t("modules.createHelp")}
      onClose={close}
    >
      <form onSubmit={submit} onChange={invalidateDuplicateCheck}>
        <div className="form-grid two-column">
          <label className="field"><span>{t("products.nameZh")}</span><input name="nameZh" maxLength={120}/></label>
          <label className="field"><span>{t("products.nameEn")}</span><input name="nameEn" maxLength={160}/></label>
        <BilingualNameHint/></div>
        {resource === "schools" && <><div className="form-grid two-column"><label className="field"><span>{t("modules.city")}</span><input name="city" required maxLength={80}/></label><label className="field"><span>{t("business.field.organization_type")}</span><select name="organizationType" required defaultValue="SCHOOL">{["SCHOOL","PARTNER","OTHER"].map(value=><option key={value} value={value}>{t(`business.option.${value}`)}</option>)}</select></label></div><details className="ux-enrichment"><summary>{t("ux.record.enrich")}</summary>          <label className="field"><span>{t("customerOps.shortName")}</span><input name="shortName" maxLength={80}/></label>

          <div className="form-grid two-column">

            <label className="field"><span>{t("modules.curriculum")}</span><OptionInput name="curriculum" maxLength={120} options={CURRICULUM_OPTIONS}/></label>
          </div>
          <p className="detail-empty">{t("business.createContactHelp")}</p>
          <label className="field"><span>{t("education.courseCategories")}</span><TagsInput name="courseCategories" placeholder={t("education.courseCategoriesHelp")}/></label>
          <div className="form-grid two-column"><label className="field"><span>{t("education.affiliationType")}</span><select name="affiliationType" defaultValue="INDEPENDENT" required>{["INDEPENDENT","EDUCATION_GROUP","GOVERNMENT","UNIVERSITY","RELIGIOUS","OTHER"].map(value=><option key={value} value={value}>{t(`education.affiliation.${value.toLowerCase()}`)}</option>)}</select></label><SearchableSelect label={t("education.parentOrganization")} options={organizationOptions} value={organization} onChange={setOrganization} onSearch={(query)=>searchRelated(query,"organization")}/></div>
          <label className="field"><span>{t("education.website")}</span><input name="website" type="url" placeholder="https://"/></label>
          <div className="form-grid two-column"><label className="field"><span>{t("education.foundedYear")}</span><YearInput name="foundedYear"/></label><label className="field"><span>{t("education.campusCount")}</span><input name="campusCount" type="number" min="0"/></label></div>
          <div className="form-grid two-column"><label className="field"><span>{t("education.studentCount")}</span><input name="studentCount" type="number" min="0"/></label><label className="field"><span>{t("education.facultyCount")}</span><input name="facultyCount" type="number" min="0"/></label></div>
          <label className="field"><span>{t("education.organizationOverview")}</span><textarea name="organizationOverviewMarkdown" rows={4} data-markdown="true"/><small>{t("common.markdownSupported")}</small></label><label className="field"><span>{t("education.structureOverview")}</span><textarea name="structureOverviewMarkdown" rows={4} data-markdown="true"/><small>{t("common.markdownSupported")}</small></label></details></>}
        {resource === "people" && <>
          {!organizationId&&<SearchableSelect label={t("modules.organization")} options={organizationOptions} value={organization} onChange={(value)=>{setOrganization(value);invalidateDuplicateCheck();}} onSearch={(query)=>searchRelated(query,"organization")}/>}
          <div className="form-grid two-column"><label className="field"><span>{t("modules.email")}</span><input name="email" type="email"/></label><label className="field"><span>{t("modules.phone")}</span><input name="phone" type="tel" maxLength={40}/></label></div>
          <label className="field"><span>{t("contact.type")}</span><select name="contactType" defaultValue="CONTACT" required>{["CONTACT","SCHOOL_STAFF","INSTITUTION_HEAD"].map(value=><option key={value} value={value}>{t(`contact.type.${value.toLowerCase()}`)}</option>)}</select></label>
          <details className="ux-enrichment"><summary>{t("ux.record.enrich")}</summary>          {canAssignOwner&&<SearchableSelect label={t("crm.owner")} options={ownerOptions} value={owner} onChange={(value)=>{setOwner(value);invalidateDuplicateCheck();}} onSearch={(query)=>searchRelated(query,"owner")}/>}
          <label className="field"><span>{t("modules.title")}</span><input name="title" maxLength={120}/></label>

          <div className="form-grid two-column"><label className="field"><span>{t("contact.contactStatus")}</span><select name="contactStatus" defaultValue="NEW" required>{["NEW","ATTEMPTING","CONNECTED","FOLLOW_UP","DORMANT"].map(value=><option key={value} value={value}>{t(`contact.status.${value.toLowerCase()}`)}</option>)}</select></label></div>
          <label className="field"><span>{t("contact.communicationLevel")}</span><select name="communicationLevel" defaultValue="1" required>{[1,2,3,4].map(value=><option key={value} value={value}>{t(`contact.communication.level${value}`)}</option>)}</select></label>
          <div className="form-grid two-column"><label className="field"><span>{t("contact.preferredContactMethod")}</span><select name="preferredContactMethod" defaultValue="EMAIL" required>{["EMAIL","PHONE","SMS","WECHAT","WHATSAPP","IN_PERSON"].map(value=><option value={value} key={value}>{t(`contact.method.${value.toLowerCase()}`)}</option>)}</select></label><label className="field"><span>{t("contact.preferredLanguage")}</span><OptionInput name="preferredLanguage" maxLength={80} options={LANGUAGE_OPTIONS}/></label></div>
          <div className="form-grid two-column"><label className="field"><span>{t("contact.acquisitionSource")}</span><OptionInput name="acquisitionSource" maxLength={160} options={SOURCE_OPTIONS}/></label><label className="field"><span>{t("contact.decisionRole")}</span><select name="decisionRole" defaultValue="UNKNOWN" required>{["UNKNOWN","DECISION_MAKER","INFLUENCER","USER","GATEKEEPER","OTHER"].map(value=><option value={value} key={value}>{t(`contact.decisionRole.${value.toLowerCase()}`)}</option>)}</select></label></div>
          <div className="form-grid two-column"><label className="field"><span>{t("contact.tags")}</span><TagsInput name="tags" placeholder={t("contact.tagsHelp")}/></label><label className="field"><span>{t("contact.nextFollowUp")}</span><DateInput name="nextFollowUpAt" type="datetime-local"/></label></div>
          <label className="field"><span>{t("contact.notes")}</span><textarea name="notesMarkdown" rows={5} maxLength={20000} data-markdown="true"/><small>{t("common.markdownSupported")}</small></label>
          <InlineMessage type="info"><span className="required-indicator">* </span>{t("modules.contactMethodRequired")} ({t("input.required")})</InlineMessage>
</details></>}
        {resource === "tasks" && <>
          <SearchableSelect label={t("modules.relatedRecord")} required options={relatedOptions} value={related} onChange={(value) => { setRelated(value); setRelatedLabel(relatedOptions.find((item) => item.value === value)?.label ?? ""); invalidateDuplicateCheck(); }} onSearch={(query) => searchRelated(query, "related")}/>
          <SearchableSelect label={t("modules.owner")} options={ownerOptions} value={owner} onChange={(value) => { setOwner(value); invalidateDuplicateCheck(); }} onSearch={(query) => searchRelated(query, "owner")}/>
          <div className="form-grid two-column">
            <label className="field"><span>{t("modules.dueAt")}</span><DateInput name="dueAt" type="datetime-local" required/></label>
            <label className="field"><span>{t("modules.priority")}</span><select name="priority" defaultValue="NORMAL" required><option value="LOW">{t("modules.priority.low")}</option><option value="NORMAL">{t("modules.priority.normal")}</option><option value="HIGH">{t("modules.priority.high")}</option><option value="URGENT">{t("modules.priority.urgent")}</option></select></label>
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
          <button className="secondary-button" type="button" disabled={saving} data-drawer-dismiss onClick={close}>{t("common.cancel")}</button>
          <button className="primary-button" type="submit" disabled={!duplicateChecked || duplicates.length > 0 || saving}><CheckCircle2 size={17}/>{saving ? t("common.saving") : t("modules.createRecord", { record: t(`${prefix}.singular`) })}</button>
        </div>
      </form>
    </AccessibleDrawer>}
    {exportOpen&&resource&&<AccessibleDrawer pending={exportPending} title={t("export.requestTitle")} eyebrow={t("exports.eyebrow")} description={t("export.requestHelp")} onClose={()=>setExportOpen(false)}>
      <form onSubmit={requestExport}>
        <InlineMessage type="info">{t("export.requestHelp")}</InlineMessage>
        <label className="field"><span>{t("export.format")}</span><select name="format" defaultValue="CSV" required><option value="CSV">CSV</option><option value="XLSX">XLSX</option><option value="PDF">PDF</option></select><small>{t("export.formatHelp")}</small></label>
        <label className="field"><span>{t("export.reason")}</span><textarea name="reason" rows={4} minLength={3} maxLength={1000} placeholder={t("export.reasonPlaceholder")} required/></label>
        {error&&<InlineMessage type="error">{error}</InlineMessage>}
        <div className="drawer-actions"><button className="secondary-button" type="button" disabled={exportPending} onClick={()=>setExportOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={exportPending}><Download size={16}/>{exportPending?t("common.processing"):t("export.request")}</button></div>
      </form>
    </AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")}/>}
  </div>;
}
