import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, mkdirSync, writeFileSync} from "node:fs";
import {amountWords, digest, documentFilename, lintDocx, productionEligibility, renderDocx, resolveDocumentFields, unzipDocx, zipDocx, verifyDocumentArtifact} from "../lib/contract-document-engine.mjs";
const catalog = JSON.parse(readFileSync(new URL("../templates/contracts/catalog.json", import.meta.url)));
const fixtureFor = v => JSON.parse(readFileSync(v.fixture_path));
function input(v, fixture = fixtureFor(v)) {
  const confirmed = {}, configuration = {};
  for (const f of v.fields) if (f.category === "USER_CONFIRMED") {
    const source = /^company\./.test(f.key)||v.template_key==="student-program"&&/^bank\./.test(f.key) ? configuration : confirmed;
    if (fixture.confirmed[f.key] !== undefined) source[f.key] = fixture.confirmed[f.key];
  }
  return {confirmed, configuration, context:{canonical:fixture.canonical,sourceId:"SYNTHETIC",sourceRevision:4}};
}
test("real DRAFT templates stay blocked; RETIRED/inactive/unsupported approved cannot generate", () => {
  for (const v of catalog.versions) assert.throws(() => productionEligibility(v,1,[]), /TEMPLATE_NOT_APPROVED/);
  const approved = {...catalog.versions[0],status:"APPROVED",approved_by:"test-checker",approved_at:"2026-10-05",review_items:[]};
  assert.throws(() => productionEligibility({...approved,status:"RETIRED"},1,[]), /TEMPLATE_NOT_APPROVED/);
  assert.throws(() => productionEligibility(approved,null,[]), /TEMPLATE_NOT_APPROVED/);
  assert.throws(() => productionEligibility(approved,1,[{code:"UNSUPPORTED_FIELD"}]), /GENERATION_BLOCKED/);
});
test("both actual masters render deterministically, cross-run and all DOCX parts stay valid", () => {
  for (const v of catalog.versions) {
    const data = readFileSync(v.template_path), i = input(v), resolved = resolveDocumentFields(v,i.context,i.confirmed,i.configuration);
    assert.ok(resolved.issues.some(x => x.code === "UNSUPPORTED_FIELD"));
    const bytes = renderDocx(v,data,resolved.values);
    assert.equal(digest(bytes),digest(renderDocx(v,data,resolved.values)));
    const texts = unzipDocx(bytes).filter(e => e.name.endsWith(".xml")).map(e=>e.data.toString()).join("\n");
    assert.ok(!texts.includes("{{")); assert.ok(texts.includes("C00000"));
    if (v.template_key === "student-program") assert.ok(texts.includes("人民币贰万元整"));
  }
});
test("required Guardian has no inferred fallback; confirmed false is explicit", () => {
  const v = catalog.versions[1], i = input(v); delete i.confirmed["guardian.name"];
  assert.ok(resolveDocumentFields(v,i.context,i.confirmed,i.configuration).issues.some(x=>x.key === "guardian.name"));
  i.confirmed["guardian.required"] = false;
  assert.match(resolveDocumentFields(v,i.context,i.confirmed,i.configuration).values["guardian.name"], /Not applicable/);
});
test("canonical/derived/constants/static/unknown overrides are rejected", () => {
  const v = catalog.versions[1], i = input(v);
  for (const key of ["contract.amount","contract.amount_words","template.review_notice","bank.account","unknown"]) assert.throws(()=>resolveDocumentFields(v,i.context,{...i.confirmed,[key]:"x"},i.configuration), /FIELD_OVERRIDE_FORBIDDEN/);
  assert.throws(()=>resolveDocumentFields(v,i.context,{...i.confirmed,"buyer.signing_name":"{{contract.amount}}"},i.configuration), /FIELD_VALIDATION_FAILED/);
});
test("currency-aware uppercase, decimal limits, fee decomposition and calendar validation", () => {
  assert.equal(amountWords("20000.00","CNY"),"人民币贰万元整");
  assert.equal(amountWords("20000.00","USD"),"USD 20000.00");
  assert.equal(amountWords("100000001.01","CNY"),"人民币壹亿零壹元零壹分");
  assert.throws(()=>amountWords("1e4","CNY"),/INVALID_MONEY/);
  const v=catalog.versions[1],i=input(v);
  assert.throws(()=>resolveDocumentFields(v,i.context,{...i.confirmed,"service.program_component":"1.00"},i.configuration),/FEE_COMPONENT_MISMATCH/);
  assert.throws(()=>resolveDocumentFields(v,i.context,{...i.confirmed,"contract.signing_date":"2026-02-30"},i.configuration),/FIELD_VALIDATION_FAILED/);
});
test("unknown/unused mapping, tamper and XML escaping fail closed", () => {
  const v=catalog.versions[1],data=readFileSync(v.template_path),i=input(v);
  assert.throws(()=>lintDocx({...v,template_sha256:"0".repeat(64)},data),/TEMPLATE_CHECKSUM_MISMATCH/);
  assert.throws(()=>lintDocx({...v,fields:v.fields.filter(f=>f.key!=="participant.name")},data),/UNKNOWN_PLACEHOLDER/);
  assert.throws(()=>lintDocx({...v,fields:[...v.fields,{key:"unused",required:true,allow_override:false}]},data),/UNUSED_REQUIRED_FIELD/);
  i.confirmed["buyer.signing_name"]="合成买方 & <Test>\n第二行";
  const resolved=resolveDocumentFields(v,i.context,i.confirmed,i.configuration);
  const xml=unzipDocx(renderDocx(v,data,resolved.values)).find(e=>e.name==="word/document.xml").data.toString();
  assert.match(xml,/&amp; &lt;Test&gt;/); assert.match(xml,/<w:br\/>/);
});
test("split token across real Word runs and safe filename", () => {
  const v=catalog.versions[1],entries=unzipDocx(readFileSync(v.template_path));
  const body=entries.find(e=>e.name==="word/document.xml");
  body.data=Buffer.from(body.data.toString().replace("{{participant.name}}","{{participant.</w:t></w:r><w:r><w:t>name}}"));
  const bytes=zipDocx(entries),i=input(v),version={...v,template_sha256:digest(bytes)};
  const xml=unzipDocx(renderDocx(version,bytes,resolveDocumentFields(version,i.context,i.confirmed,i.configuration).values)).find(e=>e.name==="word/document.xml").data.toString();
  assert.ok(!xml.includes("{{")); assert.match(xml,/合成参与学生/);
  assert.ok(!documentFilename("../../test\r\n\\escape",1).includes(".."));
});
test("test-only approved clones generate two immutable artifacts without approving real versions", () => {
  mkdirSync("work/v324-phase2/engine-fixtures",{recursive:true});
  for (const original of catalog.versions) {
    const v=structuredClone(original),i=input(v);
    v.status="APPROVED"; v.approved_by="SYNTHETIC_TEST_CHECKER"; v.approved_at="2026-10-05"; v.review_items=[];
    for(const f of v.fields) if(f.category==="UNSUPPORTED") {f.category="TEMPLATE_CONSTANT";f.value="合成技术测试条款 / TEST ONLY — not legal approval";}
    const resolved=resolveDocumentFields(v,i.context,i.confirmed,i.configuration,{id:"test-maker",at:"2026-10-05"});
    productionEligibility(v,1,resolved.issues);
    const data=renderDocx(v,readFileSync(v.template_path),resolved.values);
    writeFileSync(`work/v324-phase2/engine-fixtures/${v.template_key}.docx`,data);
    assert.equal(original.status,"DRAFT");
  }
});

test("download integrity detects modified stored DOCX bytes and truncated artifacts",()=>{
 const bytes=readFileSync(catalog.versions[1].template_path),lineage={bytes:bytes.length,sha256:digest(bytes)};assert.equal(verifyDocumentArtifact(bytes,lineage),true);
 const tampered=Buffer.from(bytes);tampered[tampered.length-1]^=1;assert.equal(verifyDocumentArtifact(tampered,lineage),false);assert.equal(verifyDocumentArtifact(bytes.subarray(1),lineage),false);
});
test("Channel settlement bank is a confirmed counterparty value, not workspace company bank",()=>{
 const v=catalog.versions[0],i=input(v);i.confirmed['bank.account']='CONFIRMED_CHANNEL_BANK';i.configuration['bank.account']='COMPANY_RECEIVING_BANK';const resolved=resolveDocumentFields(v,i.context,i.confirmed,i.configuration,{id:'confirmer',at:'2026-10-05'});assert.equal(resolved.values['bank.account'],'CONFIRMED_CHANNEL_BANK');assert.equal(resolved.evidence.find(f=>f.field_key==='bank.account').confirmed_by,'confirmer');
});
