/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report,observe})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
  assert.ok((await page.goto(base+'/api/health'))?.ok());
  let eligibility='DELETE_ELIGIBLE',retentionMode='NONE',lose=false;const writes=[];
  await page.route(base+'/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()==='POST'){writes.push({url:url.pathname,body:req.postData()});if(lose){lose=false;return route.abort('aborted');}return route.fulfill({json:{item:{status:'REMOVED'}}});}
   if(url.pathname.endsWith('/removal'))return route.fulfill({json:{status:eligibility,retentionMode}});
   if(url.pathname==='/api/admin/users')return route.fulfill({json:{items:[{id:'00000000-0000-4000-8000-000000000401',username:'fictional.staff',displayNameZh:'示例员工',displayNameEn:'Fictional Staff',email:'staff@example.test',role:'SALES_SPECIALIST',status:'ACTIVE',lastSignInAt:null,mfaEnabled:true,onboardingStatus:'ACTIVE',invitationDeliveryStatus:null,teams:[]}],total:1}});
   if(url.pathname==='/api/admin/teams')return route.fulfill({json:{items:[],leadCandidates:[]}});
   return route.fulfill({json:{items:[],total:0}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/staff-lifecycle-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',outdir:'work/v336/browser-bundle'});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional staff QA</title></head><body><div id="root"></div></body></html>');
  for(const f of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(f=>f.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+f.replaceAll('\\','/')});
  for(const f of bundle.outputFiles.filter(f=>f.path.endsWith('.css')))await page.addStyleTag({content:f.text});
  await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
  const shot=async label=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label);await page.screenshot({path:path.join(output,label+'.png')});report.pages.push({label,viewport:page.viewportSize(),boundary:'Actual staff React components and production CSS; fictional API responses. DB security tested separately.'});process.stdout.write(`[QA staff] ${label} passed\n`);};
  const open=async mode=>{await page.evaluate(mode=>window.staffQaMode(mode),mode);await page.getByRole('dialog').waitFor();};
  await page.setViewportSize({width:1440,height:1000});await page.locator('.staff-user-row').first().waitFor();await shot('staff-list-zh');
  await open('business');let dialog=page.getByRole('dialog');await dialog.getByLabel('主要岗位',{exact:true}).selectOption('FINANCE');await dialog.getByRole('group',{name:'兼任岗位'}).getByText('销售',{exact:true}).click();await dialog.getByLabel('批准原因 / 依据').fill('Fictional scope approval');
  await shot('staff-business-zh');await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body));
  await page.setViewportSize({width:390,height:844});await shot('staff-business-mobile');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'QA English',exact:true}).click();await open('role');dialog=page.getByRole('dialog');const options=await dialog.locator('select option').evaluateAll(nodes=>nodes.map(n=>n.value));assert.ok(options.includes('FINANCE_SPECIALIST'));assert.ok(!options.includes('ADMIN')&&!options.includes('SUPER_ADMIN'));await shot('staff-role-en-mobile');await page.keyboard.press('Escape');
  await page.setViewportSize({width:768,height:1000});await open('business');dialog=page.getByRole('dialog');await dialog.getByLabel('Approval reason / reference').fill('Fictional approved qualification');await page.evaluate(()=>window.staffQaRefreshFails=true);lose=true;
  await dialog.locator('.drawer-actions .primary-button').click();await dialog.getByRole('button',{name:/Retry/}).waitFor();assert.equal(writes.length,1);await dialog.getByRole('button',{name:/Retry/}).click();await dialog.getByRole('button',{name:'Refresh',exact:true}).waitFor();assert.equal(writes.length,2);assert.equal(writes[0].body,writes[1].body);await dialog.getByRole('button',{name:'Refresh',exact:true}).click();assert.equal(writes.length,2);await shot('staff-business-refresh-only');await page.keyboard.press('Escape');
  eligibility='DEACTIVATION_REQUIRED';await open('remove');dialog=page.getByRole('dialog');await dialog.getByText(/Suspend this account first/).waitFor();assert.ok(await dialog.getByRole('button',{name:'Remove account',exact:true}).isDisabled());await shot('staff-removal-suspend-first');await page.keyboard.press('Escape');
  eligibility='DELETE_ELIGIBLE';retentionMode='AUDIT_IDENTITY';await open('remove');dialog=page.getByRole('dialog');await dialog.getByText(/Only historical audit references remain/).waitFor();await shot('staff-removal-retained-audit');await page.keyboard.press('Escape');retentionMode='NONE';
  eligibility='BUSINESS_REFERENCES_EXIST';await open('remove');dialog=page.getByRole('dialog');await dialog.getByText(/Current business links still require/).waitFor();assert.ok(await dialog.getByRole('button',{name:'Remove account',exact:true}).isDisabled());await shot('staff-removal-blocked');await page.keyboard.press('Escape');
  eligibility='DELETE_ELIGIBLE';await open('remove');dialog=page.getByRole('dialog');await dialog.getByRole('checkbox').check();await shot('staff-removal-confirmation');lose=true;await dialog.getByRole('button',{name:'Remove account',exact:true}).click();await dialog.getByRole('button',{name:/Retry/}).waitFor();const first=writes.at(-1);await dialog.getByRole('button',{name:/Retry/}).click();await dialog.getByRole('button',{name:'Refresh',exact:true}).waitFor();assert.equal(writes.at(-1).body,first.body);const count=writes.length;await dialog.getByRole('button',{name:'Refresh',exact:true}).click();assert.equal(writes.length,count);await shot('staff-removal-accepted-refresh-only');await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await shot('staff-list-en-mobile');await page.getByRole('button',{name:'QA 中文',exact:true}).click();await shot('staff-list-zh-mobile');
  report.checks??={};
  report.checks.staffLifecycle='PASS: bilingual list, business/role editors, least-privilege role choices, eligibility/blocked removal, confirmation, mobile/tablet, keyboard/focus, exact uncertain retry and accepted refresh-only recovery.';
 }finally{await context.close();}
};
