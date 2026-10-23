/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  require('tsx/cjs');const {en}=require('../lib/i18n/locales/en.ts');
  const page=await context.newPage();page.setDefaultTimeout(3500);page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message.slice(0,200)}));
  assert.equal((await(await page.goto(base+'/api/health')).json()).version,report.evidence.appVersion);
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const rows=Array.from({length:13},(_,n)=>({id:id(n+1),revision:1,ruleKey:'CONTACT_METHOD_MISSING',entityType:'TASK',entityId:id(100+n),severity:n%2?'MEDIUM':'HIGH',titleKey:'quality.rule.contactMethodMissing',details:{reference:'Fictional quality reference'},status:n===12?'RESOLVED':n===0?'ASSIGNED':'OPEN',assignedTo:n===0?id(99):null,resolution:n===12?'Fictional reviewed resolution':'',lastSeenAt:'2026-10-23T00:00:00Z'}));
  let readFailure=false,loseWrite=false,failAfterWrite=false,partial=false;const posts=[],reads=[],receipts=new Map();let rule={id:id(90),revision:1,ruleKey:'CONTACT_METHOD_MISSING',enabled:true,severity:'HIGH',updatedAt:'2026-10-23T00:00:00Z'};
  await page.route('**/api/data-quality**',async route=>{
   const req=route.request(),params=new URL(req.url()).searchParams;
   if(req.method()==='POST'){
    posts.push(req.postData());const command=req.postDataJSON();
    if(!receipts.has(command.requestKey)){
     if(command.operation==='configure')rule={...rule,enabled:command.enabled,severity:command.severity,revision:rule.revision+1};
     const row=rows.find(row=>row.id===command.id);
     if(row&&command.operation==='resolve'){row.status=command.dismiss?'DISMISSED':'RESOLVED';row.resolution=command.resolution;row.revision++;}
     if(row&&command.operation==='assign'){row.status='ASSIGNED';row.assignedTo=id(99);row.revision++;}
     if(command.operation==='run')rows.filter(row=>['OPEN','ASSIGNED'].includes(row.status)).forEach(row=>row.revision++);
     receipts.set(command.requestKey,true);
    }
    if(failAfterWrite){readFailure=true;failAfterWrite=false;}if(loseWrite){loseWrite=false;return route.abort('failed');}
    return route.fulfill({json:{item:true}});
   }
   reads.push(Object.fromEntries(params));if(readFailure)return route.fulfill({status:503,json:{code:'QUALITY_LOAD_FAILED'}});
   const status=params.get('status')||'active',assignment=params.get('assignment')||'all',severity=params.get('severity')||'all',q=params.get('q')||'',number=Number(params.get('page')||1),size=Number(params.get('pageSize')||10);
   const selected=rows.filter(row=>(status==='all'||status==='active'&&['OPEN','ASSIGNED'].includes(row.status)||row.status===status)&&(severity==='all'||row.severity===severity)&&(assignment==='all'||assignment==='mine'&&row.assignedTo===id(99)||assignment==='unassigned'&&!row.assignedTo)&&(!q||row.ruleKey.toLowerCase().includes(q.toLowerCase())));
   return route.fulfill({json:{items:selected.slice((number-1)*size,number*size),total:selected.length,page:number,pageSize:size,trend:[],rules:partial?[]:[rule],unavailable:partial?['trend','rules']:[]}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/quality-triage-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome156',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/qa-link.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional quality governance QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>Boolean(window.triageNavigate));
  const nav=async href=>page.evaluate(href=>window.triageNavigate(href),href);
  const settled=async()=>page.waitForFunction(()=>document.querySelector('.quality-list')?.getAttribute('aria-busy')==='false'&&!document.querySelector('.quality-page > p[role=status]'));
  const shot=async(label,checks)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,label);assert.equal(await page.locator('.quality-triage-filters>.field').evaluateAll(nodes=>nodes.every(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1;})),true,label+': filters visible');await page.screenshot({path:path.join(output,label+'.png'),fullPage:true});report.pages.push({label,viewport:page.viewportSize(),checks,boundary:'Actual components and production CSS with fictional requests; database invariants tested separately.'});process.stdout.write(`[QA quality] ${label} passed\n`);};
  for(const locale of ['zh-CN','en'])for(const width of [1440,375]){
   const en=locale==='en';await page.setViewportSize({width,height:1000});await page.evaluate(locale=>window.triageLocale(locale),locale);await nav('/data-quality?context=example');await settled();
   await page.locator('.quality-list .pagination button').filter({hasText:/^2$/}).click();await page.waitForFunction(()=>document.querySelectorAll('.quality-row').length===2);
   await page.locator('.quality-triage-filters select').nth(0).selectOption('RESOLVED');await page.getByText('Fictional reviewed resolution',{exact:true}).waitFor();assert.equal(await page.locator('.quality-actions').count(),0);assert.equal(new URL(page.url()).searchParams.get('context'),'example');
   await page.locator('.quality-triage-filters select').nth(1).selectOption('HIGH');await settled();await page.evaluate(()=>history.back());await page.waitForFunction(()=>new URLSearchParams(location.search).get('severity')===null);await settled();
   await page.getByRole('button',{name:en?'Reset quality filters':'重置质量筛选',exact:true}).click();await settled();
   await page.locator('.quality-triage-filters select').nth(2).selectOption('mine');await page.waitForFunction(()=>document.querySelectorAll('.quality-row').length===1);assert.equal(reads.at(-1).assignment,'mine');assert.equal(await page.locator('.quality-row a[href^="/tasks/"]').count(),1);
   await shot(`triage-${locale}-${width}`,['URL category/history','retained history read-only','page reset','owner filter','task deep link','responsive']);
  }
  await nav('/data-quality');await settled();const search=page.locator('.quality-triage-filters input');await search.fill('Fictional ');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='Fictional ');assert.equal(await search.inputValue(),'Fictional ');await search.press('End');await search.pressSequentially('record');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='Fictional record');assert.equal(await search.inputValue(),'Fictional record');await nav('/data-quality');await settled();partial=true;await page.getByRole('button',{name:'Refresh quality workspace',exact:true}).click();await page.getByText(/Supplementary information is unavailable/).waitFor();assert.equal(await page.locator('.quality-row').count(),10);await shot('quality-partial',['queue survives optional sources']);partial=false;
  readFailure=true;await page.getByRole('button',{name:'Refresh quality workspace',exact:true}).click();await page.getByText(/Loading failed. Previous results/).waitFor();assert.ok(await page.locator('.quality-actions button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));readFailure=false;await page.getByRole('button',{name:'Refresh quality workspace',exact:true}).click();await settled();
  const row=page.locator(`.quality-row[data-issue-id="${id(2)}"]`);await row.getByRole('button',{name:en['quality.dismiss'],exact:true}).click();await row.locator('textarea').fill('Fictional reviewed exception');loseWrite=true;const before=posts.length;await row.locator('.quality-resolution-form .primary-button').evaluate(button=>{button.click();button.click();});await page.getByText(/result is unconfirmed/).waitFor();assert.equal(posts.length,before+1);assert.equal(await row.locator('textarea').isDisabled(),true);
  await page.evaluate(()=>window.triageLocale('zh-CN'));await page.getByRole('button',{name:'重试并确认保存结果',exact:true}).click();await row.waitFor({state:'hidden'});assert.equal(posts.at(-1),posts.at(-2));await shot('quality-uncertain-retry',['exact bytes across locale','synchronous duplicate guard','locked uncertain draft','confirmed dismissal removed from active queue']);
  await page.evaluate(()=>window.triageLocale('en'));failAfterWrite=true;const count=posts.length;await page.locator('.quality-actions button').filter({hasText:en['quality.assignToMe']}).first().click();await page.getByText(/operation was accepted, but refreshing/).waitFor();assert.equal(posts.length,count+1);readFailure=false;await page.getByRole('button',{name:'Refresh quality workspace',exact:true}).click();await settled();assert.equal(posts.length,count+1);assert.equal(await page.getByText(/operation was accepted, but refreshing/).count(),0);
  await page.locator('.quality-rules summary').click();await page.locator('.quality-rule-enabled input').click();await page.waitForFunction(()=>document.querySelector('.quality-rule-enabled input')?.checked===false);await settled();assert.equal(rule.enabled,false);assert.equal(JSON.parse(posts.at(-1)).operation,'configure');assert.equal(JSON.parse(posts.at(-1)).expectedRevision,1);await shot('quality-refresh-only',['accepted save survives GET failure','refresh never repeats POST','revision-bound rule edit']);
  // Resolve the last row on page 2 and verify an actual server fetch of page 1.
  await page.locator('.quality-list .pagination button').filter({hasText:/^2$/}).click();await settled();assert.equal(await page.locator('.quality-row').count(),1);const last=page.locator('.quality-row');await last.getByRole('button',{name:en['quality.dismiss'],exact:true}).click();await last.locator('textarea').fill('Fictional final-page dismissal');await last.locator('.quality-resolution-form .primary-button').click();await page.waitForFunction(()=>document.querySelector('.quality-list .pagination [aria-current=page]')?.textContent==='1'&&document.querySelectorAll('.quality-row').length===10);await settled();assert.equal(await page.locator('.quality-list .pagination [aria-current=page]').innerText(),'1');assert.equal(reads.at(-1).page,'1');await shot('quality-page-correction',['last-row closure corrects actual page']);
 }finally{await context.close();}
};
