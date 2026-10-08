import assert from "node:assert/strict";
import test from "node:test";
import {readFile,readdir} from "node:fs/promises";
import {importFieldContract,importRelations,contractField,requireContractCreateFields,contractUpdatePatch,normalizeContractEnum,normalizeContractMoney,resolveContractReference,requireContractOwner} from "../lib/import-field-contract.ts";
import {importFieldsByResource} from "../lib/import-fields.ts";
import {businessConfig} from "../lib/education-business.ts";
import {buildImportTemplate} from "../lib/import-template.ts";
import {parseCsvDocument} from "../lib/csv.ts";
const source = file => readFile(new URL(`../${file}`,import.meta.url),"utf8");
const ddlNumbers = new Set(["001","005","040","075","076","078","083","087","091","092","098"]);
const ddlFiles = (await readdir(new URL("../db/migrations/",import.meta.url))).filter(file => ddlNumbers.has(file.match(/^\d{9}(\d{3})_/)?.[1]) && !file.includes("user_identity"));
const ddl = (await Promise.all(ddlFiles.map(file => source(`db/migrations/${file}`)))).join("\n");
function hasColumn(table,column) {
  return ddl.split(";").some(statement => {
    const declaration = statement.match(new RegExp(`(?:create table(?: if not exists)?|alter table(?: if exists)?) public\\.${table}\\b([\\s\\S]*)`,"i"));
    return declaration && new RegExp(`(?:^|[\\n,(]|add (?:column )?(?:if not exists )?)\\s*${column}\\s+(?:text|uuid|citext|boolean|integer|smallint|int|numeric|date|timestamp|timestamptz)\\b`,"i").test(declaration[1]);
  });
}

test("contract fields have unique resource identity and trace actual canonical DDL",()=>{
  const keys = new Set();
  assert.ok(ddlFiles.length >= 10);
  for(const field of importFieldContract) {
    const key = `${field.resource}:${field.key}`;
    assert.ok(!keys.has(key),key);keys.add(key);
    assert.ok(field.validation && field.required,key);
    if(field.table) assert.ok(hasColumn(field.table,field.column),`${key} → ${field.table}.${field.column}`);
    else assert.equal(field.support,"REQUIRES_DOMAIN_EXTENSION",key);
  }
});
test("eligible fields have a real repository mutation owner, not spreadsheet-only storage",async()=>{
  for(const mutation of new Set(importFieldContract.filter(f=>f.support==="SUPPORTED_IMPORT").map(f=>f.mutation))) {
    const [file,methods] = mutation.split("#");
    const text = await source(file);
    for(const method of methods.split(/\s*(?:\/|→)\s*/)) assert.ok(text.includes(method),`${file}: ${method}`);
  }
});
test("legacy headers remain complete and byte-compatible; no v2 template is enabled",()=>{
  for(const [resource,headers] of Object.entries(importFieldsByResource)) {
    assert.deepEqual(importFieldContract.filter(f=>f.resource===resource&&f.currentHeader).map(f=>f.key).sort(),[...headers].sort());
    const csv = parseCsvDocument(buildImportTemplate(resource,"example","en",key=>key));
    assert.deepEqual(csv.headers,headers);
  }
});
test("reverse coverage includes every actual Organization and Household profile form field",()=>{
  for(const [resource,key] of [["ORGANIZATIONS","organizations"],["HOUSEHOLDS","needs"]]) {
    for(const field of businessConfig[key].fields) {
      const item = contractField(resource,`profile.${field.key}`);
      assert.equal(item.table,businessConfig[key].table);
      assert.equal(item.column,field.key);
      assert.equal(item.currentHeader,false);
    }
  }
});
test("reverse coverage includes actual Contact create/edit fields beyond the five legacy columns",async()=>{
  const text = await source("app/api/crm/[resource]/route.ts");
  const people = text.split("people:baseRecordSchema.extend({")[1].split("}).refine")[0];
  const keys = [...people.matchAll(/(?:^|[,\n])\s*([a-zA-Z]+):z\./g)].map(m=>m[1]);
  assert.ok(keys.length > 10);
  for(const key of keys) assert.ok(importFieldContract.some(f=>f.resource==="CONTACTS"&&f.key===key),key);
  for(const key of ["shortName","address","organizationType"]) assert.equal(contractField("ORGANIZATIONS",key).currentHeader,false);
});
test("create/update distinguish identity, record status, relationship and server controls",()=>{
  assert.equal(contractField("STUDENTS","personId").update,false);
  assert.equal(contractField("CONTACTS","organizationId").update,false);
  assert.equal(contractField("CONTACTS","status").create,false);
  assert.equal(contractField("CONTACTS","contactStatus").create,true);
  for(const key of ["id","workspace_id","created_at","updated_at","revision","audit","guardianAuthorization"]) assert.throws(()=>contractField("CONTACTS",key),/UNKNOWN_OR_UNSUPPORTED_FIELD/);
  assert.throws(()=>contractUpdatePatch("STUDENTS",{personId:"new"}),/FIELD_NOT_UPDATEABLE/);
  assert.throws(()=>contractUpdatePatch("COHORTS",{nameZh:"change"}),/FIELD_NOT_UPDATEABLE/);
});
test("UPDATE blanks retain existing values and do not silently clear arrays, income or relationships",()=>{
  const before={phone:"123",title:"Teacher"};
  const patch=contractUpdatePatch("CONTACTS",{phone:"  ",title:null});
  assert.deepEqual({...before,...patch},before);
  assert.deepEqual(contractUpdatePatch("HOUSEHOLDS",{annualIncomeAmount:"",address:undefined}),{});
  assert.deepEqual(contractUpdatePatch("ORGANIZATIONS",{parentOrganizationId:"",courseCategories:""}),{});
  assert.deepEqual(contractUpdatePatch("ORGANIZATIONS",{courseCategories:[]}),{});
  assert.deepEqual(contractUpdatePatch("HOUSEHOLDS",{annualIncomeAmount:"0.00"}),{annualIncomeAmount:"0.00"});
  assert.throws(()=>contractUpdatePatch("CONTACTS",{phone:"__CLEAR__"}),/EXPLICIT_CLEAR_PROTOCOL_NOT_ENABLED/);
});
test("CREATE enforces canonical required groups without requiring optional sensitive collection",()=>{
  requireContractCreateFields("CONTACTS",{nameZh:"新联系人",phone:"123"});
  requireContractCreateFields("HOUSEHOLDS",{nameEn:"Family"});
  assert.throws(()=>requireContractCreateFields("CONTACTS",{nameZh:"Name"}),/REQUIRED/);
  assert.throws(()=>requireContractCreateFields("ORGANIZATIONS",{nameZh:"School"}),/REQUIRED:city/);
  assert.throws(()=>requireContractCreateFields("STUDENTS",{currentGrade:"G1",academicYear:"2026"}),/REQUIRED:personId/);
  assert.throws(()=>requireContractCreateFields("CONTACTS",{nameZh:"Name",phone:"123",status:"VERIFIED"}),/FIELD_NOT_CREATEABLE/);
});
test("reverse coverage includes Household form, Organization core and Student profile contracts",async()=>{
  const education=await source("app/api/education/route.ts");
  const household=education.split('operation: z.literal("createHousehold")')[1].split("z.object({ operation:")[0];
  for(const m of household.matchAll(/\b([a-zA-Z]+):\s*z\./g)) assert.ok(importFieldContract.some(f=>f.resource==="HOUSEHOLDS"&&f.key===m[1]),m[1]);
  const crm=await source("app/api/crm/[resource]/route.ts");
  const organization=crm.split("schools:baseRecordSchema.extend({")[1].split("people:baseRecordSchema")[0];
  for(const m of organization.matchAll(/\b([a-zA-Z]+):z\./g)) assert.ok(importFieldContract.some(f=>f.resource==="ORGANIZATIONS"&&f.key===m[1]),m[1]);
  const student=education.split('operation: z.literal("createStudent")')[1].split("z.object({ operation:")[0];
  // Native identity creation names belong to Contact; retry identity is not an import field.
  for(const m of student.matchAll(/\b([a-zA-Z]+):\s*z\./g)) if(!["requestKey","nameZh","nameEn"].includes(m[1])) assert.ok(importFieldContract.some(f=>f.resource==="STUDENTS"&&f.key===(m[1]==="grade"?"currentGrade":m[1])),m[1]);
});
test("enum labels are documentation; only explicitly contracted codes normalize",()=>{
  assert.equal(normalizeContractEnum("contactType"," PARENT "),"PARENT");
  for(const value of ["家长","parent","Guardian","UNKNOWN"]) assert.throws(()=>normalizeContractEnum("contactType",value),/INVALID_ENUM/);
});
test("reference ambiguity is an error; hidden, foreign and missing references are indistinguishable",()=>{
  const visible=id=>({id,workspaceId:"w",visible:true});
  assert.throws(()=>resolveContractReference("w",[visible("org-a"),visible("org-b")]),/AMBIGUOUS_REFERENCE/);
  assert.equal(resolveContractReference("w",[visible("org-a"),visible("org-a")]),"org-a");
  for(const candidates of [[],[{id:"secret",workspaceId:"w",visible:false}],[{id:"foreign",workspaceId:"x",visible:true}]]) assert.throws(()=>resolveContractReference("w",candidates),/^Error: INVALID_REFERENCE$/);
});
test("owner reference rejects inactive, hidden, foreign and nonassignable users",()=>{
  const owner={id:"staff",workspaceId:"w",visible:true,active:true,assignable:true};
  assert.equal(requireContractOwner("w",owner),"staff");
  for(const patch of [{active:false},{assignable:false},{visible:false},{workspaceId:"other"}]) assert.throws(()=>requireContractOwner("w",{...owner,...patch}),/INVALID_REFERENCE/);
});
test("money stays decimal text, preserving cents without float or implicit FX",()=>{
  assert.equal(normalizeContractMoney("999999999999.99"),"999999999999.99");
  assert.equal(normalizeContractMoney("000020.5"),"20.50");
  for(const value of [1.23,"1e4","NaN","-1","1.001","1,000","¥20"]) assert.throws(()=>normalizeContractMoney(value),/INVALID_DECIMAL/);
});
test("sensitive optional fields inherit privacy; income is distinct from education budget",()=>{
  for(const key of ["annualIncomeAmount","familyBackgroundMarkdown","address"]) assert.equal(contractField("HOUSEHOLDS",key).sensitive,true);
  for(const key of ["email","phone","notesMarkdown","wechatId"]) assert.equal(contractField("CONTACTS",key).sensitive,true);
  assert.equal(contractField("HOUSEHOLDS","profile.budget_min").table,"family_education_needs");
  assert.equal(contractField("HOUSEHOLDS","annualIncomeAmount").table,"households");
});
test("relation identity follows canonical uniqueness, not guessed name or guardian authority",()=>{
  assert.deepEqual(importRelations.find(r=>r.key==="HOUSEHOLD_MEMBER").identity,["household_id","contact_id"]);
  assert.deepEqual(importRelations.find(r=>r.key==="STUDENT_GUARDIAN").identity,["student_id","guardian_contact_id"]);
  assert.equal(importRelations.find(r=>r.key==="ORGANIZATION_CONTACT").table,"contacts");
  assert.equal(importRelations.find(r=>r.key==="CONTACT_CONTACT").table,"organization_contact_relationships");
  for(const relation of importRelations) for(const column of [...relation.identity,...relation.parents]) assert.ok(hasColumn(relation.table,column),`${relation.table}.${column}`);
});
test("Enrollment compatibility retains canonical lifecycle and history, not direct INSERT",async()=>{
  const sql = await source("db/migrations/202610040094_operational_readiness.sql");
  const process = sql.split("create function public.process_import_batch(")[1]?.split("create function public.repair_import_row(")[0];
  assert.ok(process?.includes("public.save_student_enrollment"));
  assert.ok(!process.includes("insert into public.student_enrollments"));
  assert.match(await source("db/migrations/202610030092_student_enrollments.sql"),/insert into public.student_enrollment_status_history/);
});
test("contract evaluation is pure and never changes normalized inputs or source objects",()=>{
  const row=Object.freeze({phone:"",title:"Teacher"});
  const sourceRecord=Object.freeze({phone:"123",title:"Old"});
  assert.deepEqual({...sourceRecord,...contractUpdatePatch("CONTACTS",row)},{phone:"123",title:"Teacher"});
  assert.deepEqual(sourceRecord,{phone:"123",title:"Old"});
  assert.deepEqual(row,{phone:"",title:"Teacher"});
});
