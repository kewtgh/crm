/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  require('tsx/cjs');const {en}=require('../lib/i18n/locales/en.ts'),{zhCN:zh}=require('../lib/i18n/locales/zh-CN.ts');
  const {communicationRows,communicationMessages,communicationId:id}=require('../tests/fixtures/communications-recovery-data.ts');
  const rows=structuredClone(communicationRows),messages=new Map(rows.map(row=>[row.id,communicationMessages(row.id)])),posts=[],reads=[],receipts=new Map();
  let listFailure=false,threadFailure=false,loseResponse=false,failAfter=false,staleRetry=false,holdThread=false,held=null,heldResolve=()=>{},sequence=500;
  const page=await context.newPage();page.setDefaultTimeout(3000);
  page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message.slice(0,200)}));
  assert.equal((await(await page.goto(base+'/api/health')).json()).version,report.evidence.appVersion);
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/api/search/related')return route.fulfill({json:{items:[{value:'CONTACT:'+id(90),labelZh:'示例联系人',labelEn:'Fictional Contact',type:'CONTACT'}]}});
   if(url.pathname!=='/api/communications')return route.fulfill({json:{items:[],total:0}});
   if(request.method()==='POST'){
    const payload=request.postDataJSON(),key=payload.requestKey||payload.idempotencyKey;posts.push(request.postData());assert.ok(key);
    let result=receipts.get(key);
    if(!result){
     if(payload.operation==='thread'){
      const row={...rows[0],id:id(++sequence),subject:payload.subject,purpose:payload.purpose,status:'OPEN'};rows.unshift(row);messages.set(row.id,[]);result={operation:'thread',threadId:row.id};
     }else if(payload.operation==='retry'){
      const row=rows.find(row=>messages.get(row.id).some(message=>message.id===payload.messageId)),message=messages.get(row.id).find(message=>message.id===payload.messageId);
      if(staleRetry){staleRetry=false;return route.fulfill({status:409,json:{code:'COMMUNICATION_VERSION_CONFLICT'}});}
      assert.equal(payload.expectedUpdatedAt,message.retryToken);message.deliveryStatus='QUEUED';message.retryAllowed=false;
      result={operation:'retry',threadId:row.id,messageId:message.id,deliveryStatus:'QUEUED',accepted:true};
     }else{
      const message={...communicationMessages(payload.threadId)[0],id:id(++sequence),body:payload.body,direction:payload.operation==='send'?'OUTBOUND':'INBOUND',deliveryStatus:payload.operation==='send'?'QUEUED':'RECEIVED'};
      messages.get(payload.threadId).push(message);result={operation:payload.operation,threadId:payload.threadId,messageId:message.id,deliveryStatus:message.deliveryStatus,accepted:true};
     }
     receipts.set(key,result);
    }
    if(failAfter){failAfter=false;listFailure=true;threadFailure=true;}
    if(loseResponse){loseResponse=false;return route.abort('failed');}return route.fulfill({status:result.deliveryStatus==='QUEUED'?202:200,json:result});
   }
   const params=url.searchParams;reads.push(Object.fromEntries(params));const threadId=params.get('threadId');
   if(threadId){
    if(threadFailure)return route.fulfill({status:503,json:{code:'COMMUNICATION_LOAD_FAILED'}});
    const row=rows.find(row=>row.id===threadId);if(!row)return route.fulfill({status:404,json:{code:'COMMUNICATION_THREAD_NOT_FOUND'}});
    const items=messages.get(threadId),size=Number(params.get('messagePageSize')||20),last=Math.max(1,Math.ceil(items.length/size)),number=Math.min(last,Number(params.get('messagePage')||last));
    const result=structuredClone({...row,messages:items.slice((number-1)*size,number*size),messageTotal:items.length,messagePage:number,messagePageSize:size});
    if(holdThread){holdThread=false;held={route,result};heldResolve();return;}return route.fulfill({json:result});
   }
   if(listFailure)return route.fulfill({status:503,json:{code:'COMMUNICATION_LOAD_FAILED'}});
   const q=(params.get('q')||'').trim().toLowerCase(),status=params.get('status')||'all',purpose=params.get('purpose')||'all',delivery=params.get('delivery')||'all',number=Number(params.get('page')||1),size=Number(params.get('pageSize')||20);
   const selected=rows.filter(row=>(!q||(row.subject+' '+row.contactEn).toLowerCase().includes(q))&&(status==='all'||row.status===status)&&(purpose==='all'||row.purpose===purpose)&&(delivery==='all'||messages.get(row.id).some(message=>message.direction==='OUTBOUND'&&(delivery==='failed'?message.deliveryStatus==='FAILED':delivery==='pending'?['QUEUED','PROCESSING'].includes(message.deliveryStatus):message.deliveryStatus==='UNCERTAIN'))));
   return route.fulfill({json:{items:selected.slice((number-1)*size,number*size),total:selected.length,page:number,pageSize:size}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/communications-recovery-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome156',alias:{'next/link':path.resolve('tests/fixtures/qa-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx'),'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional communication QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>Boolean(window.commsNavigate));
  const nav=href=>page.evaluate(href=>window.commsNavigate(href),href),locale=value=>page.evaluate(value=>window.commsLocale(value),value);
  const ready=()=>page.waitForFunction(()=>document.querySelector('.communication-composer textarea')?.disabled===false);
  const listReady=()=>page.waitForFunction(()=>document.querySelector('.communications-page')?.getAttribute('data-communication-current')==='true'&&document.querySelector('.communications-layout>aside')?.getAttribute('aria-busy')==='false'&&document.querySelector('.communications-pagination'));
  const refreshList=()=>page.getByRole('button',{name:en['commsRecovery.refreshInbox'],exact:true}).click();
  const refreshThread=()=>page.getByRole('button',{name:en['commsRecovery.refreshThread'],exact:true}).click();
  const shot=async(label,checks)=>{
   await page.evaluate(async()=>{await document.fonts.ready;document.activeElement?.blur();window.scrollTo(0,0);await new Promise(requestAnimationFrame);});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,label);
   assert.ok(await page.locator('.communications-filters select').evaluateAll(nodes=>nodes.every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;})),label);
   await page.screenshot({path:path.join(output,label+'.png'),fullPage:true});report.pages.push({label,viewport:page.viewportSize(),checks,boundary:'Actual inbox/hook/AppShell with production CSS and fictional APIs. Database commands verified independently; no provider delivery.'});process.stdout.write(`[QA communications] ${label} passed\n`);
  };
  for(const lang of ['zh-CN','en'])for(const width of [1440,375,320]){
   const text=lang==='en'?en:zh;await page.setViewportSize({width,height:1000});await locale(lang);await nav('/messages?context=fictional&thread='+id(1));await ready();
   await page.locator('.communications-filters select').nth(0).selectOption('OPEN');await listReady();assert.equal(new URL(page.url()).searchParams.get('status'),'OPEN');
   await page.locator('.communications-filters select').nth(1).selectOption('SERVICE');await listReady();
   await page.locator('.communications-filters select').nth(2).selectOption('failed');await listReady();
   await page.evaluate(()=>history.back());await page.waitForFunction(()=>new URLSearchParams(location.search).get('delivery')===null);await listReady();
   await page.locator('.communications-filters input').fill('Fictional conversation ');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='Fictional conversation ');assert.equal(await page.locator('.communications-filters input').inputValue(),'Fictional conversation ');
   await page.getByRole('button',{name:text['commsRecovery.reset'],exact:true}).click();await listReady();await ready();assert.equal(new URL(page.url()).searchParams.get('context'),'fictional');
   await shot(`communications-${lang}-${width}`,['URL/history status/purpose/delivery views','multiword search','context preservation','responsive filters and conversation']);
  }
  await locale('en');await page.setViewportSize({width:1440,height:1000});await nav('/messages?thread='+id(23));await ready();await refreshList();await listReady();assert.equal(await page.locator('.communication-thread h2').textContent(),'Fictional conversation 23');assert.equal(new URL(page.url()).searchParams.get('thread'),id(23));
  await nav('/messages?page=999&thread='+id(23));await page.waitForFunction(()=>new URLSearchParams(location.search).get('page')==='2');await listReady();assert.equal(await page.locator('.communications-threads>button').count(),3);
  await nav('/messages?thread='+id(1));await ready();const textarea=page.locator('.communication-composer textarea');await textarea.fill('Draft for conversation one');
  await page.locator('.communications-threads>button').nth(1).click();await ready();assert.equal(await textarea.inputValue(),'');await textarea.fill('Draft for conversation two');await page.locator('.communications-threads>button').nth(0).click();await ready();assert.equal(await textarea.inputValue(),'Draft for conversation one');
  await page.locator('a[href="/tasks"]').first().click();const leave=page.getByRole('alertdialog');await leave.getByRole('button',{name:en['common.cancel'],exact:true}).click();assert.equal(await textarea.inputValue(),'Draft for conversation one');
  threadFailure=true;await refreshThread();await page.getByText(en['commsRecovery.threadFailed'],{exact:true}).waitFor();assert.equal(await textarea.isDisabled(),true);threadFailure=false;await refreshThread();await ready();
  const waiting=new Promise(resolve=>{heldResolve=resolve;holdThread=true;});await refreshThread();await waiting;await page.locator('.communications-threads>button').nth(1).click();await ready();await held.route.fulfill({json:held.result}).catch(()=>{});held=null;assert.equal(await page.locator('.communication-thread h2').textContent(),'Fictional conversation 2');
  await nav('/messages?thread='+id(1));await ready();loseResponse=true;let before=posts.length;
  await page.locator('.communication-composer button[value="send"]').evaluate(node=>{node.click();node.click();});await page.getByText(en['commsRecovery.uncertain'],{exact:true}).waitFor();assert.equal(posts.length,before+1);assert.equal(await textarea.isDisabled(),true);assert.ok(await page.locator('.communications-threads>button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));
  await locale('zh-CN');await page.getByRole('button',{name:zh['commsRecovery.confirmOriginal'],exact:true}).click();await ready();assert.equal(posts.at(-1),posts.at(-2));assert.equal(await textarea.inputValue(),'');await locale('en');
  await shot('communication-recovery',['off-page deep links','real last-page correction','recipient-specific drafts','leave confirmation','failed detail read gating','late detail discard','immediate duplicate guard','exact retry across locale']);
  await textarea.fill('Fictional accepted inbound');failAfter=true;before=posts.length;await page.locator('.communication-composer button[value="inbound"]').click();await page.getByText(en['commsRecovery.refreshOnly'],{exact:true}).waitFor();assert.equal(await textarea.isDisabled(),true);assert.equal(posts.length,before+1);
  listFailure=false;threadFailure=false;await refreshList();await refreshThread();await ready();assert.equal(posts.length,before+1);assert.equal(await textarea.inputValue(),'');
  staleRetry=true;await page.locator('.communication-messages .text-button').first().click();await page.getByText(en['commsRecovery.reload'],{exact:true}).waitFor();await ready();
  loseResponse=true;before=posts.length;await page.locator('.communication-messages .text-button').first().click();await page.getByRole('button',{name:en['commsRecovery.confirmOriginal'],exact:true}).waitFor();await page.getByRole('button',{name:en['commsRecovery.confirmOriginal'],exact:true}).click();await ready();assert.equal(posts.length,before+2);assert.equal(posts.at(-1),posts.at(-2));
  await nav('/messages?thread='+id(3));await page.getByText(en['commsRecovery.closed'],{exact:true}).waitFor();assert.equal(await textarea.isDisabled(),true);assert.equal(await page.locator('.communication-messages .text-button').count(),0);
  await shot('communication-outcomes',['accepted write with failed reads','read-only refresh recovery','stale failure rejection','redelivery exact replay','closed conversation gates']);
  await nav('/messages?thread='+id(1));await ready();await page.getByRole('button',{name:en['communications.new'],exact:true}).click();const drawer=page.getByRole('dialog');await drawer.locator('.select-trigger').click();await drawer.getByRole('option',{name:/Fictional Contact/}).click();await drawer.locator('input[name="subject"]').fill('Fictional newly created conversation');loseResponse=true;before=posts.length;await drawer.locator('.primary-button').click();await drawer.getByText(en['commsRecovery.uncertain'],{exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await drawer.isVisible(),true);assert.equal(await drawer.locator('input[name="subject"]').isDisabled(),true);
  await drawer.getByRole('button',{name:en['commsRecovery.confirmOriginal'],exact:true}).click();await drawer.waitFor({state:'hidden'});await ready();assert.equal(posts.length,before+2);assert.equal(posts.at(-1),posts.at(-2));assert.equal(await page.locator('.communication-thread h2').textContent(),'Fictional newly created conversation');
  await shot('communication-create-recovery',['creation response loss','locked uncertain drawer','exact creation retry','accepted thread opened outside current page']);
  for(const role of ['OPERATIONS_MANAGER','CUSTOMER_SUCCESS_SPECIALIST']){
   await page.evaluate(role=>window.commsRole(role),role);await page.getByText(en['commsRecovery.readOnly'],{exact:true}).waitFor();assert.equal(await page.locator('.communication-composer').count(),0);assert.equal(await page.getByRole('button',{name:en['communications.new'],exact:true}).count(),0);assert.equal(await page.locator('.communication-messages .text-button').count(),0);
  }
  listFailure=true;threadFailure=true;await page.evaluate(()=>window.commsInitialFailure(true));await page.getByText(en['commsRecovery.listFailed'],{exact:true}).waitFor();assert.equal(await page.getByText(en['communications.empty'],{exact:true}).count(),0);listFailure=false;threadFailure=false;await refreshList();await refreshThread();await listReady();await page.waitForFunction(()=>document.querySelector('.communication-thread h2')!==null);
  await page.setViewportSize({width:320,height:1000});await shot('communication-read-only-recovery',['both view-only roles','initial failure is unavailable rather than empty','independent explicit recovery','no write requests']);
 }finally{await context.close();}
};
