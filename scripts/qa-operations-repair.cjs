/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report,observe})=>{
 const context=await browser.newContext({bypassCSP:true,locale:'zh-CN'});
 try{
  require('tsx/cjs');const {studentRecord,householdRecord}=require('../tests/fixtures/record-workspaces.ts');const {repairEnrollment,repairApplication}=require('../tests/fixtures/operations-repair-data.ts');
  const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
  assert.ok((await page.goto(base+'/api/health'))?.ok());
  const requests=[],postBodies=[];let removed=false;
  const item={id:studentRecord.id,label:'示例可删除记录',revision:1,updatedAt:'2026-10-07T04:00:00.123456Z',status:'DRAFT',canDelete:true,blockedReason:null};
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());requests.push(url.pathname+'?'+url.searchParams);
   if(url.pathname==='/api/record-deletions'){
    if(request.method()==='POST'){postBodies.push(request.postDataJSON());removed=true;return route.fulfill({json:{saved:true}});}
    return route.fulfill({json:{items:removed?[]:[item],total:removed?0:1}});
   }
   if(url.pathname==='/api/enrollments'&&url.searchParams.get('resource')==='options')return route.fulfill({json:{items:[{value:repairEnrollment.cohort_id,labelZh:'示例班期 A',labelEn:'Example Cohort A'}]}});
   if(['/api/enrollments','/api/applications'].includes(url.pathname))return route.fulfill({json:{items:[url.pathname==='/api/enrollments'?repairEnrollment:repairApplication],total:1,page:1,pageSize:20}});
   if(url.pathname==='/api/education'){
    const resource=url.searchParams.get('resource');return route.fulfill({json:resource==='studentDetail'?{item:studentRecord}:{items:resource==='households'?[householdRecord]:[studentRecord],total:1,page:1,pageSize:10}});
   }
   if(url.pathname==='/api/search/related')return route.fulfill({json:{items:[{value:'STUDENT:'+studentRecord.id,labelZh:'学生甲',labelEn:'Student A'}]}});
   if(url.pathname==='/api/crm/people')return route.fulfill({json:{items:[{id:studentRecord.personId,primary:'顾问甲',secondary:'示例教育机构',status:'ACTIVE',meta:'Advisor A',extra:'advisor@example.test',completeness:80,bilingualName:{zh:'顾问甲',en:'Advisor A'}}],total:1,metrics:{total:1,needsAttention:0,averageCompleteness:80}}});
   if(url.pathname==='/api/notifications')return route.fulfill({json:{items:[],total:0,unread:0,page:1,pageSize:20}});
   return route.fulfill({json:{items:[],total:0,page:1,pageSize:20}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/operations-repair-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Operational repair synthetic QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const nav=href=>page.evaluate(href=>window.repairNavigate(href),href);
  for(const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:375,height:812}]){
   await page.setViewportSize(viewport);
   for(const route of ['/people','/students','/households?tab=families','/progression','/enrollments','/applications','/record-cleanup']){
    await nav(route);await page.waitForTimeout(160);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,route+' overflow');
    const first=route==='/students'||route.startsWith('/households')?await page.locator('.v200-list article').first().boundingBox():route==='/record-cleanup'?await page.locator('.detail-record-list article').first().boundingBox():null;if(viewport.width===375&&first)assert.ok(first.y<812,route+' first record below viewport');
    if(route==='/enrollments'&&viewport.width>=1440){const controls=await page.locator('.search-filter-bar').evaluate(element=>[element.querySelector('.search-field'),element.querySelector('.select-trigger'),element.querySelector('select')].map(control=>({top:control.getBoundingClientRect().top,height:control.getBoundingClientRect().height})));assert.ok(Math.max(...controls.map(control=>control.top))-Math.min(...controls.map(control=>control.top))<=3,'primary filter controls must align');assert.ok(controls.every(control=>control.height<=40),'desktop controls must remain compact');}
    const file='repair-'+route.split('?')[0].slice(1)+'-'+viewport.width+'.png';await page.screenshot({path:path.join(output,file)});
    report.pages.push({path:route,viewport,status:'PASS',screenshot:file,firstRecordTop:first?.y});
   }
  }
  for(const route of ['/enrollments','/applications']){
   await nav(route);await page.locator('.enrollment-records article').first().waitFor();await page.getByRole('button',{name:/^筛选 ·/}).click();const drawer=page.getByRole('dialog'),endpoint=route==='/enrollments'?'/api/enrollments':'/api/applications',before=requests.filter(request=>request.startsWith(endpoint)&&!request.includes('resource=options')).length;
   const choose=drawer.locator('.select-trigger').first();await choose.click();await drawer.getByRole('option').first().click();await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});assert.equal(requests.filter(request=>request.startsWith(endpoint)&&!request.includes('resource=options')).length,before,'cancel must not apply related filters');
  }
  await nav('/record-cleanup');await page.getByText('示例可删除记录',{exact:true}).waitFor();
  const select=page.locator('.search-filter-bar select');assert.equal(await select.locator('option').count(),44);
  await select.selectOption('CHANNEL_AGREEMENT_VERSION');await page.getByText('示例可删除记录',{exact:true}).waitFor();
  await page.getByRole('button',{name:'删除 示例可删除记录',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'删除',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(postBodies.length,1);assert.equal(postBodies[0].kind,'CHANNEL_AGREEMENT_VERSION');assert.equal(postBodies[0].expectedUpdatedAt,item.updatedAt);assert.ok(postBodies[0].requestKey);
  await nav('/people');await page.waitForTimeout(160);await page.getByRole('button',{name:/^筛选 ·/}).click();const contactDialog=page.getByRole('dialog');const before=requests.filter(request=>request.startsWith('/api/crm/people')).length;await contactDialog.locator('select').selectOption('PARENT');await page.keyboard.press('Escape');await contactDialog.waitFor({state:'hidden'});assert.equal(requests.filter(request=>request.startsWith('/api/crm/people')).length,before);
  await nav('/progression');await page.locator('.compact-task-controls .select-trigger').click();await page.getByRole('listbox').getByRole('option',{name:'学生甲',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'选择学生，修正年级与学年'}).waitFor();await page.keyboard.press('Escape');
  report.pages.push({path:'operations-behavior',status:'PASS',notes:'44 resource choices; precise deletion token; contact draft cancellation; searchable academic correction. Actual components/CSS, mocked APIs; not DB/RLS evidence.'});
 }catch(error){const page=context.pages()[0];if(page){fs.writeFileSync(path.join(output,'failure.html'),await page.content());await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}throw error;}finally{await context.close();}
};
