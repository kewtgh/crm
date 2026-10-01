import assert from "node:assert/strict";
import test from "node:test";
import { productVersionSchema } from "../lib/product-input.ts";
import { executeProductMutation } from "../lib/product-mutation.ts";
import { ApiClientError } from "../lib/api-client.ts";
import { presentApiError } from "../lib/api-error-presenter.ts";
import { zhV390, enV390 } from "../lib/i18n/locales/v390.ts";

test("product versions accept PostgreSQL offsets without losing microseconds", () => {
  for (const value of ["2026-10-01T12:34:56.123456+00:00", "2026-10-01T20:34:56.123456+08:00", "2026-10-01T12:34:56Z"]) {
    assert.equal(productVersionSchema.parse(value), value);
  }
  for (const value of ["2026-10-01T12:34:56", "2026-02-30T12:34:56Z", "", "invalid"]) {
    assert.equal(productVersionSchema.safeParse(value).success, false);
  }
});

test("a committed product write remains successful when its refresh fails", async () => {
  let writes=0;
  const outcome=await executeProductMutation(async()=>{writes++;return {id:"saved"};}, async()=>{throw new Error("GET failed");});
  assert.deepEqual(outcome,{result:{id:"saved"},refreshed:false});
  assert.equal(writes,1);
});

test("a rejected product write preserves its error and does not refresh", async () => {
  const error=new ApiClientError("PRODUCT_VERSION_CONFLICT",409,"request-123");
  let reads=0;
  await assert.rejects(executeProductMutation(async()=>{throw error;},async()=>{reads++;}),caught=>caught===error);
  assert.equal(reads,0);
});

test("successful product writes refresh exactly once", async () => {
  let reads=0;
  assert.deepEqual(await executeProductMutation(async()=>"saved",async()=>{reads++;}),{result:"saved",refreshed:true});
  assert.equal(reads,1);
});

test("product failures have specific bilingual messages and a request identifier", () => {
  for (const [code,key] of [["PRODUCT_CODE_CONFLICT","products.codeConflict"],["PRODUCT_VERSION_CONFLICT","products.versionConflict"],["PRODUCT_NOT_FOUND","products.notFound"],["DATABASE_SCHEMA_OUTDATED","products.schemaOutdated"]]) {
    for (const messages of [zhV390,enV390]) {
      const result=presentApiError(new ApiClientError(code,409,"request-123"),key=>messages[key]??key,"products.saveFailed");
      assert.equal(result.code,code);
      assert.ok(result.message.startsWith(messages[key]));
      assert.match(result.message,/request-123/);
    }
  }
});
