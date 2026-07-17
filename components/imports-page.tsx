"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Play, RotateCcw, SearchCheck, Upload } from "lucide-react";
import type { ImportBatchRecord, ImportRowRecord } from "@/lib/phase2-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage, Pagination, SearchableSelect, StatusBadge, Toast } from "./ui";

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const current = batches.find((item) => item.id === selected);
  const visibleDuplicateRows = useMemo(() => rows.filter((item) => item.status === "DUPLICATE"), [rows]);
  const pages = Math.max(1, Math.ceil(total / 10));
  const rowPages = Math.max(1, Math.ceil(rowTotal / rowPageSize));
  const headerOptions = [{ value: "", label: t("imports.ignore") }, ...headers.map((header) => ({ value: header, label: header }))];

  const loadBatches = async (nextPage = page) => {
    const response = await fetch(`/api/imports?page=${nextPage}`);
    const result = await response.json() as { items?: ImportBatchRecord[]; total?: number };
    if (response.ok && result.items) {
      setBatches(result.items);
      setTotal(result.total ?? 0);
    }
  };

  const open = async (id: string, nextRowPage = 1) => {
    setSelected(id);
    const response = await fetch(`/api/imports?batch=${id}&rowPage=${nextRowPage}`);
    const result = await response.json() as { items?: ImportRowRecord[]; total?: number };
    if (response.ok && result.items) {
      setRows(result.items);
      setRowTotal(result.total ?? 0);
      setRowPage(nextRowPage);
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
    const response = await fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "create", resource, filename: fileName, content_hash: hash, request_key: `${resource}:${hash}`, mapping, rows: normalized }),
    });
    const result = await response.json() as { item?: ImportBatchRecord };
    setPending(false);
    if (!response.ok || !result.item) {
      setError(t("imports.createFailed"));
      return;
    }
    setPage(1);
    await loadBatches(1);
    await open(result.item.id);
    setToast(t("imports.validated"));
  };

  const decide = async (row: ImportRowRecord, chosenAction: string) => {
    setError("");
    const response = await fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "decide", target_row: row.id, chosen_action: chosenAction }),
    });
    if (!response.ok) {
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
    let status = "PROCESSING";
    for (let index = 0; index < 12 && status === "PROCESSING"; index += 1) {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "process", target_batch: selected, batch_size: 50 }),
      });
      const result = await response.json() as { item?: ImportBatchRecord };
      if (!response.ok || !result.item) {
        setError(t("imports.executeFailed"));
        setPending(false);
        return;
      }
      status = result.item.status;
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
    const response = await fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "rollback", target_batch: selected }),
    });
    setPending(false);
    if (!response.ok) {
      setError(t("imports.rollbackConflict"));
      return;
    }
    await loadBatches();
    await open(selected, rowPage);
    setToast(t("imports.rolledBack"));
  };

  return <div className="page-stack imports-page">
    <section className="page-heading-row">
      <div>
        <p className="eyebrow">{t(duplicatesOnly ? "duplicates.eyebrow" : "imports.eyebrow")}</p>
        <h1>{t(duplicatesOnly ? "duplicates.title" : "imports.title")}</h1>
        <p>{t(duplicatesOnly ? "duplicates.description" : "imports.description")}</p>
      </div>
    </section>

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
