/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  require('tsx/cjs');const {en}=require('../lib/i18n/locales/en.ts'),{zhCN:zh}=require('../lib/i18n/locales/zh-CN.ts');
  const {recoveryRows}=require('../tests/fixtures/recycle-recovery-data.ts');
  const rows=structuredClone(recoveryRows),posts=[],reads=[],receipts=new Map();
  let readFailure=false,loseRestore=false,failAfterRestore=false,staleNext=false,held=null,holdNext=false,holdResolve=()=>{};
  const holdRead=()=>new Promise(resolve=>{holdResolve=resolve;holdNext=true;});
  const page=await context.newPage();page.setDefaultTimeout(3500);
  page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message.slice(0,200)}));
  assert.equal((await(await page.goto(base+'/api/health')).json()).version,report.evidence.appVersion);
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname!=='/api/recycle-bin')return route.fulfill({json:{items:[],total:0}});
   if(request.method()==='POST'){
    const body=request.postDataJSON();posts.push(request.postData());assert.ok(body.requestKey);assert.ok(body.expectedDeletedAt.endsWith('123456Z'));
    let result=receipts.get(body.requestKey);
    if(!result){
     const index=rows.findIndex(row=>row.id===body.id&&row.kind===body.kind);assert.ok(index>=0);
     if(staleNext){staleNext=false;rows[index].deletedAt='2026-10-21T03:00:00.123456Z';rows[index].purgeEligibleAt='2026-11-20T03:00:00.123456Z';return route.fulfill({status:409,json:{code:'RECYCLE_VERSION_CONFLICT'}});}
     assert.equal(body.expectedDeletedAt,rows[index].deletedAt);rows.splice(index,1);result={id:body.id,kind:body.kind,restored:true};receipts.set(body.requestKey,result);
    }
    if(failAfterRestore){failAfterRestore=false;readFailure=true;}if(loseRestore){loseRestore=false;return route.abort('failed');}
    return route.fulfill({json:result});
   }
   const params=url.searchParams;reads.push(Object.fromEntries(params));if(readFailure)return route.fulfill({status:503,json:{code:'RECYCLE_LOAD_FAILED'}});
   const q=(params.get('q')||'').trim().toLowerCase(),kind=params.get('kind')||'all',retention=params.get('retention')||'all',number=Number(params.get('page')||1),size=Number(params.get('pageSize')||20),scope=params.get('scope')||'personal';
   const selected=rows.filter(row=>(kind==='all'||row.kind===kind)&&(!q||(row.labelZh+' '+row.labelEn+' '+row.id).toLowerCase().includes(q))&&(retention==='all'||retention==='eligible'&&row.purgeEligibleAt&&Date.parse(row.purgeEligibleAt)<=Date.now()||retention==='retained'&&(!row.purgeEligibleAt||Date.parse(row.purgeEligibleAt)>Date.now())));
   const result={scope,total:selected.length,page:number,pageSize:size,items:selected.slice((number-1)*size,number*size)};
   if(holdNext){holdNext=false;held={route,result};holdResolve();return;}return route.fulfill({json:result});
  });
  const bundle=await build({entryPoints:['tests/fixtures/recycle-recovery-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome156',alias:{'next/link':path.resolve('tests/fixtures/qa-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx'),'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional recovery QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>Boolean(window.recoveryNavigate));
  const nav=href=>page.evaluate(href=>window.recoveryNavigate(href),href);
  const locale=value=>page.evaluate(value=>window.recoveryLocale(value),value);
  const settled=()=>page.waitForFunction(()=>document.querySelector('.recycle-bin')?.getAttribute('aria-busy')==='false'&&document.querySelector('.recycle-bin')?.getAttribute('data-recovery-current')==='true');
  const shot=async(label,checks)=>{await page.evaluate(async()=>{await document.fonts.ready;document.activeElement?.blur();window.scrollTo(0,0);await new Promise(requestAnimationFrame);});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,label);assert.ok(await page.locator('.recovery-filters > .field').evaluateAll(nodes=>nodes.every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;})),label);await page.screenshot({path:path.join(output,label+'.png'),fullPage:true});report.pages.push({label,viewport:page.viewportSize(),checks,boundary:'Actual recovery/AppShell components and production CSS with fictional API responses. Database tested independently.'});process.stdout.write(`[QA recovery] ${label} passed\n`);};
  for(const lang of ['zh-CN','en'])for(const width of [1440,375,320]){
   const text=lang==='en'?en:zh;await page.setViewportSize({width,height:1000});await locale(lang);await nav('/recycle-bin?context=fictional');await settled();
   await page.locator('.recycle-bin .pagination button').filter({hasText:/^2$/}).click();await page.waitForFunction(()=>document.querySelectorAll('.recycle-list article').length===3);assert.equal(new URL(page.url()).searchParams.get('page'),'2');
   await page.locator('.recovery-filters select').nth(0).selectOption('TASK');await settled();assert.equal(new URL(page.url()).searchParams.has('page'),false);
   await page.locator('.recovery-filters select').nth(1).selectOption('eligible');await settled();assert.equal(reads.at(-1).retention,'eligible');
   await page.evaluate(()=>history.back());await page.waitForFunction(()=>new URLSearchParams(location.search).get('retention')===null);await settled();
   const input=page.locator('.recovery-filters input');await input.fill('Fictional ');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='Fictional ');assert.equal(await input.inputValue(),'Fictional ');
   await page.getByRole('button',{name:text['recovery.reset'],exact:true}).click();await settled();assert.equal(new URL(page.url()).searchParams.get('context'),'fictional');
   if(width<=375)assert.ok(await page.locator('.recycle-list article').first().evaluate(node=>node.getBoundingClientRect().height<240),'mobile cards remain content-sized');
   await shot(`recovery-${lang}-${width}`,['server pages','kind/retention URL views','history','multiword typing','context preservation','retention copy','responsive card density']);
   if(width<=375)await page.screenshot({path:path.join(output,`recovery-${lang}-${width}-viewport.png`)});
  }
  await locale('en');await page.setViewportSize({width:1440,height:1000});
  // Finish the actual last page, then verify both the displayed page and URL are corrected.
  await page.locator('.recycle-bin .pagination button').filter({hasText:/^2$/}).click();await settled();
  for(let n=0;n<3;n++){await page.locator('.recycle-list article button').first().click();const dialog=page.getByRole('dialog');await dialog.locator('.primary-button').click();await dialog.waitFor({state:'hidden'});await settled();}
  assert.equal(rows.length,20);assert.equal(new URL(page.url()).searchParams.has('page'),false);assert.equal(reads.at(-1).page,'1');
  readFailure=true;await page.getByRole('button',{name:en['recovery.refresh'],exact:true}).click();await page.getByText(en['recovery.readFailed'],{exact:true}).waitFor();assert.ok(await page.locator('.recycle-list article button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));
  readFailure=false;await page.getByRole('button',{name:en['recovery.refresh'],exact:true}).click();await settled();
  const waiting=holdRead();await page.getByRole('button',{name:en['recovery.refresh'],exact:true}).click();await waiting;assert.ok(await page.locator('.recycle-list article button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));
  await page.locator('.recovery-filters input').fill('No fictional match');await page.getByText(en['recovery.emptyFiltered'],{exact:true}).waitFor();await held.route.fulfill({json:held.result}).catch(()=>{});held=null;assert.equal(await page.locator('.recycle-list article').count(),0);
  await page.getByRole('button',{name:en['recovery.reset'],exact:true}).click();await settled();
  await page.locator('.recycle-list article button').first().click();let dialog=page.getByRole('dialog');await page.waitForFunction(()=>!document.querySelector('.toast'));loseRestore=true;const before=posts.length;await dialog.locator('.primary-button').evaluate(button=>{button.click();button.click();});await dialog.getByText(en['recovery.uncertain'],{exact:true}).waitFor();assert.equal(posts.length,before+1);assert.equal(await page.locator('.recovery-record-link').count(),0);await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);assert.equal(await dialog.getByRole('button',{name:en['common.cancel'],exact:true}).isDisabled(),true);
  await page.setViewportSize({width:375,height:1000});await shot('recovery-uncertain-en-375',['mobile uncertain confirmation','locked selection and dismissal','original-request retry']);
  await locale('zh-CN');await dialog.getByRole('button',{name:zh['business.retrySame'],exact:true}).click();await dialog.waitFor({state:'hidden'});await settled();assert.equal(posts.at(-1),posts.at(-2));await page.locator('.recovery-record-link[href^="/tasks/"]').waitFor();
  await locale('en');await page.setViewportSize({width:1440,height:1000});await page.locator('.recycle-list article button').first().click();dialog=page.getByRole('dialog');failAfterRestore=true;const writes=posts.length;await dialog.locator('.primary-button').click();await dialog.waitFor({state:'hidden'});await page.getByText(en['recovery.refreshOnly'],{exact:true}).waitFor();assert.equal(posts.length,writes+1);readFailure=false;await page.getByRole('button',{name:en['recovery.refresh'],exact:true}).click();await settled();assert.equal(posts.length,writes+1);
  await page.locator('.recycle-list article button').first().click();dialog=page.getByRole('dialog');staleNext=true;const previousRows=rows.length;await dialog.locator('.primary-button').click();await dialog.getByText(en['recovery.conflict'],{exact:true}).waitFor();assert.equal(rows.length,previousRows);await dialog.getByRole('button',{name:en['common.cancel'],exact:true}).click();await page.getByRole('button',{name:en['recovery.refresh'],exact:true}).click();await settled();
  await shot('recovery-lifecycle',['last-page correction','failed read/load gating','late read discarded','immediate duplicate prevention','exact retry across locale','locked uncertain confirmation','restore accepted/refresh-only','newer deletion retained','known restored detail link']);
  await nav('/admin/recycle-bin');await page.evaluate(()=>window.recoveryScope(false));await page.getByRole('heading',{name:zh['recycle.title'],exact:true}).waitFor();await locale('en');await page.getByRole('button',{name:en['recovery.refresh'],exact:true}).click();await settled();assert.equal(reads.at(-1).scope,'workspace');await shot('workspace-recovery',['explicit administrative scope','same recovery experience']);
  readFailure=true;await page.evaluate(()=>window.recoveryInitialFailure());await page.getByText(en['recovery.readFailed'],{exact:true}).waitFor();assert.equal(await page.getByText(en['recycle.empty'],{exact:true}).count(),0);readFailure=false;await page.getByRole('button',{name:en['recovery.refresh'],exact:true}).click();await settled();assert.ok(await page.locator('.recycle-list article').count());await shot('initial-recovery',['initial failure remains unavailable','explicit refresh recovers without a reload']);
 }finally{await context.close();}
};
