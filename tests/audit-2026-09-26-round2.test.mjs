import assert from "node:assert/strict";
import test from "node:test";
import { normalizeImportSheet } from "../lib/import-sheet.ts";
import { importFields } from "../lib/import-fields.ts";
import { notificationHref } from "../lib/notification-link.ts";
import { apiFetch } from "../lib/api-client.ts";
import { zhCN } from "../lib/i18n/locales/zh-CN.ts";
import { en } from "../lib/i18n/locales/en.ts";

test("historical import repair schemas distinguish resources and reject unknown types", () => {
  assert.ok(importFields("STUDENTS").includes("studentNumber"));
  assert.ok(!importFields("STUDENTS").includes("email"));
  assert.ok(importFields("HOUSEHOLDS").includes("incomeCurrency"));
  assert.ok(importFields("ORGANIZATIONS").includes("campusCount"));
  assert.ok(importFields("CONTACTS").includes("email"));
  for (const value of ["unknown", "__proto__", "constructor"]) assert.deepEqual(importFields(value), []);
});

test("spreadsheet normalization permits empty padding and short rows without losing unheaded data", () => {
  assert.deepEqual(normalizeImportSheet([["name", "note", null], ["A"], ["B", "note", null], [null, " "]]).rows, [{name:"A",note:""},{name:"B",note:"note"}]);
  assert.equal(normalizeImportSheet([["n"], [0], [false]]).rows[0].n, "0");
  for (const [sheet, code, row] of [
    [[["name",null],["A","lost"]],"COLUMN_COUNT",2],
    [[["name"],[null],["A","lost"]],"COLUMN_COUNT",3],
    [[["a","", "c"],[1,2,3]],"DUPLICATE_HEADER",1],
    [[["Name","name"],[1,2]],"DUPLICATE_HEADER",1],
  ]) assert.throws(()=>normalizeImportSheet(sheet), error=>error.code===code&&error.row===row);
  assert.throws(()=>normalizeImportSheet([["n"],["A"],[null],["B"]],1),error=>error.code==="TOO_MANY_ROWS"&&error.row===4);
  assert.throws(()=>normalizeImportSheet([["n"],[null]]),error=>error.code==="EMPTY");
});

test("notification links route valid tasks directly and unknown sources safely", () => {
  const id="11111111-1111-4111-8111-111111111111";
  assert.equal(notificationHref({sourceType:"TASK",sourceId:id}),`/tasks/${id}`);
  assert.equal(notificationHref({sourceType:"TASK",sourceId:"//example.com"}),"/tasks");
  assert.equal(notificationHref({sourceType:"CONTRACT",sourceId:id}),"/contracts");
  assert.equal(notificationHref({sourceType:"APPOINTMENT",sourceId:id}),"/calendar");
  assert.equal(notificationHref({sourceType:"EXPORT",sourceId:id}),"/reports/exports");
  assert.equal(notificationHref({sourceType:null,sourceId:null}),"/notifications");
  for(const messages of [zhCN,en]) {
    assert.notEqual(messages["meta.messages"],messages["nav.notifications"]);
    assert.ok(messages["notifications.refresh"]);
    assert.ok(messages["notifications.loading"]);
    assert.ok(messages["imports.loadFailed"]);
  }
});

test("API body cancellation keeps cancellation semantics on success and error responses", async () => {
  const originalFetch=globalThis.fetch;
  try {
    for(const status of [200,401]) {
      const controller=new AbortController();
      globalThis.fetch=async(_input,init)=>new Response(new ReadableStream({start(stream){
        init.signal.addEventListener("abort",()=>stream.error(init.signal.reason),{once:true});
        queueMicrotask(()=>controller.abort());
      }}),{status,headers:{"content-type":"application/json"}});
      await assert.rejects(apiFetch("/api/test",{signal:controller.signal}),error=>error.code==="REQUEST_ABORTED");
    }
  } finally {globalThis.fetch=originalFetch;}
});

test("API response-body timeout is not reported as malformed JSON", async () => {
  const originalFetch=globalThis.fetch;
  const keepAlive=setTimeout(()=>{},1000);
  globalThis.fetch=async(_input,init)=>new Response(new ReadableStream({start(stream){
    init.signal.addEventListener("abort",()=>stream.error(init.signal.reason),{once:true});
  }}),{headers:{"content-type":"application/json"}});
  try {await assert.rejects(apiFetch("/api/test",{},true,10),error=>error.code==="REQUEST_TIMEOUT");}
  finally {globalThis.fetch=originalFetch;clearTimeout(keepAlive);}
});

test("cancelling one refresh waiter does not cancel the shared refresh", async () => {
  const originalFetch=globalThis.fetch;
  const controller=new AbortController();
  let finishRefresh;
  let refreshed=false;
  let refreshCalls=0;
  globalThis.fetch=async(input)=>{
    if(input.startsWith("/api/auth/refresh")) {
      refreshCalls++;
      await new Promise(resolve=>{finishRefresh=resolve;});
      refreshed=true;
      return new Response("{}");
    }
    return new Response(JSON.stringify(refreshed?{ok:true}:{code:"SESSION_REFRESH_REQUIRED"}),{status:refreshed?200:401,headers:{"content-type":"application/json"}});
  };
  try {
    const cancelled=apiFetch("/api/test",{signal:controller.signal});
    const retained=apiFetch("/api/test");
    const rejection=assert.rejects(cancelled,error=>error.code==="REQUEST_ABORTED");
    await new Promise(resolve=>setImmediate(resolve));
    controller.abort();
    await rejection;
    assert.equal(refreshCalls,1);
    finishRefresh();
    assert.deepEqual(await retained,{ok:true});
  } finally {finishRefresh?.();globalThis.fetch=originalFetch;}
});
