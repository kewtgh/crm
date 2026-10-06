/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
require('tsx/cjs');
const {buildV2Xlsx,buildV2Csv}=require('../lib/import-v2-template.ts');
const {buildSetTemplate}=require('../lib/import-set-template.ts');
const {v2Headers,normalizeV2Row}=require('../lib/import-v2.ts');
const xlsxMime=format=>format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv';
const {zhCN}=require('../lib/i18n/locales/zh-CN.ts'),{en}=require('../lib/i18n/locales/en.ts');
module.exports=async({browser,base,output,report,observe})=>{
 const context=await browser.newContext({bypassCSP:true,acceptDownloads:true});let batches=[],rows=[],lastInput,protocolErrors=[];
 try{
 const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);assert.ok((await page.goto(base+'/api/health'))?.ok());
 await page.route('**/api/imports**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.endsWith('/template')){const r=url.searchParams.get('resource'),kind=url.searchParams.get('kind'),xlsx=url.searchParams.get('format')==='xlsx';return route.fulfill({body:xlsx?await buildV2Xlsx(r,kind):buildV2Csv(r,kind),headers:{'content-type':xlsx?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv','content-disposition':`attachment; filename="${r}-v2.${xlsx?'xlsx':'csv'}"`}});}
  if(url.pathname.endsWith('/references'))return route.fulfill({json:req.method()==='POST'?{token:'ir_'+'a'.repeat(64)}:{items:[{id:'00000000-0000-4000-8000-000000000020',label:'Synthetic selected reference'}]}});
  if(url.pathname.endsWith('/dry-run'))return route.fulfill({json:{summary:{create:rows.filter(r=>r.status==='VALID').length,update:0,merge:0,skip:0,invalid:rows.filter(r=>r.status==='INVALID').length,unresolved:rows.filter(r=>r.status==='DUPLICATE').length,canExecute:rows.every(r=>r.status==='VALID')}}});
  if(req.method()==='GET')return route.fulfill({json:url.searchParams.has('mappingProfiles')?{items:[]}:url.searchParams.has('batch')?{items:rows,total:rows.length}:{items:batches,total:batches.length}});
  const body=req.postDataJSON();lastInput=body;
  if(body.operation==='createV2'){
   rows=body.rows.map((input,i)=>{const result=normalizeV2Row(body.resource,input,body.rowLocations[i],body.sheet);const duplicate=input.nameZh==='DUPLICATE';return {id:'qa-row-'+i,batchId:'qa-batch',rowNumber:body.rowLocations[i],normalized:input,errors:result.errors,status:result.errors.length?'INVALID':duplicate?'DUPLICATE':'VALID',decision:input.operation||'CREATE',duplicateId:null,reasons:duplicate?['DUPLICATE_REVIEW']:[],lastError:null,reviewRevision:1,targetRevision:input.operation==='UPDATE'?'2026-10-06T00:00:00Z':null,templateVersion:'2'};});
   batches=[{id:'qa-batch',resourceType:body.resource,filename:body.filename,templateVersion:'2',executionContract:'CANONICAL_V2',status:rows.some(r=>r.status==='DUPLICATE')?'NEEDS_DECISION':rows.some(r=>r.status==='INVALID')?'PARTIAL_FAILED':'READY',total:rows.length,valid:rows.filter(r=>r.status==='VALID').length,invalid:rows.filter(r=>r.status==='INVALID').length,duplicates:rows.filter(r=>r.status==='DUPLICATE').length,applied:0,failed:0,createdAt:'2026-10-06T00:00:00Z'}];
   return route.fulfill({json:{item:batches[0]}});
  }
  if(body.operation==='decideV2'){const row=rows.find(r=>r.id===body.target_row);row.status='SKIPPED';row.decision=body.chosen_action;return route.fulfill({json:{item:row}});}
  return route.fulfill({json:{item:batches[0]}});
 });
 const bundle=await build({entryPoints:['tests/fixtures/import-v2-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
 await page.setContent('<html lang="zh-CN"><head><title>Imports v2 QA</title></head><body><div id="root"></div></body></html>');
 for(const f of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(f=>f.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+f.replaceAll('\\','/')});await page.addScriptTag({content:bundle.outputFiles[0].text});
 for(const locale of ['zh-CN','en'])for(const width of [1440,375]){
  batches=[];rows=[];await page.setViewportSize({width,height:1000});await page.getByRole('button',{name:locale==='en'?'QA English':'QA 中文',exact:true}).click();await page.getByRole('button',{name:'QA Reset',exact:true}).click();const t=k=>(locale==='en'?en:zhCN)[k];
  for(const resource of ['ORGANIZATIONS','HOUSEHOLDS','CONTACTS']){
   await page.locator('.import-create label').filter({hasText:t('imports.resource')}).locator('select').first().selectOption(resource);
   assert.equal(await page.getByLabel(locale==='en'?'Template version':'模板版本').inputValue(),'2');
   for(const format of ['xlsx','csv']){
    await page.getByLabel(locale==='en'?'Download format':'下载格式').selectOption(format);
    const download=page.waitForEvent('download');await page.getByRole('link',{name:t('ux.import.example'),exact:true}).click();const file=await download;assert.equal(file.suggestedFilename(),`${resource}-v2.${format}`);
    await page.locator('#import-source-file').setInputFiles({name:file.suggestedFilename(),mimeType:xlsxMime(format),buffer:fs.readFileSync(await file.path())});await page.getByRole('button',{name:t('imports.validate'),exact:true}).waitFor();await page.getByRole('button',{name:t('imports.validate'),exact:true}).click();await page.locator('.batch-card b').filter({hasText:file.suggestedFilename()}).waitFor();await page.waitForFunction(()=>!document.querySelector('#import-source-file')?.disabled);assert.equal(lastInput.resource,resource);assert.equal(lastInput.templateVersion,'2');assert.deepEqual(lastInput.headers,v2Headers(resource));
   }
  }
  const resource='CONTACTS',headers=v2Headers(resource),csv=(input)=>headers.join(',')+'\n'+headers.map(h=>input[h]??'').join(',');
  for(const buffer of [await buildV2Xlsx('ORGANIZATIONS','example'),await buildSetTemplate('CONTACTS','example','xlsx')]){
   await page.locator('#import-source-file').setInputFiles({name:'contacts-v2.xlsx',mimeType:xlsxMime('xlsx'),buffer});await page.getByText('TEMPLATE_VERSION_UNSUPPORTED',{exact:true}).first().waitFor();
  }
  await page.locator('#import-source-file').setInputFiles({name:'unknown.csv',mimeType:'text/csv',buffer:Buffer.from('unknown\nvalue')});await page.getByText('UNKNOWN_COLUMN',{exact:true}).first().waitFor();
  await page.locator('#import-source-file').setInputFiles({name:'missing.csv',mimeType:'text/csv',buffer:Buffer.from(csv({operation:'CREATE'}))});await page.getByRole('button',{name:t('imports.validate'),exact:true}).click();await page.getByText(/REQUIRED · CSV:2/).first().waitFor();await page.waitForFunction(()=>!document.querySelector('#import-source-file')?.disabled);
  await page.locator('#import-source-file').setInputFiles({name:'duplicate.csv',mimeType:'text/csv',buffer:Buffer.from(csv({nameZh:'DUPLICATE',email:'synthetic@example.test'}))});await page.getByRole('button',{name:t('imports.validate'),exact:true}).click();await page.locator('.decision-buttons').waitFor();await page.waitForFunction(()=>!document.querySelector('#import-source-file')?.disabled);assert.equal(await page.locator('.decision-buttons button').count(),2);
  await page.locator('#import-source-file').setInputFiles({name:'update.csv',mimeType:'text/csv',buffer:Buffer.from(csv({operation:'UPDATE',targetReference:'ir_'+'a'.repeat(64),phone:'__CLEAR__',title:''}))});await page.getByRole('button',{name:t('imports.validate'),exact:true}).click();await page.getByText(locale==='en'?'Preflight revision: 2026-10-06T00:00:00Z':'预检版本: 2026-10-06T00:00:00Z',{exact:true}).waitFor();assert.equal(lastInput.rows[0].phone,'__CLEAR__');assert.equal(lastInput.rows[0].title,'');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const screenshot=`imports-v2-${locale}-${width}.png`;await page.screenshot({path:path.join(output,screenshot),fullPage:true});report.pages.push({path:'/imports',locale,width,status:'PASS',screenshot,checks:['3 categorized XLSX/CSV example downloads and upload','version/header parity','wrong-resource and unsupported-version XLSX rejected despite filename','unknown column','required row error','duplicate review excludes MERGE/first target','blank/clear payload','target revision','no horizontal overflow']});
 }
 assert.equal(protocolErrors.length,0);report.fixtureBoundary='Actual ImportsPage and production CSS; mocked business APIs. Mutation/RLS/rollback/retention are separately verified with disposable PostgreSQL.';
 }finally{await context.close();}
};
