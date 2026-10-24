import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {createRequire} from "node:module";

// Exercise the actual HTTP client resolved by Miniflare, not Node's built-in fetch.
const require=createRequire(import.meta.url);
const miniflareRequire=createRequire(require.resolve("miniflare"));
const {fetch,Agent}=miniflareRequire("undici");

test("Miniflare's HTTP client verifies SRI for lowercase, uppercase and mixed-case algorithms",{timeout:5000},async t=>{
 const body="fictional dependency security fixture";
 const digest=value=>createHash("sha256").update(value).digest("base64");
 const server=createServer((request,response)=>{response.writeHead(200,{"content-type":"text/plain"});response.end(body);});
 const dispatcher=new Agent();
 t.after(async()=>{await dispatcher.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const url=`http://127.0.0.1:${server.address().port}/fictional-fixture`;
 for(const algorithm of ["sha256","SHA256","Sha256"]){
  await assert.rejects(fetch(url,{dispatcher,integrity:`${algorithm}-${digest("different fictional bytes")}`}),error=>error instanceof TypeError&&error.cause?.message==="integrity mismatch",`${algorithm} must reject an incorrect digest`);
  const response=await fetch(url,{dispatcher,integrity:`${algorithm}-${digest(body)}`});
  assert.equal(await response.text(),body,`${algorithm} must accept the correct digest`);
 }
});
