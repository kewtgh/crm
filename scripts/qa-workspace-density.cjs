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
  const {executiveFixture,trendsFixture}=require('../tests/fixtures/management-experience.ts');
  const {managementFixture}=require('../tests/fixtures/management-overview.ts');
  const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
  assert.ok((await page.goto(base+'/api/health'))?.ok());
  let scenario='normal';const readOnly=false;const requests=[];let identityLoss=false,overviewFailure=false;const identityWrites=[],workflowWrites=[],familyWrites=[],consentWrites=[],roleWrites=[];let familyLoss=false,consentRefreshFailure=false;
  const paging=items=>({items,total:items.length,page:1,pageSize:10});
  await page.route(base+'/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.searchParams;requests.push(url.pathname+'?'+p);
   if(request.method()==='POST'){
    if(url.pathname==='/api/education'&&request.postDataJSON()?.operation==='createStudent'){identityWrites.push(request.postData());if(identityLoss){identityLoss=false;return route.abort('aborted');}}
    if(url.pathname.startsWith('/api/admin/users/'))roleWrites.push(request.postData());
    if(url.pathname==='/api/workflow-templates')workflowWrites.push(request.postData());
    if(url.pathname==='/api/households/create'){familyWrites.push(request.postData());if(familyLoss){familyLoss=false;return route.abort('aborted');}}
    if(url.pathname.endsWith('/consents')){consentWrites.push(request.postData());consentRefreshFailure=true;}

    return route.fulfill({json:{saved:true,item:{}}});
   }
   if(url.pathname==='/api/management/overview')return overviewFailure?route.fulfill({status:500,json:{error:{code:'MANAGEMENT_LOAD_FAILED',requestId:'synthetic-reference-333'}}}):route.fulfill({json:executiveFixture()});
   if(url.pathname==='/api/management/trends')return route.fulfill({json:trendsFixture()});
   if(url.pathname==='/api/analytics/channels'){const data=managementFixture().channel;data.items=[...data.items,{...data.items[0],organizationId:id(201),nameZh:'示例机构乙',nameEn:'Example Institution B'}];return route.fulfill({json:data});}
   if(url.pathname==='/api/channel-agreements')return route.fulfill({json:{canManage:true,canFinance:false,items:[{id:id(210),agreement_code:'AGREEMENT-EI-0001-20261008',name_zh:'示例渠道合作协议',name_en:'Example channel agreement',versions:[{id:id(211),version:1,status:'DRAFT',revision:1,effective_from:'2026-10-01',effective_to:null,rules:[{id:id(212),scope_type:'ALL_PRODUCTS',attribution_type:'PRIMARY',basis_type:'FIXED_PER_ENROLLMENT'}]}]}]}});

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
   if(url.pathname.endsWith('/access'))return route.fulfill({json:{ownerId:id(99),scope:'OWNER_HIERARCHY',canEdit:scenario!=='manager',canShare:scenario!=='manager',shares:[]}});
   if(url.pathname==='/api/contacts/'+id(2)+'/consents'){if(consentRefreshFailure){consentRefreshFailure=false;return route.fulfill({status:503,json:{code:'SYNTHETIC_REFRESH_UNAVAILABLE'}});}return route.fulfill({json:{...contactFixture,canManageConsent:scenario!=='manager',consentHistory:[{id:id(310),channel:'EMAIL',purpose:'SERVICE',status:'GRANTED',source:'Fictional permission',effective_at:'2026-10-01T00:00:00Z',recorded_at:'2026-10-01T00:00:00Z'}]}});}
   if(url.pathname.startsWith('/api/student-success/'))return route.fulfill({json:paging(scenario==='empty'?[]:[{id:id(301),title:'示例学习成果',occurred_on:'2026-10-01',outcome_type:'ACADEMIC',result:'OBSERVED',record_status:'RECORDED',owner_name_zh:'顾问甲',owner_name_en:'Advisor A'}])});

   if(url.pathname.startsWith('/api/crm/'))return route.fulfill({json:{...contactFixture,resource:'people',nameZh:contactFixture.nameZh,nameEn:contactFixture.nameEn,status:'ACTIVE',history:[],updatedAt:studentRecord.updatedAt}});
   if(url.pathname==='/api/record-deletions')return route.fulfill({json:{items:[{id:p.get('q'),label:'Example record',revision:1,updatedAt:studentRecord.updatedAt,status:'ACTIVE',canDelete:!readOnly,blockedReason:null}],total:1}});
   if(url.pathname==='/api/search/related')return route.fulfill({json:{items:[{type:'STUDENT',value:'STUDENT:'+studentRecord.id,labelZh:studentRecord.nameZh,labelEn:studentRecord.nameEn}]}});
   if(url.pathname==='/api/leads')return route.fulfill({json:paging(frontlineLeads)});
   if(url.pathname==='/api/notifications')return route.fulfill({json:{...paging([]),unread:0}});
   if(url.pathname==='/api/imports'&&p.has('batch'))return route.fulfill({json:{total:1,items:[{id:id(51),batchId:importFixture.id,rowNumber:3,normalized:{nameZh:'示例联系人甲',nameEn:'Example Contact A'},status:'INVALID',errors:[{code:'CONTACT_METHOD_REQUIRED',field:'email',column:'email',row:3}],decision:null,duplicateId:null,score:null,reasons:[],lastError:'',reviewRevision:1,templateVersion:'2'}]}});
   if(url.pathname==='/api/imports')return route.fulfill({json:paging([importFixture])});
   return route.fulfill({json:paging([])});
  });
  const bundle=await build({entryPoints:['tests/fixtures/workspace-density-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',outdir:'work/v334/browser-bundle'});
  await page.setContent('<html lang="zh-CN"><head><title>Core workspace synthetic QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(f=>f.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  for(const file of bundle.outputFiles.filter(f=>f.path.endsWith('.css')))await page.addStyleTag({content:file.text});
  await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
  const nav=async href=>{await page.evaluate(href=>window.workspaceNavigate(href),href);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const shot=async(label,viewport,checks={})=>{
   await page.evaluate(()=>window.scrollTo(0,0));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+': page overflow');
   const text=await page.locator('main').innerText();assert.doesNotMatch(text,/undefined|\[object Object\]|(?:workspace|customerOps|ux\.record)\.[A-Za-z]+/);
   await page.screenshot({path:path.join(output,label+'.png')});report.pages.push({label,viewport,checks,boundary:'Actual React components and production CSS; synthetic APIs and navigation. Not DB/RLS evidence.'});process.stdout.write(`[QA workspace] ${label} passed\n`);
  };


  const setScenario=async value=>{scenario=value;await page.evaluate(value=>window.workspaceScenario(value),value);};
  const desktop={width:1440,height:1000};
  for(const viewport of [desktop,{width:768,height:1024},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const target of ['/schools/'+id(1),'/leads','/commissions','/people/'+id(2),'/revenue','/outcomes']){
    await nav(target);await page.waitForTimeout(180);
    await shot('density-'+target.replaceAll('/','-')+'-'+viewport.width,viewport);
   }
  }
  await page.setViewportSize(desktop);
  await setScenario('configured-empty');await nav('/revenue');await shot('density-revenue-configured-empty',desktop);
  await setScenario('no-access');await nav('/revenue');await shot('density-revenue-no-access',desktop);
  await setScenario('empty');await nav('/outcomes');await page.waitForTimeout(150);assert.equal(await page.locator('.compact-outcomes>.detail-actions:has(>span)').count(),0);await shot('density-outcomes-empty',desktop);
  await setScenario('normal');await nav('/workflow-templates');
  const blankEditor=page.getByRole('dialog');await blankEditor.locator('select').first().selectOption('application');await blankEditor.locator('select').first().selectOption('');assert.equal(await blankEditor.locator('.workflow-step-nav button').count(),1);assert.equal(await blankEditor.locator('input[name=name_zh]').inputValue(),'');
  await blankEditor.locator('fieldset>button').last().click();assert.equal(await blankEditor.locator('.workflow-step-nav button').count(),2);assert.equal(await blankEditor.locator('[data-workflow-step]').getAttribute('data-workflow-step'),'1');await blankEditor.locator('[data-workflow-step] .detail-actions button').last().click();assert.equal(await blankEditor.locator('.workflow-step-nav button').count(),1);

  const workflow=page.getByRole('dialog');await workflow.locator('select').first().selectOption('application');assert.equal(await workflow.locator('[data-workflow-step]').count(),1);assert.equal(await workflow.locator('.workflow-step-nav button').count(),5);
  await workflow.locator('.workflow-step-nav button').nth(2).click();assert.equal(await workflow.locator('[data-workflow-step]').getAttribute('data-workflow-step'),'2');
  await workflow.locator('[data-workflow-step] .detail-actions button').first().focus();await page.keyboard.press('Enter');assert.equal(await workflow.locator('[data-workflow-step]').getAttribute('data-workflow-step'),'1');
  await workflow.locator('[data-workflow-step] details summary').first().click();
  await workflow.locator('input[name=step_1_name_en]').fill('Fictional inherited step');await workflow.locator('input[name=step_1_title_en]').fill('');await workflow.locator('input[name=step_1_title_zh]').fill('示例独立任务标题');
  await shot('density-workflow-selected-advanced',desktop);
  await page.setViewportSize({width:390,height:844});await shot('density-workflow-mobile',{width:390,height:844});
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  await workflow.locator('.drawer-actions .primary-button').click();await workflow.waitFor({state:'hidden'});
  const inherited=JSON.parse(workflowWrites[0]).steps?.[1]??JSON.parse(workflowWrites[0]).input?.data?.steps?.[1]??JSON.parse(workflowWrites[0]).data?.steps?.[1];assert.ok(inherited,workflowWrites[0]);assert.equal(inherited.task_config.title_en,'Fictional inherited step');assert.equal(inherited.task_config.title_zh,'示例独立任务标题');

  await page.setViewportSize(desktop);await setScenario('refresh-failure');await nav('/workflow-templates');
  await page.getByRole('dialog').locator('select').first().selectOption('program');await page.getByRole('dialog').locator('.drawer-actions .primary-button').click();await page.getByRole('dialog').locator('[role=alert]').waitFor();
  await shot('density-workflow-refresh-only',desktop);await page.getByRole('dialog').locator('.drawer-actions .primary-button:not([disabled])').click();assert.equal(workflowWrites.length,2);
  await setScenario('normal');await nav('/households');await page.getByRole('button',{name:'新增家庭',exact:true}).click();
  const family=page.getByRole('dialog');await family.locator('input[name=nameEn]').fill('Fictional family');
  await family.locator('.detail-section').nth(0).getByLabel('英文姓名').fill('Fictional parent A');await family.locator('.detail-section').nth(1).getByLabel('英文姓名').fill('Fictional parent B');
  await family.getByRole('button',{name:'添加另一位家长／监护人'}).click();assert.equal(await family.locator('.detail-section').count(),3);await family.locator('.detail-section').nth(2).getByLabel('英文姓名').fill('Fictional guardian C');
  await shot('density-family-three-people',desktop);await page.setViewportSize({width:390,height:844});await shot('density-family-mobile',{width:390,height:844});
  familyLoss=true;await family.locator('.drawer-actions .primary-button').click();await family.locator('fieldset[disabled]').waitFor();await family.locator('.drawer-actions .primary-button:not([disabled])').click();await family.waitFor({state:'hidden'});assert.equal(familyWrites.length,2);assert.equal(familyWrites[0],familyWrites[1]);
  await page.setViewportSize(desktop);await nav('/people/'+id(2));await page.waitForTimeout(200);
  for(const key of ['commercial','followUp','privacy']){await page.locator(`[role=tab][id$="-${key}"]`).click();await page.waitForTimeout(150);await shot('density-contact-'+key,desktop);}
  const form=page.locator('.consent-form');await form.locator('input[name=source]').fill('Fictional permission');const errorStart=report.errors.length;await form.locator('button.primary-button').click();await form.locator('fieldset[disabled]').waitFor();await shot('density-consent-grant-refresh-only',desktop);await form.locator('button.primary-button:not([disabled])').click();await form.locator('fieldset:not([disabled])').waitFor();assert.equal(consentWrites.length,1);
  await form.locator('select[name=status]').selectOption('REVOKED');await form.locator('input[name=source]').fill('Fictional withdrawal');await shot('density-consent-withdraw-preview',desktop);await form.locator('button.primary-button').click();await form.locator('fieldset[disabled]').waitFor();await form.locator('button.primary-button:not([disabled])').click();await form.locator('fieldset:not([disabled])').waitFor();assert.equal(consentWrites.length,2);
  const injected=report.errors.splice(errorStart);assert.ok(injected.every(e=>e.url?.includes('/consents')&&['http','console','response'].includes(e.kind)),JSON.stringify(injected));report.warnings.push({kind:'injected-failure',message:'Two intentional consent refresh failures; both recovered with reads only.'});
  await setScenario('manager');await nav('/people/'+id(2));await page.locator('[role=tab][id$="-privacy"]').click();await page.locator('.contact-access').waitFor();assert.equal(await page.locator('.consent-form').count(),0);await shot('density-contact-manager-read-only',desktop);
  await setScenario('normal');await nav('/schools/'+id(1));await page.locator('[role=tab][id$="-activity"]').click();await page.locator('.timeline-item').waitFor();await shot('density-organization-activity',desktop);await page.setViewportSize({width:390,height:844});await shot('density-organization-activity-mobile',{width:390,height:844});await page.setViewportSize(desktop);

  await page.getByRole('button',{name:'QA English',exact:true}).click();await nav('/workflow-templates');await page.getByRole('dialog').locator('select').first().selectOption('program');await shot('density-workflow-en',desktop);await page.keyboard.press('Escape');
  await setScenario('role-refresh-failure');await nav('/staff-role');
  const roleDialog=page.getByRole('dialog');assert.deepEqual(await roleDialog.locator('select option').evaluateAll(options=>options.map(o=>o.value)),['SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT']);
  await roleDialog.locator('select').selectOption('SALES_MANAGER');await roleDialog.locator('.drawer-actions .primary-button').click();await roleDialog.locator('fieldset[disabled]').waitFor();await shot('density-role-accepted-refresh-only',desktop);await roleDialog.locator('.drawer-actions .primary-button').click();await roleDialog.waitFor({state:'hidden'});assert.equal(roleWrites.length,1);assert.equal(JSON.parse(roleWrites[0]).expectedRole,'SALES_SPECIALIST');
  await setScenario('normal');await page.evaluate(()=>window.workspaceRole('SUPER_ADMIN'));await nav('/staff-role');assert.equal(await page.getByRole('dialog').locator('select option').count(),6);await page.getByRole('dialog').locator('select').selectOption('ADMIN');await shot('density-role-super-admin',desktop);await page.keyboard.press('Escape');
  report.checks={...report.checks,workspaceDensity:'PASS: actual components, three widths, selected-step builder, keyboard reorder, atomic-family uncertain retry, accepted template refresh-only, bilingual rendering. API fixtures are not database security evidence.'};
 }finally{await context.close();}
};
