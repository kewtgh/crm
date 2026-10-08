"use client";
import {SafeDiagnostics} from "./safe-diagnostics";
import {DetailTabs} from "./detail-tabs";
import {ImportSetsPage} from "./import-sets-page";
import {v2FieldLabel} from "@/lib/import-v2-labels";
import {SearchFilterBar} from "./search-filter-bar";
import {ImportReferencePanel} from "./import-reference-panel";
import {normalizeLocalizedImport} from "@/lib/import-localized-headers";
import {v2Headers,v2Resources,validateV2Headers,type V2Resource} from "@/lib/import-v2";
import { BilingualNameHint } from "./structured-inputs";
import { ImportRepairField } from "./import-repair-field";

import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Play, RotateCcw, Save, SearchCheck, Upload } from "lucide-react";
import type { ImportBatchRecord, ImportMappingProfile, ImportRowRecord } from "@/lib/phase2-repository";
import { useI18n } from "./i18n-provider";
import { AccessibleDrawer, InlineMessage, Pagination, SearchableSelect, StatusBadge, Toast } from "./ui";
import { useCapability } from "./app-user-context";
import { apiFetch } from "@/lib/api-client";
import { useUserPreferences } from "@/components/user-preferences-context";
import { CsvParseError, parseCsvDocument } from "@/lib/csv";
import { parseXlsxDocument } from "@/lib/xlsx";
import { useRemoteSearch } from "@/hooks/use-remote-search";
import { importFields, importMappingReady, importFieldsByResource as targetFieldsByResource } from "@/lib/import-fields";
import {
  IMPORT_EXECUTION_BATCH_SIZE,
  importExecutionPassLimit,
  isImportExecutionTerminal,
} from "@/lib/import-execution";

type RelatedSearchItem={value:string;labelZh:string;labelEn:string;type:string};

async function hashFile(file: File) {
  const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function ImportsPage({
  initialItems,
  initialTotal,
  duplicatesOnly = false,
}: {
  initialItems: ImportBatchRecord[];
  initialTotal: number;
  duplicatesOnly?: boolean;
}) {
  const { t,locale } = useI18n();
  const { formatDate } = useUserPreferences();
  const [workspaceTab,setWorkspaceTab]=useState("entities");
  const canMerge = useCapability("duplicates.manage");
  const [batches, setBatches] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [resource, setResource] = useState<keyof typeof targetFieldsByResource>("CONTACTS");
  const [templateVersion,setTemplateVersion]=useState("2");
  const [format,setFormat]=useState("xlsx");
  const [rowLocations,setRowLocations]=useState<number[]>([]);
  const [sheet,setSheet]=useState<string|undefined>();
  const v2=templateVersion==="2"&&(v2Resources as readonly string[]).includes(resource);
  const targetFields=v2?v2Headers(resource as V2Resource):targetFieldsByResource[resource] as readonly string[];
  const zh=locale==="zh-CN";
  const fieldLabel=(field:string)=>{const key=field.startsWith("profile.")?"business.field."+field.slice(8):"imports.field."+field;const label=t(key);return v2?v2FieldLabel(field,locale):label===key?field:label;};
  const [fileName, setFileName] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileHash, setFileHash] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappingProfiles,setMappingProfiles]=useState<ImportMappingProfile[]>([]);
  const [mappingProfileId,setMappingProfileId]=useState("");
  const [mappingName,setMappingName]=useState("");
  const [selected, setSelected] = useState("");
  const [rows, setRows] = useState<ImportRowRecord[]>([]);
  const [rowPage, setRowPage] = useState(1);
  const [rowPageSize,setRowPageSize]=useState(50);
  const [rowTotal, setRowTotal] = useState(0);
  const [dryRun, setDryRun] = useState<{
    create: number; update: number; merge: number; skip: number;
    invalid: number; unresolved: number; canExecute: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [executionProgress,setExecutionProgress]=useState<{processed:number;total:number}|null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [mergeResource, setMergeResource] = useState<"CONTACTS" | "ORGANIZATIONS">("CONTACTS");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [mergePreview, setMergePreview] = useState<{
    target: Record<string, unknown>;
    source: Record<string, unknown>;
    impact: Record<string, unknown>;
    recommendedMaster: string;
    editableFields: string[];
  } | null>(null);
  const [fieldChoices, setFieldChoices] = useState<Record<string, "TARGET" | "SOURCE">>({});
  const [mergeConfirmed, setMergeConfirmed] = useState(false);
  const [mergePending,setMergePending]=useState(false);
  const [mergeOptions,setMergeOptions]=useState<Array<{value:string;label:string;detail?:string}>>([]);
  const [rollbackOpen,setRollbackOpen]=useState(false);
  const [repairRow,setRepairRow]=useState<ImportRowRecord|null>(null);
  const [repairFields,setRepairFields]=useState<readonly string[]>([]);
  const runMergeSearch=useRemoteSearch();
  const runBatchLoad=useRemoteSearch();
  const runRowLoad=useRemoteSearch();
  const runFileLoad=useRemoteSearch();

  useEffect(()=>{
    if(duplicatesOnly)return;
    let active=true;
    void apiFetch<{items:ImportMappingProfile[]}>("/api/imports?mappingProfiles=true")
      .then(result=>{if(active)setMappingProfiles(result.items);})
      .catch(()=>{if(active)setError(t("imports.mappingLoadFailed"));});
    return()=>{active=false;};
  },[duplicatesOnly,t]);

  const current = batches.find((item) => item.id === selected);
  const visibleDuplicateRows = useMemo(() => rows.filter((item) => item.status === "DUPLICATE"), [rows]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rowPages = Math.max(1, Math.ceil(rowTotal / rowPageSize));
  const headerOptions = [{ value: "", label: t("imports.ignore") }, ...headers.map((header) => ({ value: header, label: header }))];

  const loadBatches = async (nextPage = page, nextPageSize = pageSize) => {
    const request=await runBatchLoad(async signal=>{
      const fetchPage=(value:number)=>apiFetch<{items:ImportBatchRecord[];total?:number}>(`/api/imports?page=${value}&pageSize=${nextPageSize}`,{signal});
      let result=await fetchPage(nextPage);
      const validPage=Math.min(nextPage,Math.max(1,Math.ceil((result.total??0)/nextPageSize)));
      if(validPage!==nextPage)result=await fetchPage(validPage);
      return {...result,page:validPage};
    });
    if(!request.current)return;
    if("error" in request){
      setError(t("imports.loadFailed"));
      return;
    }
    setError("");
    setBatches(request.value.items);
    setTotal(request.value.total ?? 0);
    setPage(request.value.page);setPageSize(nextPageSize);
  };

  const open = async (id: string, nextRowPage = 1, nextRowPageSize = rowPageSize) => {
    setSelected(id);
    if(id!==selected){setRows([]);setRowTotal(0);}
    setDryRun(null);
    const request=await runRowLoad(async signal=>{
      const fetchPage=(value:number)=>apiFetch<{items:ImportRowRecord[];total?:number}>(`/api/imports?batch=${id}&rowPage=${value}&rowPageSize=${nextRowPageSize}`,{signal});
      const [firstResult,dryRunResult]=await Promise.all([fetchPage(nextRowPage),apiFetch<{summary:NonNullable<typeof dryRun>}>(`/api/imports/${id}/dry-run`,{signal})]);
      let result=firstResult;
      const validPage=Math.min(nextRowPage,Math.max(1,Math.ceil((result.total??0)/nextRowPageSize)));
      if(validPage!==nextRowPage)result=await fetchPage(validPage);
      return {result,dryRunResult,page:validPage};
    });
    if(!request.current)return;
    if("error" in request){
      setError(t("imports.loadFailed"));
      setDryRun(null);
      return;
    }
    const {result,dryRunResult}=request.value;
    setError("");
    setRows(result.items);
    setRowTotal(result.total ?? 0);
    setRowPage(request.value.page);setRowPageSize(nextRowPageSize);
    setDryRun(dryRunResult.summary);
  };

  const chooseFile = async (file: File) => {
    setError("");
    setFileName("");setFileHash("");setHeaders([]);setRawRows([]);setMapping({});setMappingProfileId("");
    setFileLoading(true);
    const request=await runFileLoad(async()=>{
      if(file.size>10*1024*1024)throw new Error("IMPORT_FILE_TOO_LARGE");
      const parsed = file.name.toLowerCase().endsWith(".xlsx")
        ? await parseXlsxDocument(file,10_000,v2?{resource,templateVersion:"2"}:undefined)
        : parseCsvDocument(await file.text(),10_000,v2);
      Object.assign(parsed,normalizeLocalizedImport(parsed,v2?v2Headers(resource as V2Resource):targetFields));if(v2)validateV2Headers(resource as V2Resource,parsed.headers);
      return {parsed,hash:await hashFile(file)};
    });
    if(!request.current)return;
    setFileLoading(false);
    if("value" in request){
      const {parsed,hash}=request.value;
      setFileName(file.name);
      setFileHash(hash);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);setRowLocations(parsed.rowLocations??parsed.rows.map((_,i)=>i+2));setSheet(parsed.sheet);
      const automatic: Record<string, string> = {};
      for (const field of targetFields) {
        const match = parsed.headers.find((header) => v2?header===field:header.toLowerCase().replace(/[_\s-]/g, "") === field.toLowerCase());
        if (match) automatic[field] = match;
      }
      setMapping(automatic);
    } else {
      const caught=request.error;
      const key=caught instanceof CsvParseError
        ?caught.code==="TOO_MANY_ROWS"?"imports.tooManyRows"
          :caught.code==="UNCLOSED_QUOTE"?"imports.unclosedQuote"
            :caught.code==="DUPLICATE_HEADER"?"imports.duplicateHeader"
              :caught.code==="COLUMN_COUNT"?"imports.columnCount"
                :caught.code==="INVALID_QUOTE"?"imports.invalidQuote"
              :"imports.parseFailed"
        :caught instanceof Error&&caught.message==="IMPORT_FILE_TOO_LARGE"?"imports.fileTooLarge":"imports.parseFailed";
      setError(v2&&caught instanceof Error&&! (caught instanceof CsvParseError)?caught.message:t(key,{row:caught instanceof CsvParseError?caught.row??1:1}));
    }
  };

  const createBatch = async () => {
    if(fileLoading||pending)return;
    if (!rawRows.length || (!v2&&!importMappingReady(resource,mapping))) {
      setError(t(resource==="COHORTS"||resource==="ENROLLMENTS"?"imports.identityMappingRequired":"imports.mappingRequired"));
      return;
    }
    setPending(true);
    setError("");
    const hash = fileHash;
    const normalized = rawRows.map((row) => Object.fromEntries(targetFields.map((field) => [field, mapping[field] ? row[mapping[field]] ?? "" : ""])));
    try {
      const result = await apiFetch<{ item: ImportBatchRecord }>("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v2?{operation:"createV2",resource,templateVersion:"2",filename:fileName,contentHash:hash,requestKey:`${resource}:2:${hash}`,headers,rows:rawRows,rowLocations,sheet}:{ operation: "create", resource, filename: fileName, content_hash: hash, request_key: `${resource}:${hash}`, mapping, rows: normalized }),
      });
      await loadBatches(1);
      await open(result.item.id);
      setToast(t("imports.validated"));
    } catch {
      setError(t("imports.createFailed"));
    } finally {
      setPending(false);
    }
  };

  const applyMappingProfile=(profileId:string)=>{
    setMappingProfileId(profileId);
    const profile=mappingProfiles.find(item=>item.id===profileId);
    if(!profile)return;
    setMapping(Object.fromEntries(Object.entries(profile.mapping).filter(([,header])=>headers.includes(header))));
  };

  const saveMapping=async()=>{
    if(!mappingName.trim()||!headers.length){setError(t("imports.mappingNameRequired"));return;}
    setPending(true);setError("");
    try{
      const result=await apiFetch<{item:ImportMappingProfile}>("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(v2?{operation:"saveMappingV2",resource,name:mappingName.trim(),mapping,expectedRevision:mappingProfiles.find(p=>p.name===mappingName.trim()&&p.resource===resource&&p.templateVersion==="2")?.revision??null}:{operation:"saveMapping",resource,name:mappingName.trim(),mapping})});
      setMappingProfiles(current=>[...current.filter(item=>item.id!==result.item.id),result.item].sort((a,b)=>a.name.localeCompare(b.name)));
      setMappingProfileId(result.item.id);setToast(t("imports.mappingSaved"));
    }catch{setError(t("imports.mappingSaveFailed"));}
    finally{setPending(false);}
  };

  const decide = async (row: ImportRowRecord, chosenAction: string) => {
    setError("");
    try {
      await apiFetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(row.templateVersion==="2"?{ operation:"decideV2",target_row:row.id,expected_revision:row.reviewRevision,chosen_action:chosenAction}:{ operation: "decide", target_row: row.id, chosen_action: chosenAction }),
      });
    } catch {
      setError(t("imports.decisionFailed"));
      return;
    }
    await open(row.batchId, rowPage);
    await loadBatches();
  };
  const repair = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();if(!repairRow||!repairFields.length||pending)return;
    const form=new FormData(event.currentTarget);
    const replacement=Object.fromEntries(repairFields.map(field=>[field,String(form.get(field)??"")]));
    setPending(true);setError("");
    try{
      await apiFetch("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(repairRow.templateVersion==="2"?{operation:"repairV2",target_row:repairRow.id,expected_revision:repairRow.reviewRevision,replacement}:{operation:"repair",target_row:repairRow.id,replacement})});
      const batchId=repairRow.batchId;setRepairRow(null);await open(batchId,rowPage);await loadBatches();setToast(t("imports.rowRepaired"));
    }catch{setError(t("imports.rowRepairFailed"));}
    finally{setPending(false);}
  };

  const process = async () => {
    if (!selected) return;
    setPending(true);
    setError("");
    setExecutionProgress(null);
    let preflightResult: { summary: NonNullable<typeof dryRun> };
    try {
      preflightResult = await apiFetch<{ summary: NonNullable<typeof dryRun> }>(`/api/imports/${selected}/dry-run`);
    } catch {
      setError(t("imports.dryRunBlocked"));
      setPending(false);
      return;
    }
    if (!preflightResult.summary.canExecute) {
      setDryRun(preflightResult.summary);
      setError(t("imports.dryRunBlocked"));
      setPending(false);
      return;
    }
    setDryRun(preflightResult.summary);
    let status = "PROCESSING";
    let latest = current;
    const passLimit = importExecutionPassLimit(current?.total ?? 0);
    for (let index = 0; index < passLimit && status === "PROCESSING"; index += 1) {
      try {
        const result = await apiFetch<{ item: ImportBatchRecord }>("/api/imports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: current?.executionContract==="CANONICAL_V2"?"processV2":"process", target_batch: selected, batch_size: IMPORT_EXECUTION_BATCH_SIZE }),
        });
        latest = result.item;
        status = current?.executionContract==="CANONICAL_V2"&&result.item.valid>0&&!result.item.duplicates?"PROCESSING":result.item.status;
        setExecutionProgress({
          processed: result.item.applied + result.item.failed,
          total: result.item.total,
        });
        setBatches((items)=>items.map((item)=>item.id===result.item.id?result.item:item));
      } catch {
        setError(t("imports.executeFailed"));
        setPending(false);
        return;
      }
    }
    setPending(false);
    await loadBatches();
    await open(selected, Math.min(rowPage, rowPages));
    if (latest && isImportExecutionTerminal(latest.status)) {
      setToast(latest.failed||latest.invalid?(zh?"部分失败：请查看每行结果。":"Partially failed: review row outcomes."):t("imports.executed"));
    } else {
      setError(t("imports.executionIncomplete"));
    }
  };

  const rollback = async () => {
    if (!selected) return;
    setPending(true);
    setError("");
    try {
      await apiFetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: current?.executionContract==="CANONICAL_V2"?"rollbackV2":"rollback", target_batch: selected,requestKey:crypto.randomUUID() }),
      });
    } catch {
      setPending(false);
      setError(t("imports.rollbackConflict"));
      return;
    }
    setPending(false);
    setRollbackOpen(false);
    await loadBatches();
    await open(selected, rowPage);
    setToast(t("imports.rolledBack"));
  };

  const previewMerge = async (targetId = mergeTarget, sourceId = mergeSource) => {
    setError("");
    setMergePreview(null);
    try {
      const result = await apiFetch<{ preview: NonNullable<typeof mergePreview> }>("/api/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "preview", resource: mergeResource, targetId, sourceId }),
      });
      setFieldChoices(Object.fromEntries(result.preview.editableFields.map((field) => [field, "TARGET"])));
      setMergeConfirmed(false);
      setMergePreview(result.preview);
    } catch {
      setError(t("duplicates.previewFailed"));
    }
  };

  const mergeRecords = async () => {
    if (!mergePreview || !mergeConfirmed) return;
    setMergePending(true);setError("");
    try {
      await apiFetch("/api/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "merge",
          resource: mergeResource,
          targetId: mergeTarget,
          sourceId: mergeSource,
          fieldChoices,
          confirmed: true,
          requestKey:crypto.randomUUID(),
        }),
      });
    } catch {
      setError(t("duplicates.previewFailed"));
      setMergePending(false);
      return;
    }
    setMergePending(false);
    setMergePreview(null);
    setMergeTarget("");
    setMergeSource("");
    setToast(t("duplicates.mergeSuccess"));
  };
  const searchMergeRecords=async(query:string)=>{
    const result=await runMergeSearch(signal=>apiFetch<{items:RelatedSearchItem[]}>(`/api/search/related?q=${encodeURIComponent(query)}`,{signal}));
    if(!result.current)return;
    if("error" in result){setError(t("duplicates.previewFailed"));return;}
    const expected=mergeResource==="CONTACTS"?"CONTACT":"ORGANIZATION";
    setMergeOptions(result.value.items.filter(item=>item.type===expected).map(item=>({value:item.value.split(":")[1]??"",label:`${item.labelZh} / ${item.labelEn}`,detail:t(mergeResource==="CONTACTS"?"imports.contacts":"imports.organizations")})));
  };

  const workspaceItems=[{key:"entities",label:"workspace.importRecords"},{key:"relationships",label:"workspace.linkRecords"},{key:"sets",label:"closure.importSets"}];

  return <div className="page-stack imports-page">
    <section className="page-heading-row">
      <div>
        <p className="eyebrow">{t(duplicatesOnly ? "duplicates.eyebrow" : "imports.eyebrow")}</p>
        <h1>{t(duplicatesOnly ? "duplicates.title" : "imports.title")}</h1>
        <p>{t(duplicatesOnly ? "duplicates.description" : "imports.description")}</p>
      </div>
    </section>

    {duplicatesOnly && canMerge && <section className="surface duplicate-merge-panel">
      <div className="surface-heading"><div><p className="eyebrow">{t("duplicates.controlledMerge")}</p><h2>{t("duplicates.mergePreview")}</h2><p>{t("duplicates.mergeHelp")}</p></div><SearchCheck size={21}/></div>
      <SearchFilterBar><label className="field"><span>{t("imports.resource")}</span><select value={mergeResource} onChange={(event) => { setMergeResource(event.target.value as typeof mergeResource);setMergeTarget("");setMergeSource("");setMergeOptions([]);setMergePreview(null); }}><option value="CONTACTS">{t("imports.contacts")}</option><option value="ORGANIZATIONS">{t("imports.organizations")}</option></select></label><SearchableSelect label={t("imports.mergeTarget")} required options={mergeOptions.filter(item=>item.value!==mergeSource)} value={mergeTarget} placeholder={t("imports.chooseRecord")} onSearch={searchMergeRecords} onChange={value=>{setMergeTarget(value);setMergePreview(null);}}/><SearchableSelect label={t("imports.mergeSource")} required options={mergeOptions.filter(item=>item.value!==mergeTarget)} value={mergeSource} placeholder={t("imports.chooseRecord")} onSearch={searchMergeRecords} onChange={value=>{setMergeSource(value);setMergePreview(null);}}/></SearchFilterBar>
      <button className="secondary-button" type="button" disabled={!mergeTarget || !mergeSource || mergeTarget === mergeSource} onClick={() => void previewMerge()}><SearchCheck size={16}/>{t("duplicates.preview")}</button>
      {mergePreview && <div className="merge-preview">
        <InlineMessage type={mergePreview.recommendedMaster === mergeTarget ? "success" : "warning"}>{t("duplicates.recommendedMaster", { id: mergePreview.recommendedMaster })}{mergePreview.recommendedMaster !== mergeTarget && <button className="inline-action" type="button" onClick={() => { const oldTarget = mergeTarget; const oldSource = mergeSource; setMergeTarget(oldSource); setMergeSource(oldTarget); void previewMerge(oldSource, oldTarget); }}>{t("duplicates.useRecommended")}</button>}</InlineMessage>
        <InlineMessage type="info">{t("duplicates.editableFieldsOnly")}</InlineMessage>
        <div className="merge-fields"><div className="merge-fields-head"><b>{t("imports.mergeTarget")}</b><b>{t("imports.mergeSource")}</b><b>{t("duplicates.confirmMerge")}</b></div>{mergePreview.editableFields.map((key) => <div className="merge-field" key={key}><span><small>{t(`imports.field.${key}`)}</small><b>{String(mergePreview.target[key] ?? "—")}</b></span><span><small>{t(`imports.field.${key}`)}</small><b>{String(mergePreview.source[key] ?? "—")}</b></span><select aria-label={t(`imports.field.${key}`)} value={fieldChoices[key] ?? "TARGET"} onChange={(event) => setFieldChoices((current) => ({ ...current, [key]: event.target.value as "TARGET" | "SOURCE" }))}><option value="TARGET">{t("imports.targetChoice")}</option><option value="SOURCE">{t("imports.sourceChoice")}</option></select></div>)}</div>
        <InlineMessage type="warning">{Object.entries(mergePreview.impact).map(([key, value]) => `${t(`duplicates.impact.${key}`)}: ${String(value)}`).join(" · ")}</InlineMessage>
        <label className="check-row"><input type="checkbox" checked={mergeConfirmed} onChange={(event) => setMergeConfirmed(event.target.checked)}/><span>{t("duplicates.mergeHelp")}</span></label>
        <button className="danger-button" type="button" disabled={!mergeConfirmed||mergePending} onClick={() => void mergeRecords()}>{mergePending?t("common.processing"):t("duplicates.confirmMerge")}</button>
      </div>}
      {error && <InlineMessage type="error">{error}</InlineMessage>}
    </section>}

    <DetailTabs hideNavigation={duplicatesOnly} items={workspaceItems} active={workspaceTab} onChange={setWorkspaceTab} disabled={pending||fileLoading} label={t("workspace.importWorkspace")}>
    {workspaceTab!=="entities"?<ImportSetsPage key={workspaceTab} relationships={workspaceTab==="relationships"} embedded/>:<>
    {!duplicatesOnly && <section className="surface import-create" data-surface-tone="work">
      <div className="surface-heading"><div><p className="eyebrow">{t("imports.newEyebrow")}</p><h2>{v2?(zh?"上传 CSV / XLSX 并预检":"Upload CSV / XLSX and preflight"):t("imports.newBatch")}</h2></div><Upload size={21} /></div>
      <div className="import-template-toolbar">{v2&&<label className="field import-format"><span>{zh?"下载格式":"Download format"}</span><select value={format} onChange={e=>setFormat(e.target.value)}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></select></label>}
      <div className="import-template-actions email-filter-actions">{(["blank","example","guide"] as const).map(kind=><a key={kind} className="secondary-button" href={`/api/imports/template?resource=${resource}&kind=${kind}&locale=${locale}&templateVersion=${v2?"2":"LEGACY_UNVERSIONED"}&format=${kind==="guide"?"csv":v2?format:"csv"}`}><Download size={16}/>{t(`ux.import.${kind}`)}</a>)}</div></div><InlineMessage type="info">{v2?(zh?"使用最新模板。新增资料至少填写一种名称，其他必填内容见字段说明；更新资料需要先选择已有记录。预检不会修改业务数据。":"Use this resource’s v2 template. CREATE requires one name; consult Guide for other requirements. UPDATE needs an authorized target reference. Preflight does not change business data."):t(resource==="COHORTS"||resource==="ENROLLMENTS"?"imports.operationalHelp":"ux.importHelp")}</InlineMessage>
      <div className="form-grid two-column">
        <label className="field"><span>{t("imports.resource")}</span><select disabled={fileLoading||pending} value={resource} onChange={(event) => {setResource(event.target.value as typeof resource);setTemplateVersion((v2Resources as readonly string[]).includes(event.target.value)?"2":"LEGACY_UNVERSIONED");setHeaders([]);setRawRows([]);setFileName("");setMappingProfileId("");setMapping({});}}><option value="CONTACTS">{t("imports.contacts")}</option><option value="ORGANIZATIONS">{t("imports.organizations")}</option><option value="HOUSEHOLDS">{t("education.households")}</option><option value="STUDENTS">{t("education.students")}</option><option value="COHORTS">{t("cohorts.title")}</option><option value="ENROLLMENTS">{t("enrollments.title")}</option></select></label>
        <div className="field file-field"><span>{v2?"CSV / XLSX":t("imports.file")}</span><input className="sr-only" id="import-source-file" type="file" disabled={pending} accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => {const file=event.target.files?.[0];event.target.value="";if(file)void chooseFile(file);}}/><div className="file-picker-row"><label className="secondary-button" htmlFor="import-source-file"><Upload size={16}/>{t("imports.chooseFile")}</label><span className={fileName?"selected-file":"file-placeholder"}>{fileName||t("imports.noFileSelected")}</span></div></div>
      </div>
      {v2&&<><InlineMessage type="info">{zh?"UPDATE 空白保持原值；__CLEAR__ 仅允许清空 Guide 中列出的可空字段。敏感字段为可选，不要求收集。未知列会阻止预检。":"UPDATE blanks preserve current values; __CLEAR__ only clears nullable fields listed in Guide. Sensitive fields are optional. Unknown columns block preflight."}</InlineMessage><details><summary>{zh?"关联已有资料（可选）":"Link existing records (optional)"}</summary><ImportReferencePanel/></details></>}
      {fileLoading&&<InlineMessage type="info">{t("imports.readingFile")}</InlineMessage>}
      {headers.length > 0 && <>
        <details className="operational-disclosure" open={v2?undefined:true}><summary>{t("repair.mappingDetails")}</summary>
        <div className="form-grid three-column import-mapping-profiles">
          <label className="field"><span>{t("imports.mappingProfile")}</span><select value={mappingProfileId} onChange={event=>applyMappingProfile(event.target.value)}><option value="">{t("imports.mappingNone")}</option>{mappingProfiles.filter(item=>item.resource===resource&&(item.templateVersion??"LEGACY_UNVERSIONED")===(v2?"2":"LEGACY_UNVERSIONED")).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>{t("imports.mappingName")}</span><input value={mappingName} maxLength={80} onChange={event=>setMappingName(event.target.value)} placeholder={t("imports.mappingNamePlaceholder")}/></label>
          <button className="secondary-button import-mapping-save" type="button" disabled={pending||!mappingName.trim()} onClick={()=>void saveMapping()}><Save size={16}/>{t("imports.saveMapping")}</button>
        </div>
        <div className="mapping-grid">
          <p className="name-pair-hint"><span className="required-indicator">* </span>{v2?(zh?"v2 列名必须与模板一致；字段是否必填由操作及 Guide 决定。":"v2 columns must match the template; operation and Guide determine required values."):t(resource==="COHORTS"||resource==="ENROLLMENTS"?"imports.identityMappingRequired":"imports.nameMappingHelp")}</p>
          {targetFields.map((field) => <SearchableSelect key={field} label={fieldLabel(field)} options={v2?headerOptions.filter(o=>o.value===field):headerOptions} value={mapping[field] ?? ""} placeholder={t("imports.ignore")} onChange={(value) => setMapping((currentMapping) => ({ ...currentMapping, [field]: value }))} />)}
        </div>
        </details>
        <InlineMessage type="info">{t("imports.preview", { rows: rawRows.length, columns: headers.length })}</InlineMessage>
        <button className="primary-button" type="button" disabled={pending||fileLoading} onClick={() => void createBatch()}><SearchCheck size={16} />{pending ? t("imports.validating") : t("imports.validate")}</button>
      </>}
      {error && <InlineMessage type="error">{error}</InlineMessage>}
    </section>}

    <section className="import-workspace">
      <div className="surface batch-list" data-surface-tone="context">
        <div className="surface-heading"><div><p className="eyebrow">{t("imports.historyEyebrow")}</p><h2>{t("imports.batches")}</h2></div><FileSpreadsheet size={21} /></div>
        {batches.map((item) => <button className={item.id === selected ? "batch-card selected" : "batch-card"} type="button" key={item.id} onClick={() => void open(item.id)}>
          <span><b>{item.filename}</b><small>{t(({CONTACTS:"imports.contacts",ORGANIZATIONS:"imports.organizations",HOUSEHOLDS:"education.households",STUDENTS:"education.students",COHORTS:"cohorts.title",ENROLLMENTS:"enrollments.title"} as Record<string,string>)[item.resourceType]??"closure.unknownResource")} · {formatDate(item.createdAt, { includeTime: true })}</small></span>
          <StatusBadge tone={item.status === "COMPLETED" ? "green" : item.status === "ROLLED_BACK" ? "gray" : item.status.includes("FAILED") ? "red" : "amber"}>{t(`imports.status.${item.status.toLowerCase()}`)}</StatusBadge>
          <small>{t("imports.batchCounts", { total: item.total, duplicates: item.duplicates, failed: item.failed })}</small>
        </button>)}
        <Pagination page={page} totalPages={pages} total={total} pageSize={pageSize} onPage={(next) => void loadBatches(next)} onPageSize={(value)=>void loadBatches(1,value)} />
      </div>

      <div className="surface import-rows" data-surface-tone="governance">
        <div className="surface-heading"><div><p className="eyebrow">{t("imports.rowsEyebrow")}</p><h2>{current ? current.filename : t("imports.selectBatch")}</h2></div>{current && <StatusBadge tone="blue">{t(`imports.status.${current.status.toLowerCase()}`)}</StatusBadge>}</div>
        {current && dryRun && <div className={`import-dry-run ${dryRun.canExecute ? "ready" : "blocked"}`}><SearchCheck size={20}/><div><b>{t("imports.dryRun")}</b><small>{t("imports.dryRunHelp", { create: dryRun.create, update: dryRun.update, merge: dryRun.merge, skip: dryRun.skip, invalid: dryRun.invalid, unresolved: dryRun.unresolved })}</small></div><StatusBadge tone={dryRun.canExecute ? "green" : "amber"}>{t(dryRun.canExecute ? "imports.dryRunReady" : "imports.dryRunBlocked")}</StatusBadge></div>}
        {current && pending && executionProgress && <InlineMessage type="info">{t("imports.executionProgress",{processed:executionProgress.processed,total:executionProgress.total})}</InlineMessage>}
        {rows.map((row) => <article className={`import-row${current?.resourceType==="COHORTS"||current?.resourceType==="ENROLLMENTS"?" import-domain-row":""}`} key={row.id}>
          <span>#{row.rowNumber}</span>
          <div>
            <b>{row.templateVersion==="2"&&row.normalized.operation==="UPDATE"?`UPDATE · ${row.normalized.targetLabel||(zh?"已授权目标":"Authorized target")}`:current?.resourceType==="ENROLLMENTS"?`${row.normalized.studentNumber||"—"} · ${row.normalized.cohortCode||"—"}`:current?.resourceType==="COHORTS"?`${row.normalized.productCode||"—"} · ${row.normalized.cohortCode||"—"}`:`${row.normalized.nameZh||""} / ${row.normalized.nameEn||""}`}</b>
            <small>{current?.resourceType==="COHORTS"||current?.resourceType==="ENROLLMENTS"?row.normalized.ownerEmail||"—":row.normalized.email || row.normalized.phone || row.normalized.city || "—"}</small>
            {(row.errors.length>0||row.lastError)&&<><p className="error-text">{t("closure.importProblem")}</p><p>{t("closure.importNext")}</p></>}
            {row.errors.map((item,index)=><div key={index}>{item.field&&<small>{fieldLabel(item.field)}</small>}<SafeDiagnostics items={[{label:t("closure.code"),value:item.code},{label:t("closure.row"),value:item.row??row.rowNumber},{label:t("closure.field"),value:item.column??item.field},{label:t("closure.sheet"),value:item.sheet},{label:t("closure.code"),value:item.reason}]}/></div>)}
            {row.targetRevision&&<SafeDiagnostics items={[{label:t("closure.revision"),value:row.targetRevision}]}/>}

          </div>
          <StatusBadge tone={row.status === "APPLIED" ? "green" : row.status === "INVALID" || row.status === "FAILED" ? "red" : row.status === "DUPLICATE" ? "amber" : "blue"}>{t(`imports.rowStatus.${row.status.toLowerCase()}`)}</StatusBadge>
          {(row.status === "INVALID" || row.status === "FAILED" || row.templateVersion==="2"&&row.status==="DUPLICATE") && <button className="secondary-button" type="button" disabled={!current||!importFields(current.resourceType).length} onClick={()=>{setRepairFields(current?.executionContract==="CANONICAL_V2"?v2Headers(current.resourceType as V2Resource):importFields(current?.resourceType??""));setRepairRow(row);setError("");}}>{t("imports.repairRow")}</button>}
          {row.status === "DUPLICATE" && <div className="decision-buttons"><small>{t("duplicates.score", { score: row.score ?? 0 })} · {t("closure.importNext")}</small>{(row.templateVersion==="2"?["CREATE","SKIP"]:["CREATE", "UPDATE", "MERGE", "SKIP"]).map((choice) => <button type="button" key={choice} onClick={() => void decide(row, choice)}>{t(`imports.action.${choice.toLowerCase()}`)}</button>)}</div>}
        </article>)}
        {current && rows.length > 0 && <Pagination page={rowPage} totalPages={rowPages} total={rowTotal} pageSize={rowPageSize} onPage={(next) => void open(selected, next)} onPageSize={(value)=>void open(selected,1,value)} />}
        {current && !rows.length && <div className="empty-state"><span>{t("imports.noRows")}</span></div>}
        {current && <div className="import-actions">
          {["READY", "PROCESSING", "PARTIAL_FAILED"].includes(current.status) && !visibleDuplicateRows.length && <button className="primary-button" disabled={pending} onClick={() => void process()}><Play size={16} />{t("imports.execute")}</button>}
          {["COMPLETED", "PARTIAL_FAILED"].includes(current.status) && current.applied > 0 && <button className="danger-button" disabled={pending} onClick={() => setRollbackOpen(true)}><RotateCcw size={16} />{t("imports.rollback")}</button>}
        </div>}
        {error && <InlineMessage type="error">{error}</InlineMessage>}
      </div>
    </section>
    {repairRow&&<AccessibleDrawer pending={pending} title={t("imports.repairRowTitle",{row:repairRow.rowNumber})} description={t("imports.repairRowHelp")} onClose={()=>setRepairRow(null)}><form onSubmit={repair}><div className="form-grid two-column">{repairFields.map(field=><label className="field" key={field}><span>{t(`imports.field.${field}`)}</span>{repairRow.templateVersion==="2"?<input name={field} defaultValue={repairRow.normalized[field]??""}/>:<ImportRepairField field={field} value={repairRow.normalized[field]??""}/>}</label>)}<BilingualNameHint/></div>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={()=>setRepairRow(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}><Save size={16}/>{pending?t("common.saving"):t("common.save")}</button></div></form></AccessibleDrawer>}
    {rollbackOpen&&current&&<AccessibleDrawer pending={pending} title={t("common.confirmAction")} description={t("common.actionCannotUndo")} onClose={()=>setRollbackOpen(false)}><InlineMessage type="warning">{t("imports.rollbackConfirm",{count:current.applied})}</InlineMessage><div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={()=>setRollbackOpen(false)}>{t("common.cancel")}</button><button className="danger-button" type="button" disabled={pending} onClick={()=>void rollback()}>{pending?t("common.processing"):t("imports.rollback")}</button></div></AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </>}
  </DetailTabs>
  </div>;
}
