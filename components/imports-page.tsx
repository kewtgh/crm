"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Play, RotateCcw, SearchCheck, Upload } from "lucide-react";
import type { ImportBatchRecord, ImportRowRecord } from "@/lib/phase2-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage, Pagination, SearchableSelect, StatusBadge, Toast } from "./ui";
import { useAppUser } from "./app-user-context";
import { ADMIN_ROLES } from "@/lib/roles";
import { apiFetch } from "@/lib/api-client";

const targetFields = ["nameZh", "nameEn", "email", "phone", "city", "title"];
const rowPageSize = 50;

function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("EMPTY");
  const parse = (line: string) => {
    const cells: string[] = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) {
        cells.push(value.trim());
        value = "";
      } else value += char;
    }
    cells.push(value.trim());
    return cells;
  };
  const headers = parse(lines[0]);
  return {
    headers,
    rows: lines.slice(1).map((line) => {
      const cells = parse(line);
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    }),
  };
}

async function hashText(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
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
  const user = useAppUser();
  const [batches, setBatches] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [resource, setResource] = useState<"CONTACTS" | "ORGANIZATIONS">("CONTACTS");
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState("");
  const [rows, setRows] = useState<ImportRowRecord[]>([]);
  const [rowPage, setRowPage] = useState(1);
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

  const current = batches.find((item) => item.id === selected);
  const visibleDuplicateRows = useMemo(() => rows.filter((item) => item.status === "DUPLICATE"), [rows]);
  const pages = Math.max(1, Math.ceil(total / 10));
  const rowPages = Math.max(1, Math.ceil(rowTotal / rowPageSize));
  const headerOptions = [{ value: "", label: t("imports.ignore") }, ...headers.map((header) => ({ value: header, label: header }))];

  const loadBatches = async (nextPage = page) => {
    try {
      const result = await apiFetch<{ items: ImportBatchRecord[]; total?: number }>(`/api/imports?page=${nextPage}`);
      setBatches(result.items);
      setTotal(result.total ?? 0);
    } catch {
      setError(t("imports.loadFailed"));
    }
  };

  const open = async (id: string, nextRowPage = 1) => {
    setSelected(id);
    try {
      const [result, dryRunResult] = await Promise.all([
        apiFetch<{ items: ImportRowRecord[]; total?: number }>(`/api/imports?batch=${id}&rowPage=${nextRowPage}`),
        apiFetch<{ summary: NonNullable<typeof dryRun> }>(`/api/imports/${id}/dry-run`),
      ]);
      setRows(result.items);
      setRowTotal(result.total ?? 0);
      setRowPage(nextRowPage);
      setDryRun(dryRunResult.summary);
    } catch {
      setError(t("imports.loadFailed"));
      setDryRun(null);
    }
  };

  const chooseFile = async (file: File) => {
    setError("");
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      setFileName(file.name);
      setFileText(text);
      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      const automatic: Record<string, string> = {};
      for (const field of targetFields) {
        const match = parsed.headers.find((header) => header.toLowerCase().replace(/[_\s-]/g, "") === field.toLowerCase());
        if (match) automatic[field] = match;
      }
      setMapping(automatic);
    } catch {
      setError(t("imports.parseFailed"));
    }
  };

  const createBatch = async () => {
    if (!rawRows.length || !mapping.nameZh || !mapping.nameEn) {
      setError(t("imports.mappingRequired"));
      return;
    }
    setPending(true);
    setError("");
    const hash = await hashText(fileText);
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
        body: JSON.stringify({ operation: "rollback", target_batch: selected }),
      });
    } catch {
      setPending(false);
      setError(t("imports.rollbackConflict"));
      return;
    }
    setPending(false);
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
        }),
      });
    } catch {
      setError(t("duplicates.previewFailed"));
      return;
    }
    setMergePreview(null);
    setMergeTarget("");
    setMergeSource("");
    setToast(t("duplicates.mergeSuccess"));
  };

  return <div className="page-stack imports-page">
    <section className="page-heading-row">
      <div>
        <p className="eyebrow">{t(duplicatesOnly ? "duplicates.eyebrow" : "imports.eyebrow")}</p>
        <h1>{t(duplicatesOnly ? "duplicates.title" : "imports.title")}</h1>
        <p>{t(duplicatesOnly ? "duplicates.description" : "imports.description")}</p>
      </div>
    </section>

    {duplicatesOnly && (ADMIN_ROLES.includes(user.role) || user.role === "SALES_DIRECTOR" || user.role === "SALES_MANAGER") && <section className="surface duplicate-merge-panel">
      <div className="surface-heading"><div><p className="eyebrow">CONTROLLED MERGE</p><h2>{t("duplicates.mergePreview")}</h2><p>{t("duplicates.mergeHelp")}</p></div><SearchCheck size={21}/></div>
      <div className="form-grid three-column"><label className="field"><span>{t("imports.resource")}</span><select value={mergeResource} onChange={(event) => { setMergeResource(event.target.value as typeof mergeResource); setMergePreview(null); }}><option value="CONTACTS">{t("imports.contacts")}</option><option value="ORGANIZATIONS">{t("imports.organizations")}</option></select></label><label className="field"><span>{t("duplicates.targetId")}</span><input value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)} pattern="[0-9a-fA-F-]{36}" required/></label><label className="field"><span>{t("duplicates.sourceId")}</span><input value={mergeSource} onChange={(event) => setMergeSource(event.target.value)} pattern="[0-9a-fA-F-]{36}" required/></label></div>
      <button className="secondary-button" type="button" disabled={!mergeTarget || !mergeSource || mergeTarget === mergeSource} onClick={() => void previewMerge()}><SearchCheck size={16}/>{t("duplicates.preview")}</button>
      {mergePreview && <div className="merge-preview">
        <InlineMessage type={mergePreview.recommendedMaster === mergeTarget ? "success" : "warning"}>{t("duplicates.recommendedMaster", { id: mergePreview.recommendedMaster })}{mergePreview.recommendedMaster !== mergeTarget && <button className="inline-action" type="button" onClick={() => { const oldTarget = mergeTarget; const oldSource = mergeSource; setMergeTarget(oldSource); setMergeSource(oldTarget); void previewMerge(oldSource, oldTarget); }}>{t("duplicates.useRecommended")}</button>}</InlineMessage>
        <InlineMessage type="info">{t("duplicates.editableFieldsOnly")}</InlineMessage>
        <div className="merge-fields"><div className="merge-fields-head"><b>{t("duplicates.targetId")}</b><b>{t("duplicates.sourceId")}</b><b>{t("duplicates.confirmMerge")}</b></div>{mergePreview.editableFields.map((key) => <div className="merge-field" key={key}><span><small>{key}</small><b>{String(mergePreview.target[key] ?? "—")}</b></span><span><small>{key}</small><b>{String(mergePreview.source[key] ?? "—")}</b></span><select aria-label={key} value={fieldChoices[key] ?? "TARGET"} onChange={(event) => setFieldChoices((current) => ({ ...current, [key]: event.target.value as "TARGET" | "SOURCE" }))}><option value="TARGET">TARGET</option><option value="SOURCE">SOURCE</option></select></div>)}</div>
        <InlineMessage type="warning">{Object.entries(mergePreview.impact).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</InlineMessage>
        <label className="check-row"><input type="checkbox" checked={mergeConfirmed} onChange={(event) => setMergeConfirmed(event.target.checked)}/><span>{t("duplicates.mergeHelp")}</span></label>
        <button className="danger-button" type="button" disabled={!mergeConfirmed} onClick={() => void mergeRecords()}>{t("duplicates.confirmMerge")}</button>
      </div>}
      {error && <InlineMessage type="error">{error}</InlineMessage>}
    </section>}

    {!duplicatesOnly && <section className="surface import-create">
      <div className="surface-heading"><div><p className="eyebrow">{t("imports.newEyebrow")}</p><h2>{t("imports.newBatch")}</h2></div><Upload size={21} /></div>
      <div className="form-grid two-column">
        <label className="field"><span>{t("imports.resource")}</span><select value={resource} onChange={(event) => setResource(event.target.value as typeof resource)}><option value="CONTACTS">{t("imports.contacts")}</option><option value="ORGANIZATIONS">{t("imports.organizations")}</option></select></label>
        <label className="field file-field"><span>{t("imports.file")}</span><input type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && void chooseFile(event.target.files[0])} /></label>
      </div>
      {headers.length > 0 && <>
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
          <span><b>{item.filename}</b><small>{item.resourceType} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small></span>
          <StatusBadge tone={item.status === "COMPLETED" ? "green" : item.status === "ROLLED_BACK" ? "gray" : item.status.includes("FAILED") ? "red" : "amber"}>{t(`imports.status.${item.status.toLowerCase()}`)}</StatusBadge>
          <small>{t("imports.batchCounts", { total: item.total, duplicates: item.duplicates, failed: item.failed })}</small>
        </button>)}
        <Pagination page={page} totalPages={pages} total={total} pageSize={10} onPage={(next) => { setPage(next); void loadBatches(next); }} />
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
          {row.status === "DUPLICATE" && <div className="decision-buttons"><small>{t("duplicates.score", { score: row.score ?? 0 })} · {row.reasons.join(", ")}</small>{["CREATE", "UPDATE", "MERGE", "SKIP"].map((choice) => <button type="button" key={choice} onClick={() => void decide(row, choice)}>{t(`imports.action.${choice.toLowerCase()}`)}</button>)}</div>}
        </article>)}
        {current && rows.length > 0 && <Pagination page={rowPage} totalPages={rowPages} total={rowTotal} pageSize={rowPageSize} onPage={(next) => void open(selected, next)} />}
        {current && !rows.length && <div className="empty-state"><span>{t("imports.noRows")}</span></div>}
        {current && <div className="import-actions">
          {["READY", "PROCESSING", "PARTIAL_FAILED"].includes(current.status) && !visibleDuplicateRows.length && <button className="primary-button" disabled={pending} onClick={() => void process()}><Play size={16} />{t("imports.execute")}</button>}
          {["COMPLETED", "PARTIAL_FAILED"].includes(current.status) && current.applied > 0 && <button className="danger-button" disabled={pending} onClick={() => void rollback()}><RotateCcw size={16} />{t("imports.rollback")}</button>}
        </div>}
        {error && <InlineMessage type="error">{error}</InlineMessage>}
      </div>
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}
