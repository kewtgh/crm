import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertObjectKey, verifyLocalObjectToken } from "../lib/storage/object-store.ts";

test("existing artifact storage retains scoped key and signed-token validation", () => {
  assert.equal(assertObjectKey("exports/synthetic-workspace/synthetic-job.docx"), "exports/synthetic-workspace/synthetic-job.docx");
  for (const key of ["templates/any.docx", "exports/../outside.docx", "exports/a//b", "exports/a\\b"]) {
    assert.throws(() => assertObjectKey(key), /INVALID_OBJECT_KEY/);
  }
  assert.equal(verifyLocalObjectToken("invalid.payload.extra"), null);
  assert.equal(verifyLocalObjectToken("forged.token"), null);
});

test("template foundation does not silently convert tabular jobs or Contract approval semantics", async () => {
  const source = async (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
  const [worker, versions, approval] = await Promise.all([
    source("scripts/process-generated-jobs.mjs"),
    source("db/migrations/202607170011_sales_intelligence.sql"),
    source("db/migrations/202608110075_structured_profiles_teams_and_terminal_approvals.sql"),
  ]);
  assert.match(worker, /const exportFormats=new Set\(\["CSV","XLSX","PDF"\]\)/);
  assert.match(worker, /async function contractExport\(job\)/);
  assert.match(versions, /contract_id uuid not null references public\.contracts/);
  assert.match(approval, /request_type in \('CONTRACT_SIGN','CONTRACT_EXPORT'/);
});
