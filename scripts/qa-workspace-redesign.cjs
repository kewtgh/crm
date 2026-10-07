/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report,observe})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  require('tsx/cjs');
  const {recordId:id,studentRecord,householdRecord,accountOperations}=require('../tests/fixtures/record-workspaces.ts');
  const {contactFixture,importFixture}=require('../tests/fixtures/workspace-redesign.ts');
  const {repairEnrollment,repairApplication}=require('../tests/fixtures/operations-repair-data.ts');
  const {frontlineLeads}=require('../tests/fixtures/frontline.ts');
  const {zhCN:zh}=require('../lib/i18n/locales/zh-CN.ts');
  const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
  assert.ok((await page.goto(base+'/api/health'))?.ok());
  let scenario='normal',readOnly=false;const requests=[];
  const paging=items=>({items,total:items.length,page:1,pageSize:10});
  await page.route(base+'/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.searchParams;requests.push(url.pathname+'?'+p);
   if(request.method()==='POST')return route.fulfill({json:{saved:true,item:{}}});
   if(url.pathname==='/api/customer-operations')return route.fulfill({json:{...accountOperations,subject:p.get('subject'),id:p.get('id'),canManage:!readOnly,...(p.get('subject')==='CONTACT'?{nameZh:contactFixture.nameZh,nameEn:contactFixture.nameEn,profile:{organization_id:id(1),title:contactFixture.title},contracts:[],opportunities:[]}:{})}});
   if(url.pathname==='/api/education'){
    if(p.get('resource')==='studentDetail')return route.fulfill({json:{item:studentRecord}});
    if(p.get('resource')==='householdDetail')return route.fulfill({json:{item:householdRecord}});
    return route.fulfill({json:paging(p.get('resource')==='students'?[studentRecord]:[])});
   }
   if(url.pathname==='/api/applications')return route.fulfill({json:paging(scenario==='empty'?[]:[repairApplication])});
   if(url.pathname==='/api/student-success')return route.fulfill({json:paging(scenario==='empty'?[]:[{id:id(18),enrollment_id:repairEnrollment.id,status:'ACTIVE',health_status:'ATTENTION',next_review_on:'2026-10-20',active_goal_count:2,open_risk_count:1,product_name_zh:'示例学习项目',product_name_en:'Example Learning Program'}])});
   if(url.pathname==='/api/enrollments')return route.fulfill({json:paging(scenario==='empty'?[]:[repairEnrollment])});
   if(url.pathname.endsWith('/commercial'))return route.fulfill({json:{organization:{id:id(1),status:'HEALTHY',city:'示例城市',curriculum:'IB',student_count:null},profile:{revision:1,commercial_tier:'A',partnership_stage:'PROSPECT',partnership_potential_score:80,school_type:'INTERNATIONAL',next_action:'确认示例合作时间'},contacts:[{id:id(2),name_zh:contactFixture.nameZh,name_en:contactFixture.nameEn,title:contactFixture.title,decision_role:'INFLUENCER',can_edit:!readOnly,updated_at:studentRecord.updatedAt}],intelligence:[],relationships:[],outcomes:[],opportunities:[{id:id(45),title_zh:'示例课程合作',title_en:'Example Program Cooperation',stage:'EVALUATION',product_name_zh:'示例学习项目',cohort_name_zh:'示例秋季批次',amount:'20000.00',currency:'CNY',next_action_zh:'确认示例需求'},{id:id(46),title_zh:'示例项目咨询',title_en:'Example Program Consultation',stage:'DISCOVERY',amount:'3000.00',currency:'USD'}],canManage:!readOnly}});
   if(url.pathname.endsWith('/activation'))return route.fulfill({json:{projection:{organizationId:id(1),currentPartnershipStage:'PROSPECT',profileRevision:1,nextAction:'确认示例合作时间',canManage:!readOnly,stageChangedAt:null,openLeadCount:2,claimedLeadCount:1,keyContactCount:1,decisionMakerCount:0,latestActivityAt:null,activeOpportunityCount:2,recentRecruitmentEventCount:0,primaryEnrollmentCount:0,assistEnrollmentCount:0,lastEnrollmentAt:null,leads:[],events:[]},history:[]}});
   if(url.pathname==='/api/education-business')return route.fulfill({json:{...paging([]),labels:{},editableIds:[],today:'2026-10-07'}});
   if(url.pathname==='/api/contacts/'+id(2)+'/consents')return route.fulfill({json:contactFixture});
   if(url.pathname.startsWith('/api/crm/'))return route.fulfill({json:{...contactFixture,resource:'people',nameZh:contactFixture.nameZh,nameEn:contactFixture.nameEn,status:'ACTIVE',history:[],updatedAt:studentRecord.updatedAt}});
   if(url.pathname==='/api/record-deletions')return route.fulfill({json:{items:[{id:p.get('q'),label:'Example record',revision:1,updatedAt:studentRecord.updatedAt,status:'ACTIVE',canDelete:!readOnly,blockedReason:null}],total:1}});
   if(url.pathname==='/api/search/related')return route.fulfill({json:{items:[{type:'STUDENT',value:'STUDENT:'+studentRecord.id,labelZh:studentRecord.nameZh,labelEn:studentRecord.nameEn}]}});
   if(url.pathname==='/api/leads')return route.fulfill({json:paging(frontlineLeads)});
   if(url.pathname==='/api/notifications')return route.fulfill({json:{...paging([]),unread:0}});
   if(url.pathname==='/api/imports'&&p.has('batch'))return route.fulfill({json:{total:1,items:[{id:id(51),batchId:importFixture.id,rowNumber:3,normalized:{nameZh:'示例联系人甲',nameEn:'Example Contact A'},status:'INVALID',errors:[{code:'CONTACT_METHOD_REQUIRED',field:'email',column:'email',row:3}],decision:null,duplicateId:null,score:null,reasons:[],lastError:'',reviewRevision:1,templateVersion:'2'}]}});
   if(url.pathname==='/api/imports')return route.fulfill({json:paging([importFixture])});
   return route.fulfill({json:paging([])});
  });
  const bundle=await build({entryPoints:['tests/fixtures/workspace-redesign-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Core workspace synthetic QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(f=>f.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const nav=async href=>{await page.evaluate(href=>window.workspaceNavigate(href),href);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const tab=name=>page.getByRole('tab',{name:zh[name],exact:true}).click();
  const shot=async(label,viewport,checks={})=>{
   await page.evaluate(()=>window.scrollTo(0,0));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+': page overflow');
   const text=await page.locator('main').innerText();assert.doesNotMatch(text,/undefined|\[object Object\]|(?:workspace|customerOps|ux\.record)\.[A-Za-z]+/);
   await page.screenshot({path:path.join(output,label+'.png')});report.pages.push({label,viewport,checks,boundary:'Actual React components and production CSS; synthetic APIs and navigation. Not DB/RLS evidence.'});process.stdout.write(`[QA workspace] ${label} passed\n`);
  };
  const top=async(selector,height)=>{const box=await page.locator(selector).first().boundingBox();assert.ok(box&&box.y<height,selector+' begins within viewport');return box.y;};
  const widths=[{width:1920,height:1080},{width:1440,height:900},{width:375,height:812}];
  if(process.env.QA_SCOPE==='workspace-redesign-records'){
   for(const viewport of widths){
    await page.setViewportSize(viewport);await nav('/schools/'+id(1));await page.locator('[data-testid=account-overview] .workspace-main-stack').waitFor();await page.locator('[data-testid=account-opportunity-summary] article').first().waitFor();
    assert.equal(await page.locator('main h1').count(),1);await shot('organization-overview-'+viewport.width,viewport,{firstContextTop:await top('[data-testid=account-overview] .detail-section',viewport.height),singleIdentity:true});
    await tab('ux.record.people');await page.locator('.detail-record-list a[href="/people/'+id(2)+'"]').waitFor();await shot('organization-contacts-'+viewport.width,viewport);
    await tab('nav.opportunities');await page.getByText('CNY 20,000.00',{exact:true}).first().waitFor();await shot('organization-opportunities-'+viewport.width,viewport,{currencySeparated:true});
    await tab('ux.record.channelsOutreach');await page.locator('.workspace-channel-facts').first().waitFor();await shot('organization-channel-'+viewport.width,viewport,{firstContentTop:await top('.workspace-activation',viewport.height),...(viewport.width===1920?{productTop:await top('.workspace-channel .workspace-summary-grid',viewport.height)}:{}),contextRail:true});
    if(viewport.width===1920){await tab('ux.record.activity');await page.locator('.timeline-item').waitFor();await shot('organization-dynamics-1920',viewport);}
    await nav('/people/'+id(2));await page.locator('.contact-workspace .workspace-info-grid').waitFor();assert.equal(await page.locator('main h1').count(),1);await shot('contact-overview-'+viewport.width,viewport,{singleIdentity:true,consentFacts:true});
    await nav('/students?focus='+studentRecord.id);await page.locator('.workspace-participations tbody tr').waitFor();await shot('student-overview-'+viewport.width,viewport,{panelTop:await top('[data-testid=student-current-panel]',viewport.height),familySummary:true,canonicalJourney:true});
    const tabs=page.locator('main .detail-tabs');await tabs.getByRole('tab').first().focus();await page.keyboard.press('End');assert.ok(await tabs.getByRole('tab').last().evaluate(e=>e===document.activeElement));await page.keyboard.press('Home');
   }
   await page.setViewportSize(widths[2]);scenario='long';await page.evaluate(()=>window.workspaceScenario('long'));
   for(const href of ['/schools/'+id(1),'/people/'+id(2),'/students?focus='+id(3)]){await nav(href);await page.locator('main .workspace-info-grid, main .workspace-participations').first().waitFor();assert.equal(await page.locator('main h1').count(),1);await shot('long-'+(href.startsWith('/schools')?'organization':href.startsWith('/people')?'contact':'student')+'-375',widths[2]);}
   scenario='normal';await page.evaluate(()=>window.workspaceScenario('normal'));await nav('/schools/'+id(1));await page.locator('[data-testid=account-overview]').waitFor();
   const more=page.locator('.ux-record-actions summary');await more.focus();await page.keyboard.press('Enter');assert.ok(await page.locator('.ux-record-actions details').evaluate(e=>e.open));await page.keyboard.press('Escape');assert.ok(await more.evaluate(e=>e===document.activeElement));
   await more.click();await page.locator('.ux-record-actions [role=menuitem].destructive-action').click();await page.getByRole('dialog').waitFor();await page.locator('[role=dialog][aria-busy=false]').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok(await more.evaluate(e=>e===document.activeElement));
   readOnly=true;await page.evaluate(()=>window.workspaceRole('SALES_SUPPORT'));await nav('/schools/'+id(1));await page.locator('[data-testid=account-overview]').waitFor();assert.equal(await page.locator('main .destructive-action').count(),0);assert.equal(await page.locator('main .ux-record-actions .primary-button').count(),0);await shot('organization-readonly-375',widths[2],{manageActionsAbsent:true});
  }else{
   for(const viewport of widths){
    await page.setViewportSize(viewport);
    await nav('/products');await page.locator('.product-list-row').waitFor();assert.equal(await page.locator('.product-row-actions .danger-menu-action').isVisible(),false);await shot('products-'+viewport.width,viewport,{deleteInMore:true,currencyCode:true});
    await nav('/leads');await page.locator('.ux-queue-item').first().waitFor();await shot('leads-'+viewport.width,viewport,{firstLeadTop:await top('.ux-queue-item',viewport.height)});
    await nav('/progression');await page.locator('.academic-correction').waitFor();const select=page.locator('.academic-correction .select-trigger');await select.click();await page.locator('.academic-correction [role=option]').first().click();await page.locator('.workspace-placement-preview').waitFor();await shot('progression-'+viewport.width,viewport,{selectedStudentContext:true});
    await nav('/imports');await page.locator('.import-create').waitFor();assert.equal(await page.locator('main .detail-tabs').count(),1);await page.locator('.batch-card').first().click();await page.locator('.import-row').waitFor();await shot('imports-'+viewport.width,viewport,{singleTabs:true,humanFirstDiagnostics:true});
   }
   const tabs=page.getByRole('tablist',{name:zh['workspace.importWorkspace']});await tabs.getByRole('tab').first().focus();await page.keyboard.press('End');assert.ok(await tabs.getByRole('tab').last().evaluate(e=>e===document.activeElement));await page.keyboard.press('Home');
    await nav('/leads');const more=page.locator('.ux-queue-actions summary').first();await more.focus();await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');assert.equal(await page.locator('[role=menuitem]').evaluateAll(items=>items.some(e=>e===document.activeElement)),true);await page.keyboard.press('Escape');assert.ok(await more.evaluate(e=>e===document.activeElement));await shot('lead-more-keyboard-375',widths[2],{escapeFocusRestore:true});
  }
  report.workspaceRequests=requests;
 }finally{await context.close();}
};
