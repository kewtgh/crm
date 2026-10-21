/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report,observe})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
  assert.ok((await page.goto(base+'/api/health'))?.ok());
  const approvalPage={items:[{id:'00000000-0000-4000-8000-000000000601',requesterId:'00000000-0000-4000-8000-000000000099',requestNumber:'FICTIONAL-APPROVAL',type:'crmExport',object:'Fictional request',requester:'Advisor A',submitted:'2026-10-21T00:00:00Z',level:'teamLead',reason:'Fictional personal request',status:'pending',executionStatus:'NOT_STARTED'}],total:1,page:1,pageSize:10,summary:{pending:1,approved:0,rejected:0,highPrivilegePending:0}};
  await page.route(base+'/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/approvals'?approvalPage:{items:[],total:0,page:1,pageSize:10,unread:0}}));
  const bundle=await build({entryPoints:['tests/fixtures/ux-foundation-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional personal governance QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(f=>f.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>Boolean(window.uxRole));
  const shot=async label=>{await page.screenshot({path:path.join(output,label+'.png')});const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,className:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right}))}));if(layout.scroll>layout.width+1)fs.writeFileSync(path.join(output,label+'-layout.json'),JSON.stringify(layout,null,2));assert.ok(layout.scroll<=layout.width+1,label);report.pages.push({label,viewport:page.viewportSize(),boundary:'Actual AppShell/approval/recycle components and production CSS; fictional API records. RLS tested separately.'});process.stdout.write(`[QA personal] ${label} passed\n`);};
  for(const role of ['SALES_MANAGER','FINANCE_SPECIALIST','SALES_SUPPORT']){
   await page.setViewportSize({width:1440,height:1000});
   await page.evaluate(role=>{window.uxRole(role);window.uxNavigate('/approvals');},role);
   await page.locator('.approval-item').waitFor();
   const admin=page.locator('[id="space-ux.space.admin"]');
   assert.deepEqual((await admin.locator('a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))).sort(),['/approvals','/recycle-bin']);
   assert.equal(await page.locator('.sidebar-nav a[href^="/admin"]').count(),0);
   assert.equal(await page.locator('.approval-item button').count(),0,'own requests cannot be approved by the requester');
   await shot(role.toLowerCase()+'-personal-approvals');
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.uxNavigate('/recycle-bin'));
   await page.getByRole('heading',{name:'我的回收站',exact:true}).waitFor();
   await shot(role.toLowerCase()+'-personal-recycle-mobile');
  }
  await page.setViewportSize({width:1440,height:1000});await page.locator('.locale-switcher').first().click();
  await page.getByRole('heading',{name:'My recycle bin',exact:true}).waitFor();await shot('personal-recycle-en');
  await page.evaluate(()=>window.uxNavigate('/approvals'));await page.getByRole('heading',{name:'My approvals',exact:true}).waitFor();await shot('personal-approvals-en');
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{window.uxRole('ADMIN');window.uxNavigate('/admin/users');});
  await page.locator('.sidebar-nav a[href="/admin/users"]').waitFor();await shot('administrator-navigation');
 }finally{await context.close();}
};
