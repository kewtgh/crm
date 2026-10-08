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
  const scenario='normal',readOnly=false;const requests=[];let identityLoss=false,overviewFailure=false;const identityWrites=[],workflowWrites=[];
  const paging=items=>({items,total:items.length,page:1,pageSize:10});
  await page.route(base+'/api/**',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.searchParams;requests.push(url.pathname+'?'+p);
   if(request.method()==='POST'){
    if(url.pathname==='/api/education'&&request.postDataJSON()?.operation==='createStudent'){identityWrites.push(request.postData());if(identityLoss){identityLoss=false;return route.abort('aborted');}}
    if(url.pathname==='/api/workflow-templates')workflowWrites.push(request.postData());
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
  const bundle=await build({entryPoints:['tests/fixtures/operations-usability-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Core workspace synthetic QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(f=>f.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const nav=async href=>{await page.evaluate(href=>window.workspaceNavigate(href),href);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const shot=async(label,viewport,checks={})=>{
   await page.evaluate(()=>window.scrollTo(0,0));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+': page overflow');
   const text=await page.locator('main').innerText();assert.doesNotMatch(text,/undefined|\[object Object\]|(?:workspace|customerOps|ux\.record)\.[A-Za-z]+/);
   await page.screenshot({path:path.join(output,label+'.png')});report.pages.push({label,viewport,checks,boundary:'Actual React components and production CSS; synthetic APIs and navigation. Not DB/RLS evidence.'});process.stdout.write(`[QA workspace] ${label} passed\n`);
  };

  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const route of ['/duplicates','/leads','/reports/executive','/reports/channels','/commissions','/admin/operations','/schools/'+id(1),'/people/'+id(2)]){
    await nav(route);await page.waitForTimeout(150);
    if(route==='/leads'){await page.locator('.lead-qualification-panel summary').first().click();await page.locator('.lead-qualification-panel[open]').waitFor();}
    if(route==='/reports/executive'){await page.locator('.management-trend-chart svg').first().waitFor();assert.ok(await page.locator('.management-trend-chart rect').count()>0);}
    if(route==='/reports/channels'){await page.locator('.channel-account-grid>article').first().waitFor();assert.equal(await page.locator('.channel-analytics .pagination').count(),1);const colors=await page.locator('.channel-account-grid>article').evaluateAll(items=>items.map(item=>getComputedStyle(item).backgroundColor));assert.notEqual(colors[0],colors[1]);}
    if(route==='/duplicates'&&viewport.width===1440){const tops=await page.locator('.duplicate-merge-panel .search-filter-bar select,.duplicate-merge-panel .select-trigger').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().top));assert.equal(tops.length,3);assert.ok(Math.max(...tops)-Math.min(...tops)<4,'duplicate selectors aligned');}
    await shot('usability-'+route.replaceAll('/','-')+'-'+viewport.width,viewport);
   }
  }
  await page.setViewportSize({width:1440,height:1000});
  await nav('/products');await page.locator('.page-heading-row button.primary-button').click();
  const productDrawer=page.getByRole('dialog');await productDrawer.locator('select').first().selectOption(id(30));
  assert.ok(await productDrawer.locator('input[name=nameZh]').inputValue());assert.equal(await productDrawer.locator('select[name=lifecycleStatus]').inputValue(),'DRAFT');assert.equal(await productDrawer.locator('input[name=code]').inputValue(),'AUTO');assert.equal(await productDrawer.locator('input[name=price]').inputValue(),'');
  await shot('usability-product-template',{width:1440,height:1000});await page.keyboard.press('Escape');
  await nav('/workflow-templates');const workflow=page.getByRole('dialog');await workflow.locator('select').first().selectOption('application');assert.equal(await workflow.locator('[data-workflow-step]').count(),5);await workflow.locator('select').first().selectOption('program');assert.equal(await workflow.locator('[data-workflow-step]').count(),4);await workflow.locator('select').first().selectOption('');assert.equal(await workflow.locator('[data-workflow-step]').count(),1);await workflow.locator('select').first().selectOption('program');await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await shot('usability-workflow-presets',{width:1440,height:1000});
  await page.keyboard.press('Escape');
  await nav('/students');await page.getByRole('button',{name:'新增学生',exact:true}).click();await page.getByRole('dialog').locator('input[name=nameZh]').waitFor();assert.equal(await page.getByRole('dialog').locator('.select-trigger[aria-label="联系人身份"]').isVisible(),false);await shot('usability-direct-student',{width:1440,height:1000});
  identityLoss=true;
  const studentDialog=page.getByRole('dialog');await studentDialog.locator('input[name=nameEn]').fill('Example recovery learner');await studentDialog.locator('input[name=grade]').fill('Grade 7');await studentDialog.locator('select[name=academicYear]').selectOption({value:'2026-2027'});await studentDialog.locator('.drawer-actions .primary-button').click();
  await studentDialog.locator('fieldset[disabled]').waitFor();await studentDialog.locator('.drawer-actions .primary-button:not([disabled])').click();await studentDialog.waitFor({state:'hidden'});assert.equal(identityWrites.length,2);assert.equal(identityWrites[0],identityWrites[1]);
  await page.evaluate(()=>window.workspaceScenario('refresh-failure'));await nav('/workflow-templates');const recovery=page.getByRole('dialog');await recovery.locator('select').first().selectOption('application');await recovery.locator('.drawer-actions .primary-button').click();await recovery.getByText('更改已保存，但刷新失败。请刷新页面查看最新数据。',{exact:true}).waitFor().catch(async()=>{assert.ok(await recovery.locator('[role=alert]').count());});
  await recovery.locator('.drawer-actions .primary-button:not([disabled])').click();await recovery.waitFor({state:'hidden'});assert.equal(workflowWrites.length,1,'refresh-only recovery must not repeat accepted save');
  overviewFailure=true;const errorStart=report.errors.length;await nav('/reports/executive');await page.getByText('synthetic-reference-333',{exact:true}).waitFor();await shot('usability-report-diagnostic',{width:1440,height:1000});
  const injectedErrors=report.errors.splice(errorStart);assert.ok(injectedErrors.every(error=>error.url.includes('/api/management/overview')&&['http','console','response'].includes(error.kind)),JSON.stringify(injectedErrors));report.warnings.push({kind:'injected-failure',message:'Expected synthetic overview HTTP 500; diagnostic and read-only retry verified'});
  overviewFailure=false;await page.locator('[role=alert]').getByRole('button').click();await page.locator('[data-testid=executive-kpis]').waitFor();
  await page.getByRole('button',{name:'QA English',exact:true}).click();await nav('/products');await page.locator('.page-heading-row button.primary-button').click();assert.ok(await page.getByRole('dialog').getByText('Use an existing product as a template',{exact:true}).count());
  report.checks={...report.checks,operationsUsability:'PASS: responsive domains, open lead assessment, aligned duplicate controls, shared pagination, charts, product draft copy, two presets, direct student entry, keyboard and English'};
 }finally{await context.close();}
};
