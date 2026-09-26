import assert from "node:assert/strict";
import test from "node:test";
import { parseCsvDocument, CsvParseError } from "../lib/csv.ts";
import { notificationMutationSchema, notificationReadFilter } from "../lib/notification-mutation.ts";
import { apiFetch } from "../lib/api-client.ts";

test("notification mutation requires explicit all or a nonempty ID selection", () => {
  const id="11111111-1111-4111-8111-111111111111";
  for(const input of [{}, {ids:[]}, {all:false}, {ids:[id],all:true}, {ids:["bad"]}, null]){
    assert.equal(notificationMutationSchema.safeParse(input).success,false);
  }
  assert.equal(notificationReadFilter({all:true}),"read_at=is.null");
  assert.equal(notificationReadFilter({ids:[id,id]}),`read_at=is.null&id=in.(${id})`);
});

test("CSV parsing rejects shifted columns and malformed quotes with row location", () => {
  assert.deepEqual(parseCsvDocument('name,note\n"A, B","said ""hello"""\n').rows,[{name:"A, B",note:'said "hello"'}]);
  for(const [source,code,row] of [
    ["name,note\nA,missing,extra\n","COLUMN_COUNT",2],
    ["name,note\nA\n","COLUMN_COUNT",2],
    ["name,note\nA,hi\"there\n","INVALID_QUOTE",2],
    ["name,note\n\"A,unfinished\n","UNCLOSED_QUOTE",2],
  ]){
    assert.throws(()=>parseCsvDocument(source),error=>error instanceof CsvParseError&&error.code===code&&error.row===row);
  }
  assert.throws(()=>parseCsvDocument("name\nA\nB\n",1),error=>error instanceof CsvParseError&&error.code==="TOO_MANY_ROWS"&&error.row===3);
});

test("API fetch retains Request method and both supported header shapes",async()=>{
  const originalFetch=globalThis.fetch;
  const originalDocument=globalThis.document;
  const calls=[];
  globalThis.document={cookie:"crm_csrf=abcdefghijklmnopqrstuvwxyz0123456789"};
  globalThis.fetch=async(_input,init)=>{calls.push(init);return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json"}});};
  try{
    const request=new Request("http://localhost/api/example",{method:"POST",headers:{"x-request-header":"retained"},body:"{}"});
    await apiFetch(request,{headers:new Headers({"content-type":"application/json"})});
    await apiFetch("http://localhost/api/example",{method:"PATCH",headers:[["x-array-header","retained"]]});
    assert.equal(calls[0].method,"POST");
    assert.equal(calls[0].headers.get("x-request-header"),"retained");
    assert.equal(calls[0].headers.get("content-type"),"application/json");
    assert.equal(calls[0].headers.get("x-csrf-token"),"abcdefghijklmnopqrstuvwxyz0123456789");
    assert.equal(calls[1].headers.get("x-array-header"),"retained");
  }finally{globalThis.fetch=originalFetch;globalThis.document=originalDocument;}
});

test("API fetch retries a consumed Request body after session refresh",async()=>{
  const originalFetch=globalThis.fetch;
  const bodies=[];
  let refreshed=false;
  globalThis.fetch=async(input,init)=>{
    if(typeof input==="string"&&input.startsWith("/api/auth/refresh")){
      refreshed=true;return new Response("{}");
    }
    const sent=new Request(input,init);
    bodies.push(await sent.text());
    return new Response(JSON.stringify(refreshed?{ok:true}:{code:"SESSION_REFRESH_REQUIRED"}),{
      status:refreshed?200:401,headers:{"content-type":"application/json"},
    });
  };
  try{
    assert.deepEqual(await apiFetch(new Request("http://localhost/api/example",{method:"POST",body:'{"value":1}'})),{ok:true});
    assert.deepEqual(bodies,['{"value":1}','{"value":1}']);
  }finally{globalThis.fetch=originalFetch;}
});

test("API fetch preserves cancellation from a Request",async()=>{
  const originalFetch=globalThis.fetch;
  const controller=new AbortController();
  const request=new Request("http://localhost/api/example",{signal:controller.signal});
  controller.abort();
  globalThis.fetch=async(_input,init)=>{
    assert.equal(init.signal.aborted,true);
    init.signal.throwIfAborted();
  };
  try{
    await assert.rejects(apiFetch(request),error=>error.code==="REQUEST_ABORTED");
  }finally{globalThis.fetch=originalFetch;}
});
