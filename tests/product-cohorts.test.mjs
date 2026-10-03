import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { cohortDataSchema, saveCohortSchema, cohortDatabaseData } from "../lib/cohort-input.ts";
import { listProductCohorts, getProductCohort, saveProductCohort } from "../lib/cohort-repository.ts";
import { ApiClientError } from "../lib/api-client.ts";
import { presentApiError } from "../lib/api-error-presenter.ts";
import { enCohorts, zhCohorts } from "../lib/i18n/locales/cohorts.ts";

const data = {productId: randomUUID(), code: "GAPP-FALL-2027", nameZh: "GAPP 秋季", nameEn: "GAPP Fall",
  intakeType: "FALL", academicYear: "2027-28", applicationOpenOn: "2027-01-01", applicationDeadline: "2027-06-01",
  startOn: "2027-09-01", endOn: "2028-05-31", targetEnrollment: 20, capacity: 30, status: "RECRUITING", defaultCurrency: "USD", ownerId: null};
test("valid create, unknown dates/capacity, zero target and bilingual fallback", () => {
  assert.equal(saveCohortSchema.parse({id: randomUUID(), expectedRevision: null, requestKey: randomUUID(), data}).data.capacity, 30);
  assert.equal(cohortDataSchema.parse({...data, nameZh: "", nameEn: "E".repeat(120)}).nameZh.length, 120);
  assert.ok(cohortDataSchema.safeParse({...data, applicationOpenOn: null, applicationDeadline: null, startOn: null, endOn: null, targetEnrollment: 0, capacity: null}).success);
  assert.equal(cohortDataSchema.safeParse({...data, nameZh: "", nameEn: ""}).success, false);
});
test("all known dates retain order even with NULL gaps", () => {
  for (const patch of [
    {applicationDeadline: "2027-10-01"}, {endOn: "2027-08-01"},
    {applicationDeadline: null, applicationOpenOn: "2027-10-01"},
    {startOn: null, endOn: "2027-05-01"}, {applicationDeadline: "2027-02-30"},
  ]) assert.equal(cohortDataSchema.safeParse({...data, ...patch}).success, false);
});
test("negative, fractional, oversized and over-capacity targets are rejected", () => {
  for (const patch of [{targetEnrollment: -1}, {capacity: -1}, {capacity: 19}, {targetEnrollment: 1.5}, {capacity: 2147483648}])
    assert.equal(cohortDataSchema.safeParse({...data, ...patch}).success, false);
});
test("strict contract rejects invalid enums, revisions, code, currency and injected server fields", () => {
  for (const patch of [{status: "ENROLLED"}, {intakeType: "AUTUMN"}, {code: "bad code"}, {defaultCurrency: "usd"}, {workspaceId: randomUUID()}])
    assert.equal(cohortDataSchema.safeParse({...data, ...patch}).success, false);
  for (const revision of [0, -1, 1.5]) assert.equal(saveCohortSchema.safeParse({id: randomUUID(), expectedRevision: revision, requestKey: randomUUID(), data}).success, false);
});
test("repository preserves NULLs, workspace identity, revisions and RPC retry tokens", async () => {
  const calls = [], id = randomUUID(), workspaceId = randomUUID();
  const row = {...cohortDatabaseData(data), id, workspace_id: workspaceId, revision: 2, created_by: null, created_at: "2026-10-03", updated_at: "2026-10-04"};
  const adapter = async (url, init) => { calls.push({url, init}); return url.includes("/rpc/") ? row : [row]; };
  const list = await listProductCohorts(data.productId, {status: "RECRUITING", page: 2}, adapter);
  assert.equal(list[0].workspaceId, workspaceId); assert.equal(list[0].revision, 2); assert.equal(list[0].ownerId, null);
  const query = new URL(calls[0].url, "http://localhost").searchParams;
  assert.equal(query.get("product_id"), `eq.${data.productId}`); assert.equal(query.get("status"), "eq.RECRUITING"); assert.equal(query.get("offset"), "50");
  assert.equal((await getProductCohort(id, adapter)).id, id);
  assert.equal(await getProductCohort(id, async () => []), null);
  const input = {id, expectedRevision: 1, requestKey: randomUUID(), data};
  assert.equal((await saveProductCohort(input, adapter)).revision, 2);
  const payload = JSON.parse(calls.at(-1).init.body);
  assert.deepEqual(payload, {record_id: id, expected_revision: 1, p_request_key: input.requestKey, data: cohortDatabaseData(data)});
});
test("cohort errors have matching bilingual messages and request IDs", () => {
  assert.deepEqual(Object.keys(enCohorts).sort(), Object.keys(zhCohorts).sort());
  for (const [code, key] of [["COHORT_VERSION_CONFLICT", "cohorts.versionConflict"], ["COHORT_CODE_CONFLICT", "cohorts.codeConflict"], ["COHORT_PARENT_IMMUTABLE", "cohorts.parentImmutable"], ["COHORT_REQUEST_CONFLICT", "cohorts.requestConflict"]]) {
    for (const messages of [enCohorts, zhCohorts]) {
      const result = presentApiError(new ApiClientError(code, 409, "cohort-request"), key => messages[key] ?? key, "cohorts.saveFailed");
      assert.ok(result.message.startsWith(messages[key])); assert.match(result.message, /cohort-request/);
    }
  }
});
