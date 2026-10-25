/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  require('tsx/cjs');const {en}=require('../lib/i18n/locales/en.ts'),{zhCN:zh}=require('../lib/i18n/locales/zh-CN.ts');
  const {approvalRows,approvalId:id}=require('../tests/fixtures/approval-review-data.ts');
  const rows=structuredClone(approvalRows),posts=[],reads=[],receipts=new Map();
  let backendRole='ADMIN',readFailure=false,loseResponse=false,denyConfirmation=false,executionFailure=false,failAfter=false,staleNext=false,holdNext=false,held=null,heldResolve=()=>{},revision=100;
  const page=await context.newPage();page.setDefaultTimeout(3500);
  page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message.slice(0,200)}));
  assert.equal((await(await page.goto(base+'/api/health')).json()).version,report.evidence.appVersion);
  const status=row=>row.status==='pending'&&Date.parse(row.expiresAt)<=Date.now()?'expired':row.status;
  const eligible=row=>!row.requestType.startsWith('REVENUE_')&&status(row)==='pending'&&(backendRole==='ADMIN'||backendRole==='SALES_MANAGER'&&row.level==='teamLead'&&row.requesterId!==id(99));
  const visible=()=>backendRole==='SALES_SPECIALIST'?rows.filter(row=>row.requesterId===id(99)):rows;
  const snapshot=params=>{
   const source=visible(),q=(params.get('q')||'').trim().toLowerCase(),type=params.get('type')||'all',filterStatus=params.get('status')||'pending',scope=params.get('scope')||'all',execution=params.get('execution')||'all',number=Number(params.get('page')||1),size=Number(params.get('pageSize')||10);
   const filtered=source.filter(row=>(!q||(row.requestNumber+' '+row.reason+' '+row.object).toLowerCase().includes(q))&&(type==='all'||row.type===type)&&(filterStatus==='all'||status(row)===filterStatus)&&(scope==='all'||scope==='mine'&&row.requesterId===id(99)||scope==='reviewable'&&eligible(row))&&(execution==='all'||row.executionStatus===execution));
   return structuredClone({items:filtered.slice((number-1)*size,number*size).map(row=>({...row,status:status(row),canDecide:eligible(row)})),total:filtered.length,page:number,pageSize:size,asOf:new Date().toISOString(),summary:{pending:source.filter(row=>status(row)==='pending').length,approved:source.filter(row=>status(row)==='approved').length,rejected:source.filter(row=>status(row)==='rejected').length,cancelled:source.filter(row=>status(row)==='cancelled').length,expired:source.filter(row=>status(row)==='expired').length,failedExecution:source.filter(row=>row.executionStatus==='FAILED').length,highPrivilegePending:0}});
  };
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.startsWith('/api/approvals/')&&url.pathname.endsWith('/decision')){
    const body=request.postDataJSON(),target=url.pathname.split('/')[3],row=rows.find(row=>row.id===target);posts.push(request.postData());assert.ok(body.requestKey);assert.equal(body.expectedReviewToken.length,64);
    if(denyConfirmation){denyConfirmation=false;return route.fulfill({status:403,json:{code:'APPROVAL_ACCESS_DENIED'}});}
    let result=receipts.get(body.requestKey);
    if(!result){
     if(staleNext){staleNext=false;row.reviewToken=(++revision).toString(16).padStart(64,'0');row.reason='Changed fictional review context';return route.fulfill({status:409,json:{code:'APPROVAL_SNAPSHOT_CONFLICT'}});}
     assert.equal(body.expectedReviewToken,row.reviewToken);assert.ok(eligible(row));if(body.decision==='REJECTED')assert.ok(body.comment.trim());
     row.status=body.decision.toLowerCase();row.decisionReason=body.comment;row.decidedAt=new Date().toISOString();row.executionStatus=executionFailure?'FAILED':'SUCCEEDED';executionFailure=false;row.canDecide=false;row.reviewToken=(++revision).toString(16).padStart(64,'0');
     result={id:row.id,status:row.status,executionStatus:row.executionStatus,accepted:true};receipts.set(body.requestKey,result);
    }
    if(failAfter){failAfter=false;readFailure=true;}if(loseResponse){loseResponse=false;return route.abort('failed');}
    return route.fulfill({json:{item:result}});
   }
   if(url.pathname==='/api/approvals'){
    reads.push(Object.fromEntries(url.searchParams));if(readFailure)return route.fulfill({status:503,json:{code:'APPROVAL_LOAD_FAILED'}});
    const result=snapshot(url.searchParams);if(holdNext){holdNext=false;held={route,result};heldResolve();return;}return route.fulfill({json:result});
   }
   return route.fulfill({json:{items:[],total:0}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/approval-review-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome156',alias:{'next/link':path.resolve('tests/fixtures/qa-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx'),'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional approval QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>Boolean(window.approvalNavigate));
  const nav=href=>page.evaluate(href=>window.approvalNavigate(href),href),locale=value=>page.evaluate(value=>window.approvalLocale(value),value);
  const settled=()=>page.waitForFunction(()=>document.querySelector('.approval-workspace')?.getAttribute('data-approval-current')==='true'&&document.querySelector('.approval-workspace')?.getAttribute('aria-busy')==='false');
  const refresh=()=>page.getByRole('button',{name:en['approvalReview.refresh'],exact:true}).click();
  const shot=async(label,checks)=>{
   await page.evaluate(async()=>{await document.fonts.ready;document.activeElement?.blur();window.scrollTo(0,0);await new Promise(requestAnimationFrame);});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,label);
   assert.ok(await page.locator('.approval-filters select').evaluateAll(nodes=>nodes.every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;})),label);
   const modal=await page.getByRole('dialog').count()>0;
   if(modal)assert.ok(await page.getByRole('dialog').locator('.drawer-actions button').evaluateAll(nodes=>nodes.every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;})),label);
   await page.screenshot({path:path.join(output,label+'.png'),fullPage:!modal});report.pages.push({label,viewport:page.viewportSize(),checks,boundary:'Actual approval workspace/hook/AppShell and production CSS with fictional APIs; database authorization, receipts and business boundaries tested independently.'});process.stdout.write(`[QA approvals] ${label} passed\n`);
  };
  for(const lang of ['zh-CN','en'])for(const width of [1440,375,320]){
   const text=lang==='en'?en:zh;await page.setViewportSize({width,height:1000});await locale(lang);await nav('/admin/approvals?context=fictional');await settled();
   await page.locator('.approval-filters select').nth(2).selectOption('mine');await settled();assert.equal(reads.at(-1).scope,'mine');
   await page.locator('.approval-filters select').nth(1).selectOption('all');await settled();assert.equal(new URL(page.url()).searchParams.get('status'),'all');
   await page.locator('.approval-filters select').nth(3).selectOption('FAILED');await settled();await page.getByText(text['approvalReview.execution.FAILED'],{exact:true}).last().waitFor();
   await page.evaluate(()=>history.back());await page.waitForFunction(()=>new URLSearchParams(location.search).get('execution')===null);await settled();
   await page.locator('.approval-filters input').fill('Fictional approval ');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='Fictional approval ');assert.equal(await page.locator('.approval-filters input').inputValue(),'Fictional approval ');
   await page.getByRole('button',{name:text['approvalReview.reset'],exact:true}).click();await settled();assert.equal(new URL(page.url()).searchParams.get('context'),'fictional');
   await shot(`approvals-${lang}-${width}`,['URL/history personal/status/execution views','multiword search','context preservation','responsive bilingual requests and metrics']);
  }
  await locale('en');await page.setViewportSize({width:1440,height:1000});await nav('/admin/approvals?type=performanceSummary&page=3');await settled();assert.equal(await page.locator('.approval-record').count(),1);
  await page.locator('.approval-record button').first().click();let drawer=page.getByRole('dialog');await drawer.getByRole('button',{name:en['approval.approve'],exact:true}).click();await drawer.waitFor({state:'hidden'});await settled();assert.equal(new URL(page.url()).searchParams.get('page'),'2');assert.equal(reads.at(-1).page,'2');
  await nav('/admin/approvals');await settled();readFailure=true;await refresh();await page.getByText(en['approvalReview.readFailed'],{exact:true}).waitFor();assert.ok(await page.locator('.approval-record button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));readFailure=false;await refresh();await settled();
  const waiting=new Promise(resolve=>{heldResolve=resolve;holdNext=true;});await refresh();await waiting;assert.ok(await page.locator('.approval-record button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));
  await page.locator('.approval-filters input').fill('NO-FICTIONAL-MATCH');await page.getByText(en['approval.empty'],{exact:true}).waitFor();await held.route.fulfill({json:held.result}).catch(()=>{});held=null;assert.equal(await page.locator('.approval-record').count(),0);
  await page.getByRole('button',{name:en['approvalReview.reset'],exact:true}).click();await settled();
  await page.locator('.approval-record button').first().click();drawer=page.getByRole('dialog');await drawer.locator('textarea').fill('Fictional preserved review note');loseResponse=true;let before=posts.length;
  await drawer.getByRole('button',{name:en['approval.approve'],exact:true}).evaluate(node=>{node.click();node.click();});await drawer.getByText(en['approvalReview.uncertain'],{exact:true}).waitFor();assert.equal(posts.length,before+1);assert.equal(await drawer.locator('textarea').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await drawer.isVisible(),true);
  await page.setViewportSize({width:320,height:1000});await locale('zh-CN');await drawer.getByText(zh['approvalReview.uncertain'],{exact:true}).waitFor();await shot('approval-uncertain-mobile',['frozen reviewed snapshot','immediate duplicate guard','unknown outcome is not failure','locked fields and dismissal','narrow Chinese original-request confirmation']);
  denyConfirmation=true;await drawer.getByRole('button',{name:zh['approvalReview.confirmOriginal'],exact:true}).click();await drawer.getByRole('button',{name:zh['approvalReview.confirmOriginal'],exact:true}).waitFor();assert.equal(await drawer.locator('textarea').isDisabled(),true);
  await drawer.getByRole('button',{name:zh['approvalReview.confirmOriginal'],exact:true}).click();await drawer.waitFor({state:'hidden'});await settled();assert.equal(posts.length,before+3);assert.equal(posts.at(-1),posts.at(-2));assert.equal(posts.at(-1),posts.at(-3));await locale('en');await page.setViewportSize({width:1440,height:1000});
  await page.locator('.approval-record button').first().click();drawer=page.getByRole('dialog');await drawer.getByRole('button',{name:en['approval.reject'],exact:true}).click();await drawer.getByText(en['approval.rejectRequired'],{exact:true}).waitFor();await drawer.locator('textarea').fill('Fictional rejected context');executionFailure=true;before=posts.length;await drawer.getByRole('button',{name:en['approval.reject'],exact:true}).click();await drawer.waitFor({state:'hidden'});await page.getByText(en['approvalReview.executionFailed'],{exact:true}).waitFor();assert.equal(posts.length,before+1);
  await page.getByRole('button',{name:en['approvalReview.openFailures'],exact:true}).click();await settled();assert.equal(new URL(page.url()).searchParams.get('execution'),'FAILED');assert.equal(await page.locator('.approval-record button').count(),0);await shot('approval-execution-history',['required rejection note','accepted decision with failed execution','no duplicate decision retry','shareable failed-execution history']);
  await nav('/admin/approvals');await settled();await page.locator('.approval-record button').first().click();drawer=page.getByRole('dialog');failAfter=true;before=posts.length;await drawer.getByRole('button',{name:en['approval.approve'],exact:true}).click();await drawer.waitFor({state:'hidden'});await page.getByText(en['approvalReview.refreshOnly'],{exact:true}).waitFor();assert.equal(posts.length,before+1);readFailure=false;await refresh();await settled();assert.equal(posts.length,before+1);
  await page.locator('.approval-record button').first().click();drawer=page.getByRole('dialog');staleNext=true;await drawer.getByRole('button',{name:en['approval.approve'],exact:true}).click();await drawer.getByText(en['approvalReview.reload'],{exact:true}).first().waitFor();await drawer.getByRole('button',{name:en['common.cancel'],exact:true}).click();await settled();
  await nav('/admin/approvals?status=expired');await settled();assert.equal(await page.locator('.approval-record button').count(),0);await nav('/admin/approvals?status=cancelled');await settled();assert.equal(await page.locator('.approval-record button').count(),0);
  await nav('/admin/approvals?type=revenuePolicyVersion');await settled();await page.getByRole('heading',{name:en['approval.type.revenuePolicyVersion'],exact:true}).waitFor();assert.equal(await page.locator('.approval-record button').count(),0);await page.locator('.approval-record a[href="/finance/revenue"]').waitFor();
  await shot('approval-recovery-boundaries',['accepted decision with refresh failure','read-only refresh','stale snapshot refusal','expired and withdrawn history','truthful revenue type and specialized route']);
  await nav('/admin/approvals?type=performanceSummary');await settled();const expires=rows.find(row=>status(row)==='pending'&&row.type==='performanceSummary');expires.expiresAt=new Date(Date.now()+1800).toISOString();await refresh();await settled();await page.locator(`[data-approval-id="${expires.id}"] button`).click();drawer=page.getByRole('dialog');await page.waitForFunction(()=>document.querySelector('[role="dialog"] .primary-button')?.disabled===true);await drawer.getByText(en['approvalReview.reload'],{exact:true}).waitFor();await drawer.getByRole('button',{name:en['common.cancel'],exact:true}).click();
  backendRole='SALES_SPECIALIST';await nav('/approvals');await page.evaluate(()=>window.approvalRole('SALES_SPECIALIST'));await refresh();await settled();assert.equal(await page.locator('.approval-record button').count(),0);
  readFailure=true;await page.evaluate(()=>window.approvalInitialFailure(true));await page.getByText(en['approvalReview.readFailed'],{exact:true}).waitFor();assert.equal(await page.getByText(en['approval.empty'],{exact:true}).count(),0);readFailure=false;await refresh();await settled();await page.setViewportSize({width:320,height:1000});await shot('approval-personal-recovery',['live deadline gate','personal role without review controls','initial failure is unavailable rather than empty','explicit refresh recovery']);
 }catch(error){const page=context.pages()[0];if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.html'),await page.content().catch(()=>''));}throw error;}
 finally{await context.close();}
};
