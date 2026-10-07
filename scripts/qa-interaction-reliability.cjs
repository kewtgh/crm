/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report,observe})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  require('tsx/cjs');
  const {organizationRows}=require('../tests/fixtures/ux-organization-rows.ts');
  const {frontlineLeads,frontlineId:id}=require('../tests/fixtures/frontline.ts');
  const {zhCN:zh}=require('../lib/i18n/locales/zh-CN.ts');
  const page=await context.newPage();observe(page);page.setDefaultTimeout(3500);
  assert.ok((await page.goto(base+'/api/health'))?.ok());
  let state='normal',failure=null,directoryMode='normal',revision=1,activationRefreshFails=false;
  const requests=[],expected=[];
  const activation={projection:{organizationId:id(1),currentPartnershipStage:'PROSPECT',profileRevision:1,nextAction:'Example next action',canManage:true,stageChangedAt:null,openLeadCount:1,claimedLeadCount:0,keyContactCount:0,decisionMakerCount:0,activeOpportunityCount:0,recentRecruitmentEventCount:0,primaryEnrollmentCount:0,assistEnrollmentCount:0,leads:[],events:[]},history:[]};
  const commercial={organization:{id:id(1),name_zh:'示例教育机构甲',name_en:'Example Education Organization A',status:'HEALTHY',organization_type:'SCHOOL',city:'Example City',curriculum:'IB',student_count:null},profile:{id:id(1),revision:1,organization_type:'SCHOOL',roles:[],partnership_stage:'PROSPECT',primary_contact_id:null,focus_regions:[],agreement_expires_on:null,next_action:'',commercial_tier:null,partnership_potential_score:null},contacts:[],intelligence:[],relationships:[],outcomes:[],opportunities:[],canManage:true};
  await page.route(base+'/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),params=url.searchParams;
   requests.push({url:req.url(),method:req.method(),body:req.postData()});
   const fail=async kind=>{
    expected.push({state,url:req.url(),kind});
    if(kind==='network')return route.abort('failed');
    return route.fulfill({status:kind,json:{error:{code:kind===409?'VERSION_CONFLICT':'SYNTHETIC_FAILURE'}}});
   };
   if(req.method()==='POST'){
    if(failure){const kind=failure;failure=null;return fail(kind);}
    return route.fulfill({json:{saved:true,item:{id:id(1),revision:2}}});
   }
   if(url.pathname==='/api/record-deletions')return route.fulfill({json:{items:[{id:id(1),label:'Example Product A',status:'DRAFT',revision,updatedAt:'2026-10-07T00:00:00.123456Z',canDelete:true,blockedReason:null}],total:1}});
   if(url.pathname.endsWith('/activation')){
    if(activationRefreshFails){activationRefreshFails=false;return fail(503);}
    return route.fulfill({json:activation});
   }
   if(url.pathname.endsWith('/commercial'))return route.fulfill({json:commercial});
   if(url.pathname==='/api/leads')return route.fulfill({json:{items:frontlineLeads,total:4,page:1,pageSize:20}});
   if(url.pathname.startsWith('/api/crm/')){
    if(directoryMode==='invalid')return route.fulfill({json:{items:[],total:null}});
    const query=params.get('q');if(query==='slow')await new Promise(r=>setTimeout(r,450));
    const items=query==='no-match'?[]:query==='slow'||query==='fast'?[{...organizationRows[0],primary:'Example '+query,primaryEn:'Example '+query}]:organizationRows;
    return route.fulfill({json:{items,total:items.length,metrics:{total:items.length,needsAttention:1,averageCompleteness:80}}});
   }
   if(url.pathname==='/api/search/related'){
    if(params.get('q')==='failure')return fail(503);
    await new Promise(r=>setTimeout(r,100));
    return route.fulfill({json:{items:[{value:'USER:'+id(99),labelZh:'示例顾问甲',labelEn:'Example Advisor A'},{value:'USER:'+id(98),labelZh:'示例顾问乙',labelEn:'Example Advisor B'}]}});
   }
   if(url.pathname==='/api/channel-agreements')return route.fulfill({json:{items:[],canManage:false,canFinance:false}});
   return route.fulfill({json:{items:[],total:0,unread:0}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/interaction-reliability-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Synthetic interaction QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(f=>f.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const view=async name=>{await page.evaluate(name=>window.reliabilityView(name),name);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
  const nav=href=>page.evaluate(href=>window.reliabilityNavigate(href),href);
  const dialog=()=>page.getByRole('dialog');
  const clickLabel=key=>page.getByRole('button',{name:zh[key],exact:true}).click();
  const posts=()=>requests.filter(r=>r.method==='POST');
  const shot=async label=>{
   await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+': overflow');
   await page.screenshot({path:path.join(output,label+'.png')});report.pages.push({label,viewport:page.viewportSize(),checks:'Actual components, production CSS, synthetic requests; not database/RLS evidence.'});process.stdout.write(`[QA reliability] ${label} passed\n`);
  };
  const deleteOpen=async()=>{await view('delete');await page.locator('main .destructive-action').click();await dialog().locator('.danger-button').waitFor();};
  if(process.env.QA_SCOPE==='interaction-mutations'){
   for(const width of [1920,1440,375]){
    await page.setViewportSize({width,height:width===1920?1080:width===1440?900:812});state='delete-network-'+width;await deleteOpen();failure='network';const count=posts().length;
    await dialog().locator('.danger-button').evaluate(button=>{button.click();button.click();});
    await dialog().getByRole('button',{name:zh['business.retrySame'],exact:true}).waitFor();assert.equal(posts().length,count+1);
    await page.keyboard.press('Escape');assert.equal(await dialog().count(),1);await shot(state);
    await dialog().getByRole('button',{name:zh['business.retrySame'],exact:true}).click();await dialog().waitFor({state:'hidden'});
    assert.equal(posts().length,count+2);assert.equal(posts().at(-1).body,posts().at(-2).body);
   }
   state='delete-conflict';await deleteOpen();failure=409;await dialog().locator('.danger-button').click();await clickLabel('reliability.reloadReview');revision=2;
   // Reload is a read, and never silently confirms deletion.
   await dialog().locator('.danger-button').waitFor();await dialog().getByRole('button',{name:zh['common.cancel'],exact:true}).click();
   await deleteOpen();failure=409;await dialog().locator('.danger-button').click();const count=posts().length;revision=3;await clickLabel('reliability.reloadReview');await dialog().locator('.danger-button').waitFor();assert.equal(posts().length,count);
   await dialog().locator('.danger-button').click();await dialog().waitFor({state:'hidden'});assert.equal(JSON.parse(posts().at(-1).body).expectedRevision,3);assert.notEqual(JSON.parse(posts().at(-1).body).requestKey,JSON.parse(posts().at(-2).body).requestKey);await shot(state);
   state='delete-refresh-failure';await deleteOpen();await page.evaluate(()=>{window.reliabilityRefreshFail=true;});const before=posts().length;await dialog().locator('.danger-button').click();await dialog().getByRole('button',{name:zh['reliability.refreshOnly']}).waitFor();assert.equal(await dialog().locator('.danger-button').count(),0);await shot(state);
   await page.evaluate(()=>{window.reliabilityRefreshFail=false;});await clickLabel('reliability.refreshOnly');await dialog().waitFor({state:'hidden'});assert.equal(posts().length,before+1);
   state='commission-network';await view('commission');failure='network';await page.getByRole('button',{name:'Send example operation'}).evaluate(b=>{b.click();b.click();});await page.getByRole('button',{name:'Retry exact request'}).waitFor();const first=posts().at(-1).body;await page.getByRole('button',{name:'Retry exact request'}).click();await page.getByText('Accepted',{exact:true}).waitFor();assert.equal(posts().at(-1).body,first);await shot(state);
   state='commission-refresh-failure';await view('commission');await page.evaluate(()=>{window.reliabilityRefreshFail=true;});await page.getByRole('button',{name:'Send example operation'}).click();await page.getByText('Accepted',{exact:true}).waitFor();await page.getByText(zh['audit.savedRefreshFailed'],{exact:true}).waitFor();await shot(state);await page.evaluate(()=>{window.reliabilityRefreshFail=false;});
   state='lead-network';await view('lead');await page.locator('.ux-queue-item').nth(1).getByRole('button',{name:new RegExp(zh['pool.update'])}).click();failure='network';await dialog().getByRole('button',{name:zh['common.save'],exact:true}).click();await dialog().getByRole('button',{name:zh['business.retrySame'],exact:true}).waitFor();const leadBody=posts().at(-1).body;await shot(state);await dialog().getByRole('button',{name:zh['business.retrySame'],exact:true}).click();await dialog().waitFor({state:'hidden'});assert.equal(posts().at(-1).body,leadBody);
   state='activation-network';await view('activation');await clickLabel('pool.updateStage');await dialog().locator('[name=reason]').fill('Example reviewed stage');failure='network';await dialog().locator('button.primary-button').click();await dialog().getByRole('button',{name:zh['business.retrySame'],exact:true}).waitFor();const activationBody=posts().at(-1).body;activationRefreshFails=true;await dialog().getByRole('button',{name:zh['business.retrySame'],exact:true}).click();await dialog().waitFor({state:'hidden'});await page.getByText(zh['audit.savedRefreshFailed'],{exact:false}).waitFor();assert.equal(posts().at(-1).body,activationBody);await shot(state);await clickLabel('reliability.refreshOnly');
   state='commercial-network';await view('commercial');await page.locator('.workspace-channel').getByRole('button',{name:zh['crm.edit'],exact:true}).first().click();await dialog().waitFor();failure='network';await dialog().locator('button.primary-button').click();await dialog().getByRole('button',{name:zh['business.retrySame'],exact:true}).waitFor();const commercialBody=posts().at(-1).body;await dialog().getByRole('button',{name:zh['business.retrySame'],exact:true}).click();await dialog().waitFor({state:'hidden'});assert.equal(posts().at(-1).body,commercialBody);await shot(state);
  }else{
   const waitRows=()=>page.locator('main .data-table tbody tr').first().waitFor({state:'attached'});
   for(const width of [1920,1440,375]){
    await page.setViewportSize({width,height:width===1920?1080:width===1440?900:812});state='directory-'+width;await nav('/schools?city=Example&commercialTier=A&focus=example-context');await view('directory');await waitRows();
    assert.ok(requests.some(r=>r.url.includes('/api/crm/schools')&&new URL(r.url).searchParams.get('city')==='Example'));
    const more=page.getByRole('button',{name:zh['ux.filters.more'].replace('{count}','2'),exact:true});await more.click();await dialog().getByLabel(zh['modules.city'],{exact:true}).fill('Second City');const before=requests.length;await clickLabel('common.cancel');assert.equal(requests.length,before);
    await more.click();assert.equal(await dialog().getByLabel(zh['modules.city'],{exact:true}).inputValue(),'Example');await dialog().getByLabel(zh['modules.city'],{exact:true}).fill('Second City');await clickLabel('ux.filters.apply');await page.waitForURL(url=>url.searchParams.get('city')==='Second City');await waitRows();
    await page.goBack();await page.waitForURL(url=>url.searchParams.get('city')==='Example');await waitRows();await more.click();assert.equal(await dialog().getByLabel(zh['modules.city'],{exact:true}).inputValue(),'Example');await clickLabel('common.cancel');await shot(state);
    await clickLabel('ux.filters.resetApplied');await page.waitForURL(url=>!url.searchParams.has('city'));assert.equal(new URL(page.url()).searchParams.get('focus'),'example-context');await waitRows();
   }
   state='directory-no-match';await page.getByRole('textbox',{name:zh['modules.schools.search'],exact:true}).fill('no-match');await page.getByText(zh['reliability.noMatches'],{exact:true}).last().waitFor();await shot(state);
   state='directory-invalid-required-data';directoryMode='invalid';await page.getByRole('textbox',{name:zh['modules.schools.search'],exact:true}).fill('invalid');await page.locator('main .table-error').waitFor();assert.equal(await page.locator('main .data-table tbody tr').count(),0);assert.equal(await page.locator('main .pagination').count(),0);assert.equal(await page.getByText(zh['reliability.noMatches'],{exact:true}).count(),0);await shot(state);directoryMode='normal';await page.locator('main .table-error').getByRole('button').click();await waitRows();
   state='directory-stale-read';const query=page.getByRole('textbox',{name:zh['modules.schools.search'],exact:true});const slowStarted=page.waitForRequest(r=>r.url().includes('/api/crm/schools')&&new URL(r.url()).searchParams.get('q')==='slow');await query.fill('slow');await slowStarted;await query.fill('fast');await page.getByText('Example fast',{exact:true}).last().waitFor();await page.evaluate(()=>new Promise(r=>setTimeout(r,500)));assert.equal(await page.getByText('Example slow',{exact:true}).count(),0);await shot(state);
   state='contacts-url';await nav('/people?contactType=PARENT&ownerId='+id(99));await waitRows();assert.ok(requests.some(r=>r.url.includes('/api/crm/people')&&new URL(r.url).searchParams.get('contactType')==='PARENT'));await clickLabel('modules.savedViews');await clickLabel('modules.restoreDefaultView');await page.waitForURL(url=>!url.searchParams.has('contactType')&&!url.searchParams.has('ownerId'));await shot(state);
   state='directory-resource-switch';const switched=page.waitForRequest(r=>r.url().includes('/api/crm/schools')&&!new URL(r.url()).searchParams.has('contactType')&&!new URL(r.url()).searchParams.has('ownerId'));await nav('/schools');await switched;await waitRows();await shot(state);
   state='relation-keyboard';await view('controls');await page.getByRole('button',{name:'Example owner',exact:true}).click();const search=page.getByRole('combobox',{name:'Example owner'});await search.fill('Example');await page.getByRole('option').first().waitFor();await search.press('Home');assert.equal(await search.evaluate(e=>e.selectionStart),0);await search.press('End');assert.equal(await search.evaluate(e=>e.selectionStart),7);await page.getByRole('option').first().click();await page.getByRole('button',{name:'Example owner',exact:true}).click();await search.fill('failure');await page.getByText(zh['modules.relatedSearchFailed'],{exact:true}).waitFor();assert.equal(await page.getByRole('option').count(),1);await page.keyboard.press('Escape');assert.ok(await page.getByRole('button',{name:'Example owner',exact:true}).evaluate(e=>e===document.activeElement));await shot(state);
   const more=page.locator('main summary');await more.click();await page.getByRole('menuitem',{name:'Example context'}).click();assert.equal(await page.locator('main details').evaluate(e=>e.open),false);await more.click();await page.getByRole('button',{name:'After menu',exact:true}).focus();assert.equal(await page.locator('main details').evaluate(e=>e.open),false);await shot('more-keyboard-exit');
  }
  // Attribute only the exact intentionally failed endpoint, response and scenario above.
  const matched=report.errors.filter(error=>expected.some(e=>e.url===error.url&&(e.kind==='network'?(error.kind==='request'&&/ERR_FAILED/.test(error.message)||error.kind==='console'&&/ERR_FAILED/.test(error.message)):(error.kind==='response'&&error.message===String(e.kind)||error.kind==='console'&&error.message.includes(String(e.kind))&&/Failed to load resource/.test(error.message)))));
  report.errors=report.errors.filter(error=>!matched.includes(error));report.expectedFailures=expected;report.warnings.push(...matched.map(error=>({...error,kind:'expected-injected-failure'})));
  report.interactionRequests=requests;
 }catch(error){const page=context.pages()[0];if(page){await page.screenshot({path:path.join(output,'interaction-failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'interaction-failure.html'),await page.content());}throw error;}
 finally{await context.close();}
};
