/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report,observe})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  const page=await context.newPage();observe(page);page.setDefaultTimeout(4500);
  const health=await page.goto(base+'/api/health');assert.ok(health?.ok());assert.equal((await health.json()).version,report.evidence.appVersion);
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const requests=[];
  await page.route(base+'/api/**',route=>{
   const url=new URL(route.request().url());requests.push(url.pathname);
   if(url.pathname==='/api/notifications')return route.fulfill({json:{items:[],total:0,unread:0,page:1,pageSize:20}});
   if(url.pathname==='/api/contract-documents')return route.fulfill({json:{canPreviewDraft:false,options:{sourceRevision:1,contexts:[],rules:[]},items:[],templates:[]}});
   if(url.pathname==='/api/imports'&&url.searchParams.has('batch'))return route.fulfill({json:{total:1,items:[{id:id(51),batchId:id(50),rowNumber:3,normalized:{nameZh:'联系人甲',nameEn:'Person A',email:'person@example.test'},status:'INVALID',errors:[{code:'CONTACT_METHOD_REQUIRED',field:'email',column:'email',row:3}],decision:null,duplicateId:null,score:null,reasons:[],lastError:'Synthetic private diagnostic: SELECT * FROM example',reviewRevision:1,templateVersion:'2'}]}});
   if(url.pathname.endsWith('/references'))return route.fulfill({json:{items:[]}});
   return route.fulfill({json:{items:[],total:0,page:1,pageSize:10}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/ux-closure-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>UX closure synthetic QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:`${base}/_next/static/${file.replaceAll('\\','/')}`});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.locator('.sidebar-collapse small').waitFor({state:'attached'});
  assert.equal(await page.locator('.sidebar-collapse small').innerText(),`v${report.evidence.appVersion}`);
  const nav=href=>page.evaluate(href=>window.closureNavigate(href),href);
  const shot=async(label,viewport,checks)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+' overflow');const text=await page.locator('main').innerText();assert.doesNotMatch(text,/undefined|\[object Object\]|Synthetic private diagnostic|SELECT \*|closure\.[a-z]+|quality\.rule\./);await page.screenshot({path:path.join(output,label+'.png')});report.pages.push({label,viewport,checks,boundary:'Actual components and production CSS; synthetic APIs, no DB/RLS evidence.'});process.stdout.write(`[QA closure] ${label} passed\n`);};
  const widths=[{width:1920,height:1080},{width:1440,height:900},{width:375,height:812}];
  for(const viewport of widths){
   await page.setViewportSize(viewport);await nav(`/contracts?focus=${id(1)}`);await page.locator('#selected-contract-context').waitFor();
   const selected=page.locator('.contract-table tr.selected');assert.equal(await selected.count(),1);assert.ok(await selected.locator('input').isChecked());
   assert.match(await page.locator('.contract-context-facts').innerText(),/USD/);assert.equal(await page.locator('main h1').count(),1);
   await selected.locator('.contract-selection-link').focus();await page.keyboard.press('Enter');await page.locator('#selected-contract-context').scrollIntoViewIfNeeded();
   const box=await page.locator('#selected-contract-context').boundingBox();assert.ok(box.y>=0&&box.y<viewport.height);
   await shot(`contracts-selected-${viewport.width}`,viewport,{selectedRadio:true,contextTop:box.y,anchorContinuity:true});
   const tabs=page.getByRole('tablist',{name:'当前合同的关联内容'});await tabs.getByRole('tab').first().focus();await page.keyboard.press('End');
   assert.ok(await tabs.getByRole('tab').last().evaluate(el=>el===document.activeElement));assert.equal(await page.locator('[data-contract-documents]').isVisible(),true);assert.equal(await page.locator('#selected-contract-context').getByText(id(1),{exact:true}).count(),1);
   await shot(`contracts-documents-${viewport.width}`,viewport,{sameSelectedRecord:true,keyboardTabs:true});await page.keyboard.press('Home');
   assert.equal(await page.locator('[data-contract-documents]').isVisible(),false);
  }
  await page.setViewportSize(widths[1]);await nav('/contracts');assert.equal(await page.locator('#selected-contract-context').count(),0);await page.locator('.contract-table input[type=radio]').nth(1).check();assert.match(await page.locator('.contract-context-facts').innerText(),/CNY/);await shot('contracts-row-select-1440',widths[1],{differentRecord:true});
  await page.evaluate(()=>window.closureRole('SALES_SUPPORT'));await nav(`/contracts?focus=${id(1)}`);assert.equal(await page.locator('.contracts-page .page-actions button.primary-button').count(),0);await shot('contracts-readonly-1440',widths[1],{writeActionsAbsent:true});await page.evaluate(()=>window.closureRole('ADMIN'));
  for(const viewport of [widths[0],widths[2]]){
   await page.setViewportSize(viewport);await nav('/products');await page.locator('.product-identity-button').waitFor();assert.equal(await page.locator('.product-identity-button .ux-record-identity small').count(),1);if(viewport.width===375)await page.locator('.product-identity-button').scrollIntoViewIfNeeded();await shot(`products-long-${viewport.width}`,viewport,{localeIdentity:true,catalogBundlesFxPreserved:true});
   await nav('/action-center');await page.locator('.action-center-card').first().waitFor();await page.getByRole('button',{name:'销售',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.action-center-card').count(),1);await shot(`action-center-${viewport.width}`,viewport,{keyboardCategory:true,canonicalProducer:true});
  }
  await page.setViewportSize(widths[0]);await nav('/imports');await page.locator('.batch-card').first().click();await page.locator('.import-row').waitFor();const row=page.locator('.import-row').first();assert.match(await row.innerText(),/检查相关字段/);const details=row.locator('details').first();assert.equal(await details.getAttribute('open'),null);await details.locator('summary').focus();await page.keyboard.press('Enter');assert.match(await details.innerText(),/CONTACT_METHOD_REQUIRED/);await shot('imports-human-first-1920',widths[0],{safeDiagnostics:true,keyboardDisclosure:true});await row.getByRole('button',{name:'修复此行',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok(await row.getByRole('button',{name:'修复此行',exact:true}).evaluate(e=>e===document.activeElement));
  await nav('/data-quality');await page.locator('.quality-row').waitFor();assert.match(await page.locator('.quality-rule-grid').innerText(),/联系人缺少有效沟通方式/);const quality=page.locator('.quality-row details').first();await quality.locator('summary').focus();await page.keyboard.press('Enter');assert.match(await quality.innerText(),/CONTACT_METHOD_MISSING/);await shot('quality-human-first-1920',widths[0],{dictionaryMembership:true,keyboardDisclosure:true,rawDetailsExcluded:true});
  await page.getByRole('button',{name:'QA English',exact:true}).click();await shot('quality-human-first-en-1920',widths[0],{bilingual:true});
  report.closureRequests=requests;
 }finally{await context.close();}
};
