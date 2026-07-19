"use client";

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

const targetFields = ["nameZh", "nameEn", "email", "phone", "city", "title"];
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
  const { t } = useI18n();
  const { formatDate } = useUserPreferences();
  const canMerge = useCapability("duplicates.manage");
  const [batches, setBatches] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [resource, setResource] = useState<"CONTACTS" | "ORGANIZATIONS">("CONTACTS");
  const [fileName, setFileName] = useState("");
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
  const runMergeSearch=useRemoteSearch();
  const runBatchLoad=useRemoteSearch();
  const runRowLoad=useRemoteSearch();

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
    const request=await runBatchLoad(signal=>apiFetch<{ items: ImportBatchRecord[]; total?: number }>(`/api/imports?page=${nextPage}&pageSize=${nextPageSize}`,{signal}));
    if(!request.current)return;
    if("error" in request){
      setError(t("imports.loadFailed"));
      return;
    }
    setError("");
    setBatches(request.value.items);
    setTotal(request.value.total ?? 0);
  };

  const open = async (id: string, nextRowPage = 1, nextRowPageSize = rowPageSize) => {
    setSelected(id);
    const request=await runRowLoad(signal=>Promise.all([
      apiFetch<{ items: ImportRowRecord[]; total?: number }>(`/api/imports?batch=${id}&rowPage=${nextRowPage}&rowPageSize=${nextRowPageSize}`,{signal}),
      apiFetch<{ summary: NonNullable<typeof dryRun> }>(`/api/imports/${id}/dry-run`,{signal}),
    ]));
    if(!request.current)return;
    if("error" in request){
      setError(t("imports.loadFailed"));
      setDryRun(null);
      return;
    }
    const [result,dryRunResult]=request.value;
    setError("");
    setRows(result.items);
    setRowTotal(result.total ?? 0);
    setRowPage(nextRowPage);
    setDryRun(dryRunResult.summary);
  };

  const chooseFile = async (file: File) => {
    setError("");
    try {
      const parsed = file.name.toLowerCase().endsWith(".xlsx")
        ? await parseXlsxDocument(file,10_000)
        : parseCsvDocument(await file.text(),10_000);
      setFileName(file.name);
      setFileHash(await hashFile(file));
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      const automatic: Record<string, string> = {};
      for (const field of targetFields) {
        const match = parsed.headers.find((header) => header.toLowerCase().replace(/[_\s-]/g, "") === field.toLowerCase());
        if (match) automatic[field] = match;
      }
      setMapping(automatic);
    } catch(caught) {
      const key=caught instanceof CsvParseError
        ?caught.code==="TOO_MANY_ROWS"?"imports.tooManyRows"
          :caught.code==="UNCLOSED_QUOTE"?"imports.unclosedQuote"
            :caught.code==="DUPLICATE_HEADER"?"imports.duplicateHeader"
              :"imports.parseFailed"
        :"imports.parseFailed";
      setError(t(key));
    }
  };

  const createBatch = async () => {
    if (!rawRows.length || !mapping.nameZh || !mapping.nameEn) {
      setError(t("imports.mappingRequired"));
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
        body: JSON.stringify({ operation: "create", resource, filename: fileName, content_hash: hash, request_key: `${resource}:${hash}`, mapping, rows: normalized }),
      });
      setPage(1);
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
      const result=await apiFetch<{item:ImportMappingProfile}>("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"saveMapping",resource,name:mappingName.trim(),mapping})});
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
        body: JSON.stringify({ operation: "decide", target_row: row.id, chosen_action: chosenAction }),
      });
    } catch {
      setError(t("imports.decisionFailed"));
      return;
    }
    await open(row.batchId, rowPage);
    await loadBatches();
  };
  const repair = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();if(!repairRow)return;
    const form=new FormData(event.currentTarget);
    const replacement=Object.fromEntries(targetFields.map(field=>[field,String(form.get(field)??"")]));
    setPending(true);setError("");
    try{
      await apiFetch("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"repair",target_row:repairRow.id,replacement})});
      const batchId=repairRow.batchId;setRepairRow(null);await open(batchId,rowPage);await loadBatches();setToast(t("imports.rowRepaired"));
    }catch{setError(t("imports.rowRepairFailed"));}
    finally{setPending(false);}
  };

  const process = async () => {
    if (!selected) return;
    setPending(true);
    setError("");
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
    for (let index = 0; index < 12 && status === "PROCESSING"; index += 1) {
      try {
        const result = await apiFetch<{ item: ImportBatchRecord }>("/api/imports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "process", target_batch: selected, batch_size: 50 }),
        });
        status = result.item.status;
      } catch {
        setError(t("imports.executeFailed"));
        setPending(false);
        return;
      }
    }
    setPending(false);
    await loadBatches();
    await open(selected, Math.min(rowPage, rowPages));
    setToast(t("imports.executed"));
  };

  const rollback = async () => {
    if (!selected) return;
    setPending(true);
    setError("");
    try {
      await apiFetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "rollback", target_batch: selected,requestKey:crypto.randomUUID() }),
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
      <div className="form-grid three-column"><label className="field"><span>{t("imports.resource")}</span><select value={mergeResource} onChange={(event) => { setMergeResource(event.target.value as typeof mergeResource);setMergeTarget("");setMergeSource("");setMergeOptions([]);setMergePreview(null); }}><option value="CONTACTS">{t("imports.contacts")}</option><option value="ORGANIZATIONS">{t("imports.organizations")}</option></select></label><SearchableSelect label={t("imports.mergeTarget")} options={mergeOptions.filter(item=>item.value!==mergeSource)} value={mergeTarget} placeholder={t("imports.chooseRecord")} onSearch={searchMergeRecords} onChange={value=>{setMergeTarget(value);setMergePreview(null);}}/><SearchableSelect label={t("imports.mergeSource")} options={mergeOptions.filter(item=>item.value!==mergeTarget)} value={mergeSource} placeholder={t("imports.chooseRecord")} onSearch={searchMergeRecords} onChange={value=>{setMergeSource(value);setMergePreview(null);}}/></div>
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

    {!duplicatesOnly && <section className="surface import-create">
      <div className="surface-heading"><div><p className="eyebrow">{t("imports.newEyebrow")}</p><h2>{t("imports.newBatch")}</h2></div><Upload size={21} /></div>
      <div className="import-template-actions"><a className="secondary-button" href={`/api/imports/template?resource=${resource}`}><Download size={16}/>{t("imports.downloadTemplate")}</a><small>{t("imports.templateHelp")}</small></div>
      <div className="form-grid two-column">
        <label className="field"><span>{t("imports.resource")}</span><select value={resource} onChange={(event) => {setResource(event.target.value as typeof resource);setMappingProfileId("");setMapping({});}}><option value="CONTACTS">{t("imports.contacts")}</option><option value="ORGANIZATIONS">{t("imports.organizations")}</option></select></label>
        <div className="field file-field"><span>{t("imports.file")}</span><input className="sr-only" id="import-source-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files?.[0] && void chooseFile(event.target.files[0])}/><div className="file-picker-row"><label className="secondary-button" htmlFor="import-source-file"><Upload size={16}/>{t("imports.chooseFile")}</label><span className={fileName?"selected-file":"file-placeholder"}>{fileName||t("imports.noFileSelected")}</span></div></div>
      </div>
      {headers.length > 0 && <>
        <div className="form-grid three-column import-mapping-profiles">
          <label className="field"><span>{t("imports.mappingProfile")}</span><select value={mappingProfileId} onChange={event=>applyMappingProfile(event.target.value)}><option value="">{t("imports.mappingNone")}</option>{mappingProfiles.filter(item=>item.resource===resource).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>{t("imports.mappingName")}</span><input value={mappingName} maxLength={80} onChange={event=>setMappingName(event.target.value)} placeholder={t("imports.mappingNamePlaceholder")}/></label>
          <button className="secondary-button import-mapping-save" type="button" disabled={pending||!mappingName.trim()} onClick={()=>void saveMapping()}><Save size={16}/>{t("imports.saveMapping")}</button>
        </div>
        <div className="mapping-grid">
          {targetFields.filter((field) => resource === "CONTACTS" || !["email", "phone", "title"].includes(field)).map((field) => <SearchableSelect key={field} label={`${t(`imports.field.${field}`)}${["nameZh", "nameEn"].includes(field) ? " *" : ""}`} options={headerOptions} value={mapping[field] ?? ""} placeholder={t("imports.ignore")} onChange={(value) => setMapping((currentMapping) => ({ ...currentMapping, [field]: value }))} />)}
        </div>
        <InlineMessage type="info">{t("imports.preview", { rows: rawRows.length, columns: headers.length })}</InlineMessage>
        <button className="primary-button" type="button" disabled={pending} onClick={() => void createBatch()}><SearchCheck size={16} />{pending ? t("imports.validating") : t("imports.validate")}</button>
      </>}
      {error && <InlineMessage type="error">{error}</InlineMessage>}
    </section>}

    <section className="import-workspace">
      <div className="surface batch-list">
        <div className="surface-heading"><div><p className="eyebrow">{t("imports.historyEyebrow")}</p><h2>{t("imports.batches")}</h2></div><FileSpreadsheet size={21} /></div>
        {batches.map((item) => <button className={item.id === selected ? "batch-card selected" : "batch-card"} type="button" key={item.id} onClick={() => void open(item.id)}>
          <span><b>{item.filename}</b><small>{item.resourceType} · {formatDate(item.createdAt, { includeTime: true })}</small></span>
          <StatusBadge tone={item.status === "COMPLETED" ? "green" : item.status === "ROLLED_BACK" ? "gray" : item.status.includes("FAILED") ? "red" : "amber"}>{t(`imports.status.${item.status.toLowerCase()}`)}</StatusBadge>
          <small>{t("imports.batchCounts", { total: item.total, duplicates: item.duplicates, failed: item.failed })}</small>
        </button>)}
        <Pagination page={page} totalPages={pages} total={total} pageSize={pageSize} onPage={(next) => { setPage(next); void loadBatches(next); }} onPageSize={(value)=>{setPageSize(value);setPage(1);void loadBatches(1,value);}} />
      </div>

      <div className="surface import-rows">
        <div className="surface-heading"><div><p className="eyebrow">{t("imports.rowsEyebrow")}</p><h2>{current ? current.filename : t("imports.selectBatch")}</h2></div>{current && <StatusBadge tone="blue">{t(`imports.status.${current.status.toLowerCase()}`)}</StatusBadge>}</div>
        {current && dryRun && <div className={`import-dry-run ${dryRun.canExecute ? "ready" : "blocked"}`}><SearchCheck size={20}/><div><b>{t("imports.dryRun")}</b><small>{t("imports.dryRunHelp", { create: dryRun.create, update: dryRun.update, merge: dryRun.merge, skip: dryRun.skip, invalid: dryRun.invalid, unresolved: dryRun.unresolved })}</small></div><StatusBadge tone={dryRun.canExecute ? "green" : "amber"}>{t(dryRun.canExecute ? "imports.dryRunReady" : "imports.dryRunBlocked")}</StatusBadge></div>}
        {rows.map((row) => <article className="import-row" key={row.id}>
          <span>#{row.rowNumber}</span>
          <div>
            <b>{row.normalized.nameZh} / {row.normalized.nameEn}</b>
            <small>{row.normalized.email || row.normalized.phone || row.normalized.city || "—"}</small>
            {row.errors.map((item) => <small className="error-text" key={item.code}>{t(`imports.error.${item.code.toLowerCase()}`)}</small>)}
            {row.lastError && <small className="error-text">{row.lastError}</small>}
          </div>
          <StatusBadge tone={row.status === "APPLIED" ? "green" : row.status === "INVALID" || row.status === "FAILED" ? "red" : row.status === "DUPLICATE" ? "amber" : "blue"}>{t(`imports.rowStatus.${row.status.toLowerCase()}`)}</StatusBadge>
          {(row.status === "INVALID" || row.status === "FAILED") && <button className="secondary-button" type="button" onClick={()=>{setRepairRow(row);setError("");}}>{t("imports.repairRow")}</button>}
          {row.status === "DUPLICATE" && <div className="decision-buttons"><small>{t("duplicates.score", { score: row.score ?? 0 })} · {row.reasons.join(", ")}</small>{["CREATE", "UPDATE", "MERGE", "SKIP"].map((choice) => <button type="button" key={choice} onClick={() => void decide(row, choice)}>{t(`imports.action.${choice.toLowerCase()}`)}</button>)}</div>}
        </article>)}
        {current && rows.length > 0 && <Pagination page={rowPage} totalPages={rowPages} total={rowTotal} pageSize={rowPageSize} onPage={(next) => void open(selected, next)} onPageSize={(value)=>{setRowPageSize(value);void open(selected,1,value);}} />}
        {current && !rows.length && <div className="empty-state"><span>{t("imports.noRows")}</span></div>}
        {current && <div className="import-actions">
          {["READY", "PROCESSING", "PARTIAL_FAILED"].includes(current.status) && !visibleDuplicateRows.length && <button className="primary-button" disabled={pending} onClick={() => void process()}><Play size={16} />{t("imports.execute")}</button>}
          {["COMPLETED", "PARTIAL_FAILED"].includes(current.status) && current.applied > 0 && <button className="danger-button" disabled={pending} onClick={() => setRollbackOpen(true)}><RotateCcw size={16} />{t("imports.rollback")}</button>}
        </div>}
        {error && <InlineMessage type="error">{error}</InlineMessage>}
      </div>
    </section>
    {repairRow&&<AccessibleDrawer title={t("imports.repairRowTitle",{row:repairRow.rowNumber})} description={t("imports.repairRowHelp")} onClose={()=>setRepairRow(null)}><form onSubmit={repair}><div className="form-grid two-column">{targetFields.map(field=><label className="field" key={field}><span>{t(`imports.field.${field}`)}</span><input name={field} defaultValue={repairRow.normalized[field]??""} required={field==="nameZh"||field==="nameEn"}/></label>)}</div>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setRepairRow(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}><Save size={16}/>{pending?t("common.saving"):t("common.save")}</button></div></form></AccessibleDrawer>}
    {rollbackOpen&&current&&<AccessibleDrawer title={t("common.confirmAction")} description={t("common.actionCannotUndo")} onClose={()=>setRollbackOpen(false)}><InlineMessage type="warning">{t("imports.rollbackConfirm",{count:current.applied})}</InlineMessage><div className="drawer-actions"><button className="secondary-button" type="button" onClick={()=>setRollbackOpen(false)}>{t("common.cancel")}</button><button className="danger-button" type="button" disabled={pending} onClick={()=>void rollback()}>{pending?t("common.processing"):t("imports.rollback")}</button></div></AccessibleDrawer>}
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}
