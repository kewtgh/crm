import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";
import { z } from "zod";
import { bilingualSchema, normalizeBilingualNames } from "../lib/bilingual-names.ts";
import { academicYearOptions, amountError, formatAmount, normalizeAmount, parseTokens } from "../lib/structured-inputs.ts";

const source=file=>readFile(new URL(`../${file}`,import.meta.url),"utf8");

test("either name is sufficient; blanks, wrong types and overlong original names are rejected",()=>{
  const schema=bilingualSchema(z.object({nameZh:z.string().trim().max(4).default(""),nameEn:z.string().trim().max(12).default("")}));
  assert.deepEqual(schema.parse({nameZh:" 测试 "}),{nameZh:"测试",nameEn:"测试"});
  assert.deepEqual(schema.parse({nameEn:"English name"}),{nameZh:"English name",nameEn:"English name"});
  assert.deepEqual(schema.parse({nameZh:"中文",nameEn:"English"}),{nameZh:"中文",nameEn:"English"});
  for(const value of [{},{nameZh:" ",nameEn:"\t"},{nameZh:12,nameEn:"Name"},{nameZh:"太长的中文名字"},{nameEn:"x".repeat(13)}])assert.equal(schema.safeParse(value).success,false);
});

test("partial edits preserve missing counterparts and unrelated nested event payloads",()=>{
  const schema=bilingualSchema(z.object({nameZh:z.string().trim().max(120).optional(),nameEn:z.string().trim().max(160).optional(),status:z.string().optional()}),true);
  assert.deepEqual(schema.parse({nameZh:"新名"}),{nameZh:"新名"});
  assert.deepEqual(schema.parse({nameEn:"New name"}),{nameEn:"New name"});
  assert.deepEqual(schema.parse({status:"ACTIVE"}),{status:"ACTIVE"});
  assert.deepEqual(schema.parse({nameZh:"",nameEn:"New name"}),{nameZh:"New name",nameEn:"New name"});
  assert.equal(schema.safeParse({nameZh:"",nameEn:""}).success,false);
  assert.equal(schema.safeParse({nameZh:" "}).success,false);
  const input={operation:"run",payload:{nameZh:"Only Chinese"}};
  assert.deepEqual(normalizeBilingualNames(input),input);
  const profile=bilingualSchema(z.object({displayNameZh:z.string().trim().default(""),displayNameEn:z.string().trim().default("")}));
  assert.deepEqual(profile.parse({displayNameEn:"Staff"}),{displayNameZh:"Staff",displayNameEn:"Staff"});
  const title=bilingualSchema(z.object({titleZh:z.string().trim().default(""),titleEn:z.string().trim().default("")}));
  assert.deepEqual(title.parse({titleEn:"Opportunity"}),{titleZh:"Opportunity",titleEn:"Opportunity"});
});

test("required indicators follow control constraints and sparse privacy corrections stay optional",async()=>{
  const [css,ui,inputs,imports]=await Promise.all([source("app/globals.css"),source("components/ui.tsx"),source("components/structured-inputs.tsx"),source("components/imports-page.tsx")]);
  assert.match(css,/\.field:has\(input\[required\].*select\[required\],textarea\[required\]\).*::after/);
  assert.match(ui,/required&&<span className="required-indicator"/);
  assert.match(inputs,/\{t\("input.required"\)\}/);
  assert.match(imports,/!importMappingReady\(resource,mapping\)/);
  assert.match(imports,/imports\.nameMappingHelp/);
  assert.match(imports,/<ImportRepairField field=\{field\}/);
  assert.doesNotMatch(imports,/required=\{field==="nameZh"\|\|field==="nameEn"\}/);
  const repair=await source("components/import-repair-field.tsx");
  for(const component of ["RepairDate","MoneyInput","CurrencySelect","AcademicYearInput","TagsInput"])assert.match(repair,new RegExp(`<${component}`));
  assert.match(repair,/edited\?date:value/);
});

test("money formatting keeps exact decimals and submits ungrouped values; zero discount is valid",()=>{
  assert.equal(formatAmount("1234567.50","zh-CN"),"1,234,567.50");
  assert.equal(formatAmount("123456789012345.67","en"),"123,456,789,012,345.67");
  assert.equal(normalizeAmount("1,234.50"),"1234.50");
  assert.equal(formatAmount("","en"),"");
  assert.equal(amountError("0",0),false);
  assert.equal(amountError("0",0.01),true);
  assert.equal(amountError("0.01",0.01),false);
  for(const value of ["1.234","NaN","1e3","-1","Infinity","12x"])assert.equal(amountError(value,0),true,value);
  assert.equal(amountError("101",0,100),true);
});

test("structured choices preserve legacy academic years and bilingual token values",()=>{
  assert.ok(academicYearOptions("legacy-year").includes("legacy-year"));
  assert.ok(academicYearOptions().includes("2026-2027"));
  assert.deepEqual(parseTokens(" IB，AP, IB\n A-Level ",Infinity),["IB","AP","A-Level"]);
  assert.equal(parseTokens(Array.from({length:40},(_,i)=>`Course ${i}`).join(","),Infinity).length,40);
});

test("all literal date/time inputs use a picker; name pairs have shared combined validation",async()=>{
  const directory=new URL("../components/",import.meta.url);
  for(const file of (await readdir(directory)).filter(file=>file.endsWith(".tsx")&&file!=="structured-inputs.tsx")){
    const text=await readFile(new URL(file,directory),"utf8");
    const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function walk(node){
      if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==="input"){
        const attrs=Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(attr=>[attr.name.getText(ast),attr.initializer&&ts.isStringLiteral(attr.initializer)?attr.initializer.text:null]));
        assert.ok(!["date","datetime-local","time","month"].includes(attrs.type),`${file}: native dates must use DateInput`);
        if(["nameZh","nameEn","displayNameZh","displayNameEn"].includes(attrs.name))assert.ok(!node.attributes.properties.some(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(ast)==="required"),`${file}: names cannot each be required`);
      }
      ts.forEachChild(node,walk);
    }
    walk(ast);
    // Privacy corrections are sparse patches: neither name is required when
    // changing only an email/phone. Creation/editing forms use combined validation.
    if(file!=="privacy-requests-workspace.tsx"&&/name="(?:displayNameZh|nameZh)"/.test(text)&&/name="(?:displayNameEn|nameEn)"/.test(text))assert.match(text,/<BilingualNameHint\/>/,file);
  }
});

test("editing APIs apply bilingual validation after field validation, including partial CRM edits",async()=>{
  for(const file of ["products","admin/teams","admin/users","catalog","education","crm/[resource]","automation","growth","leads","settings"]){
    const route=await source(`app/api/${file}/route.ts`);
    const text=file==="automation"?await source("lib/automation-input.ts"):route;
    if(file==="automation"){
      assert.match(route,/automationInputSchema.safeParse/);
      assert.match(text,/automationInputSchema=bilingualSchema\(z.discriminatedUnion/);
    }else assert.match(text,/bilingualSchema\((?:schema|createSchema|resourceSchemas\[resource\])\)\.safeParse/,file);
    assert.doesNotMatch(text,/(?:nameZh|nameEn|displayNameZh|displayNameEn):\s*z\.string\(\)\.trim\(\)\.min\(/,file);
  }
  const partial=await source("app/api/crm/[resource]/[id]/route.ts");
  assert.match(partial,/bilingualSchema\(schemas\[resource\],true\)/);
  assert.match(partial,/expectedUpdatedAt:z\.string\(\)\.datetime\(\{offset:true\}\)/);
  assert.match(await source("app/api/education/route.ts"),/expectedUpdatedAt: z\.iso\.datetime\(\{offset:true\}\)/);
});

test("installments serialize structured date/amount rows and have the API's 24-row limit",async()=>{
  const [editor,finance,css,dialog,migration]=await Promise.all([source("components/installments-editor.tsx"),source("components/finance-page.tsx"),source("app/globals.css"),source("components/ui.tsx"),source("db/migrations/202610010082_single_language_names.sql")]);
  assert.match(editor,/<DateInput/);assert.match(editor,/<MoneyInput/);
  assert.match(editor,/rows\.length>=24/);assert.match(editor,/rows\.length===1/);
  assert.match(editor,/JSON\.stringify\(rows\.map/);
  assert.doesNotMatch(finance,/split\(";"\)|installmentsPlaceholder/);
  assert.match(finance,/name==="discount"\?0:0\.01/);
  assert.match(css,/width: min\(960px, calc\(100vw - 48px\)\)/);
  assert.match(dialog,/className="record-drawer editor-dialog"/);
  assert.match(dialog,/input:not\(\[type='hidden'\]\)/);
  assert.match(migration,/bundle_name_zh\)\) not between 1 and 120/);
  assert.match(migration,/automation_rules_name_zh_check check\(length\(trim\(name_zh\)\) between 1 and 160\)/);
});
