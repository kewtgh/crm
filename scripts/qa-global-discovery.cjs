/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  require('tsx/cjs');const {en}=require('../lib/i18n/locales/en.ts');
  const {globalRecordTypes,interleaveGlobalResults,visibleGlobalRecordTypes}=require('../lib/global-search-contract.ts'),{APP_ROLES}=require('../lib/roles.ts');
  const {financeChartFixture,financeId:id}=require('../tests/fixtures/analytics-finance.ts');
  const {discoveryContract,discoveryContractSummary}=require('../tests/fixtures/global-discovery-data.ts');
  const page=await context.newPage();page.setDefaultTimeout(3000);page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message.slice(0,200)}));
  assert.equal((await(await page.goto(base+'/api/health')).json()).version,report.evidence.appVersion);
  let failed=[],serverRole='ADMIN',transportFailure=false,held=null,holdNext=false,heldReady=()=>{};
  const searches=[],creates=[],contractReads=[],financeReads=[];
  function response(params){const query=params.get('q'),scope=params.get('type')||'all',types=visibleGlobalRecordTypes(serverRole).filter(type=>scope==='all'||scope===type);const groups=types.map(type=>failed.includes(type)?[]:Array.from({length:8},(_,n)=>({id:id(globalRecordTypes.indexOf(type)*10+n+1),type,labelZh:`${query} 示例 ${type} ${n+1} ${'长名称'.repeat(8)}`,labelEn:`${query} Fictional ${type} ${n+1} ${'Long name '.repeat(8)}`})));return{query,scope,...interleaveGlobalResults(groups,query),sources:types.map((type,index)=>({type,status:failed.includes(type)?'FAILED':'READY',returned:groups[index].length}))};}
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/api/search/global'){
    searches.push(Object.fromEntries(url.searchParams));if(transportFailure)return route.fulfill({status:503,json:{code:'GLOBAL_SEARCH_FAILED'}});
    const result=response(url.searchParams);if(holdNext){holdNext=false;held={route,result};heldReady();return;}return route.fulfill({json:result});
   }
   if(url.pathname==='/api/calendar'&&request.method()==='POST'){const body=request.postDataJSON();creates.push(body);return route.fulfill({status:201,json:{item:{id:id(900),event_version:1}}});}
   if(url.pathname==='/api/contracts'){contractReads.push(Object.fromEntries(url.searchParams));return route.fulfill({json:{items:[discoveryContract],total:1,summary:discoveryContractSummary}});}
   if(url.pathname==='/api/contract-documents')return route.fulfill({json:{canPreviewDraft:false,items:[],templates:[],options:{contexts:[],rules:[],sourceRevision:1}}});
   if(url.pathname==='/api/finance'){financeReads.push(Object.fromEntries(url.searchParams));return route.fulfill({json:financeChartFixture()});}
   return route.fulfill({json:{items:[],total:0}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/global-discovery-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome156',alias:{'next/link':path.resolve('tests/fixtures/qa-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx'),'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional discovery QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>Boolean(window.discoveryView));
  const view=name=>page.evaluate(name=>window.discoveryView(name),name),locale=value=>page.evaluate(value=>window.discoveryLocale(value),value);
  async function search(value,mobile=false){if(mobile&&!await page.locator('.mobile-global-search').count())await page.locator('.mobile-search-trigger').click();const input=page.locator(mobile?'.mobile-global-search input[role=combobox]':'.global-search-wrap input[role=combobox]');await input.fill(value);return input;}
  const settled=()=>page.waitForFunction(()=>{const list=Array.from(document.querySelectorAll('.global-search-options')).find(node=>node.getClientRects().length);return list?.getAttribute('aria-busy')==='false'&&list.querySelector('a[data-source=record]');});
  async function shot(label,checks){await page.evaluate(()=>document.fonts.ready);const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,duplicatedSelectors:Array.from(document.querySelectorAll('.date-picker-control')).some(node=>node.querySelectorAll('button').length!==1)}));assert.equal(metrics.overflow,false,label+' horizontal overflow');assert.equal(metrics.duplicatedSelectors,false,label+' duplicated date/time selector');const screenshot=path.join(output,label+'.png');await page.screenshot({path:screenshot});report.pages.push({label,url:page.url(),viewport:page.viewportSize(),screenshot,checks,metrics});}
  for(const [lang,width] of [['zh-CN',1440],['en',1440],['zh-CN',375],['en',375]]){
   await page.setViewportSize({width,height:900});await locale(lang);const mobile=width<680;await search('Fictional',mobile);await settled();
   const panel=page.locator(mobile?'.mobile-global-results':'.global-results');await panel.locator('select').selectOption('all');await settled();assert.equal(await panel.locator('[data-source=record]').count(),16);
   await panel.locator('select').selectOption('TASK');await settled();assert.equal(await panel.locator('[data-source=record]').count(),8);assert.equal(searches.at(-1).type,'TASK');
   await shot('discovery-'+lang+'-'+width,['fair suggestions','record type focus','long bilingual names','bounded listbox','single search owner']);
   await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1440,height:1000});await locale('en');let input=await search('Fictional');await page.locator('.global-results select').selectOption('all');await settled();
  failed=['CONTACT'];await input.fill('Coverage');await settled();await page.getByText(en['discovery.partial'],{exact:true}).waitFor();assert.ok(await page.locator('.global-results [data-source=record]').count()>0);
  const beforeRetry=searches.length;await page.waitForTimeout(250);assert.equal(searches.length,beforeRetry);failed=[];await page.getByRole('button',{name:en['discovery.retry'],exact:true}).click();await settled();await page.getByText(en['discovery.partial'],{exact:true}).waitFor({state:'hidden'});
  failed=[...globalRecordTypes];await input.fill('tasks');await page.getByText(en['discovery.failed'],{exact:true}).waitFor();assert.ok(await page.locator('.global-results [data-source=page]').count()>0);failed=[];
  const beforePages=searches.length;await page.locator('.global-results select').selectOption('pages');await input.fill('calendar');await page.waitForTimeout(250);assert.equal(searches.length,beforePages);assert.ok(await page.locator('.global-results [data-source=page]').count()>0);
  await page.locator('.global-results select').selectOption('all');await settled();
  const heldPromise=new Promise(resolve=>{heldReady=resolve;});holdNext=true;await input.fill('Slow');await heldPromise;await input.fill('Current');await settled();await held.route.fulfill({json:held.result}).catch(()=>{});await page.waitForTimeout(80);assert.equal(await page.locator('.global-results [data-source=record] b').first().textContent().then(text=>text.startsWith('Current')),true);
  await input.press('ArrowDown');const href=await page.locator('.global-results [role=option][aria-selected=true]').getAttribute('href');assert.ok(href);
  const beforeIme=page.url();await input.evaluate(element=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,isComposing:true})));await page.waitForTimeout(80);assert.equal(page.url(),beforeIme);
  await shot('discovery-recovery',['partial source recovery','no automatic retry','pages-only avoids queries','late response rejected','IME Enter preserved']);await page.keyboard.press('Escape');
  const role=APP_ROLES.find(role=>!visibleGlobalRecordTypes(role).includes('QUOTE'));serverRole=role;await page.evaluate(role=>window.discoveryRole(role),role);await page.waitForFunction(role=>document.querySelector('[data-discovery-role]')?.getAttribute('data-discovery-role')===role,role);input=await search('Fictional');await settled();assert.equal(await page.locator('.global-results option[value=QUOTE]').count(),0);await page.keyboard.press('Escape');
  serverRole='ADMIN';await page.evaluate(()=>window.discoveryRole('ADMIN'));await page.waitForFunction(()=>document.querySelector('[data-discovery-role]')?.getAttribute('data-discovery-role')==='ADMIN');
  await view('inputs');await page.locator('#compact-input-form').waitFor();const year=new Date().getFullYear();
  await page.locator('input[name=date]').fill('1005');assert.equal(await page.locator('input[name=date]').inputValue(),`${year}-10-05`);
  await page.locator('input[name=time]').fill('2215');assert.equal(await page.locator('input[name=time]').inputValue(),'22:15');
  await page.locator('input[name=time]').fill('0803');assert.equal(await page.locator('input[name=time]').inputValue(),'08:03');
  assert.ok(await page.locator('.native-date-picker').evaluateAll(nodes=>nodes.every(node=>node.form===null&&!node.name&&getComputedStyle(node).opacity==='0')));
  await page.locator('input[name=time]').fill('2460');assert.equal(await page.locator('input[name=time]').evaluate(node=>node.validity.valid),false);
  await page.locator('input[name=time]').fill('0803');await page.locator('input[name=date]').fill('0230');assert.equal(await page.locator('input[name=date]').evaluate(node=>node.validity.valid),false);
  await page.locator('input[name=date]').fill(`${year+1}-01-01`);assert.equal(await page.locator('input[name=date]').evaluate(node=>node.validity.valid),false);
  await page.locator('input[name=date]').fill('1005');await page.getByRole('button',{name:'Check values',exact:true}).click();const values=JSON.parse(await page.locator('[data-form-output]').textContent());assert.equal(values.date,`${year}-10-05`);assert.equal(values.time,'08:03');assert.equal(Object.keys(values).length,4);
  await page.locator('input.native-date-picker[type=date]').evaluate((node,date)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,date);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},`${year}-10-06`);assert.equal(await page.locator('input[name=date]').inputValue(),`${year}-10-06`);
  await shot('compact-inputs',['MMDD current year','HHmm normalization','invalid values and bounds rejected','one native picker per field','canonical FormData','controlled picker updates']);
  await page.locator('#compact-input-form').evaluate(form=>form.reset());await page.waitForFunction(()=>document.querySelector('input[name=time]')?.value==='10:00');assert.equal(await page.locator('input[name=date]').inputValue(),`${year}-10-06`,'reset preserves parent-controlled date');
  for(const [lang,width] of [['zh-CN',1440],['en',375]]){
   await page.setViewportSize({width,height:900});await locale(lang);await view('calendar');const dialog=page.getByRole('dialog');await dialog.waitFor();
   await dialog.locator('input[name=title]').fill('Fictional schedule');await dialog.locator('input[name=date]').fill('1005');await dialog.locator('input[name=time]').fill('2215');
   assert.equal(await dialog.locator('input[name=date]').inputValue(),`${year}-10-05`);assert.equal(await dialog.locator('input[name=time]').inputValue(),'22:15');assert.equal(await dialog.locator('.date-picker-trigger').count(),2);
   await shot('schedule-'+lang+'-'+width,['one date selector','one time selector','compact entry','retained native picker']);
   await dialog.locator('button[type=submit]').click();await page.locator('[data-calendar-saved]').waitFor();assert.equal(creates.at(-1).date,`${year}-10-05`);assert.equal(creates.at(-1).time,'22:15');assert.deepEqual(creates.at(-1).attendees,[]);assert.ok(creates.at(-1).requestKey);
  }
  await page.setViewportSize({width:1440,height:1000});await locale('en');await view('product');await page.locator('.product-detail-panel').waitFor();assert.equal(await page.locator('form input[name=nameEn]').count(),0);await page.keyboard.press('Escape');
  const contractResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/contracts');await view('contract');await contractResponse;assert.equal(contractReads.at(-1).focus,id(70));
  await view('quote');await page.locator('.finance-quotes-panel').waitFor();const financeResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/finance');await page.locator('.finance-quotes-panel .table-toolbar button').click();await financeResponse;assert.equal(financeReads.at(-1).quoteId,id(1));assert.equal(await page.locator('#quote-'+id(1)).count(),1);
  await shot('discovery-targets',['product opens details rather than edit','contract refresh retains requested UUID','quote query and anchor retain requested UUID']);
  assert.equal(await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>/Fictional|Coverage|Current/.test(value))),false,'customer search terms must not be persisted');
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
 }finally{await context.close();}
};
