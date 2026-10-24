/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report})=>{
 const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
 try{
  const page=await context.newPage();page.setDefaultTimeout(3500);
  page.on('pageerror',error=>report.errors.push({kind:'pageerror',message:error.message.slice(0,200)}));
  assert.equal((await(await page.goto(base+'/api/health')).json()).version,report.evidence.appVersion);
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  let taskReadFailure=false,notificationReadFailure=false,loseTask=false,failTaskRefresh=false,holdTask=false,heldTask=null,holdMark=false,heldMark=null,markLoss=false,holdNotification=false,heldNotification=null;
  let notificationHeldResolve;const notificationHeldReady=new Promise(resolve=>{notificationHeldResolve=resolve;});
  let taskHeldResolve=()=>{};
  const holdNextTaskRead=()=>new Promise(resolve=>{taskHeldResolve=resolve;holdTask=true;});
  const taskBodies=[],marks=[],receipts=new Map(),removed=new Set(),read=new Set();
  const tasks=Array.from({length:25},(_,n)=>({id:id(n+1),titleZh:`示例任务 ${n+1}`,titleEn:`Fictional Task ${n+1}`,related:'Fictional Academy',status:'TODO',priority:n%2?'HIGH':'NORMAL',ownerId:id(99),ownerName:'Advisor A',dueAt:new Date().toISOString(),slaDueAt:null,revision:1}));
  const notifications=[1,2].map(n=>({id:id(70+n),kind:'TASK',titleKey:'nav.notifications',bodyKey:'notifications.description',values:{},sourceType:'TASK',sourceId:id(n),createdAt:'2026-10-25T02:00:00Z'}));
  const workspace=()=>({items:tasks.filter(task=>!removed.has(task.id)),capacity:[],canViewTeam:false});
  const notificationPage=()=>({items:notifications.filter(item=>!read.has(item.id)),total:notifications.filter(item=>!read.has(item.id)).length});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/api/tasks'&&request.method()==='GET'){
    if(taskReadFailure)return route.fulfill({status:503,json:{code:'TASK_WORKSPACE_LOAD_FAILED'}});
    const data=workspace();if(holdTask){holdTask=false;heldTask={route,data};taskHeldResolve();return;}return route.fulfill({json:data});
   }
   if((url.pathname==='/api/tasks'&&request.method()==='POST')||(url.pathname.startsWith('/api/tasks/')&&request.method()==='PATCH')){
    taskBodies.push(request.postData());const command=request.postDataJSON();
    assert.ok(command.requestKey);assert.ok(command.tasks.every(task=>task.expectedRevision===1));
    const response={ids:command.tasks.map(task=>task.id),affected:command.tasks.length};
    if(!receipts.has(command.requestKey)){command.tasks.forEach(task=>removed.add(task.id));receipts.set(command.requestKey,response);}
    if(failTaskRefresh){taskReadFailure=true;failTaskRefresh=false;}if(loseTask){loseTask=false;return route.abort('failed');}
    return route.fulfill({json:receipts.get(command.requestKey)});
   }
   if(url.pathname==='/api/notifications'){
    if(request.method()==='PATCH'){
     const operation=request.postDataJSON();marks.push(operation);if(operation.all)notifications.forEach(item=>read.add(item.id));else operation.ids.forEach(value=>read.add(value));
     if(holdMark){holdMark=false;heldMark=route;return;}
     if(markLoss){markLoss=false;return route.abort('failed');}return route.fulfill({json:{ok:true}});
    }
    if(notificationReadFailure)return route.fulfill({status:503,json:{code:'NOTIFICATIONS_FAILED'}});
    const data=notificationPage();if(holdNotification){holdNotification=false;heldNotification={route,data};notificationHeldResolve();return;}return route.fulfill({json:data});
   }
   return route.fulfill({json:{items:[],total:0}});
  });
  const bundle=await build({entryPoints:['tests/fixtures/daily-work-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome156',alias:{'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx'),'next/link':path.resolve('tests/fixtures/qa-link.tsx'),'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional daily work QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:base+'/_next/static/'+file.replaceAll('\\','/')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>Boolean(window.dailyLocale));
  const nav=href=>page.evaluate(href=>window.dailyNavigate(href),href);
  const locale=value=>page.evaluate(value=>window.dailyLocale(value),value);
  const settled=()=>page.waitForFunction(()=>document.querySelector('.task-work-list')?.getAttribute('aria-busy')==='false');
  const shot=async(label,checks)=>{await page.evaluate(async()=>{await document.fonts.ready;document.activeElement?.blur();window.scrollTo(0,0);await new Promise(requestAnimationFrame);});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,label);await page.screenshot({path:path.join(output,label+'.png'),fullPage:true});report.pages.push({label,viewport:page.viewportSize(),checks,boundary:'Actual components and production CSS with fictional requests; database tested independently.'});process.stdout.write(`[QA daily] ${label} passed\n`);};
  if(process.env.QA_SCOPE==='task-completion'){
   for(const lang of ['zh-CN','en'])for(const width of [1440,375,320]){
    await page.setViewportSize({width,height:1000});await locale(lang);await nav('/tasks?q=directory&status=TODO&page=3');await settled();
    await page.locator('.task-work-list .pagination button').filter({hasText:/^2$/}).click();await page.waitForFunction(()=>new URLSearchParams(location.search).get('queuePage')==='2');
    await page.locator('.task-queue-controls select').selectOption('HIGH');await page.waitForFunction(()=>new URLSearchParams(location.search).get('queuePriority')==='HIGH');
    assert.equal(new URL(page.url()).searchParams.get('page'),'3');assert.equal(new URL(page.url()).searchParams.get('q'),'directory');
    await page.locator('.task-queue-controls input').fill(lang==='en'?'Fictional Task ':'示例任务 ');await page.waitForFunction(()=>new URLSearchParams(location.search).get('queueSearch')?.endsWith(' '));
    await page.evaluate(()=>history.back());await page.waitForFunction(()=>!new URLSearchParams(location.search).has('queuePriority'));
    await shot(`task-view-${lang}-${width}`,['shareable search/priority/page','multiword typing','history','directory context','responsive']);
   }
   await nav('/tasks?queuePage=999&q=directory');await page.waitForFunction(()=>new URLSearchParams(location.search).get('queuePage')==='3');assert.equal(new URL(page.url()).searchParams.get('q'),'directory');
   await nav('/tasks');await settled();await locale('en');await page.setViewportSize({width:1440,height:1000});
   taskReadFailure=true;await page.getByRole('button',{name:'Refresh task queue',exact:true}).click();await page.getByRole('alert').waitFor();assert.ok(await page.locator('.task-work-row button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));
   taskReadFailure=false;await page.getByRole('button',{name:'Refresh task queue',exact:true}).click();await settled();
   holdTask=true;await page.getByRole('button',{name:'Refresh task queue',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.task-work-list')?.getAttribute('aria-busy')==='true');assert.ok(await page.locator('.task-work-row button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));assert.ok(heldTask);await heldTask.route.fulfill({json:heldTask.data});heldTask=null;await settled();
   loseTask=true;const before=taskBodies.length;await page.locator('.task-work-row button').first().evaluate(button=>{button.click();button.click();});await page.getByText(/completion result is unconfirmed/).waitFor();assert.equal(taskBodies.length,before+1);assert.ok(await page.locator('.task-work-row button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));
   await locale('zh-CN');const confirmationRead=holdNextTaskRead();await page.getByRole('button',{name:'重试并确认保存结果',exact:true}).click();await confirmationRead;await page.evaluate(()=>new Promise(requestAnimationFrame));await heldTask.route.fulfill({json:heldTask.data}).catch(()=>{});heldTask=null;await settled();assert.equal(await page.getByText(/完成操作已确认，但工作负载刷新失败/).count(),0);assert.equal(taskBodies.at(-1),taskBodies.at(-2));await page.locator(`.task-work-row a[href="/tasks/${id(1)}"]`).waitFor({state:'hidden'});
   await page.locator('.task-work-row input').nth(0).check();await page.locator('.task-work-row input').nth(1).check();await page.getByRole('button',{name:/^批量完成/}).click();
   const dialog=page.getByRole('dialog');await dialog.locator('textarea').fill('Fictional verified batch');loseTask=true;await dialog.locator('.primary-button').click();await dialog.getByText(/完成结果尚未确认/).waitFor();assert.equal(await dialog.locator('textarea').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);
   await locale('en');await dialog.getByRole('button',{name:'Retry and confirm save',exact:true}).click();await dialog.waitFor({state:'hidden'});await settled();assert.equal(taskBodies.at(-1),taskBodies.at(-2));
   failTaskRefresh=true;const writes=taskBodies.length;await page.locator('.task-work-row button').first().click();await page.getByText(/Completion was confirmed, but/).waitFor();assert.equal(taskBodies.length,writes+1);taskReadFailure=false;await page.getByRole('button',{name:'Refresh task queue',exact:true}).click();await settled();assert.equal(taskBodies.length,writes+1);
   await shot('task-recovery',['out-of-range page URL corrected','read failure/loading action gating','synchronous duplicate guard','single and bulk exact retry across locales','uncertain drawer locked','accepted write refresh-only']);
   await nav('/dashboard');await page.locator('.focus-task').first().waitFor();loseTask=true;const dashboardWrites=taskBodies.length;await page.locator('.focus-task button').first().evaluate(button=>{button.click();button.click();});await page.getByText(/completion result is unconfirmed/).waitFor();assert.equal(taskBodies.length,dashboardWrites+1);assert.ok(await page.locator('.focus-task button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));await page.getByRole('button',{name:'Retry and confirm save',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.focus-task').length===1);assert.equal(taskBodies.at(-1),taskBodies.at(-2));
   await shot('dashboard-recovery',['homepage uses the shared version/receipt contract','immediate duplicate prevention','uncertain outcome disables competing tasks','retry restores the accepted result']);
  }else{
   await nav('/notifications');await page.locator('.notification-center article').first().waitFor();
   for(const role of ['OPERATIONS_MANAGER','CUSTOMER_SUCCESS_SPECIALIST']){
    await page.evaluate(role=>window.dailyRole(role),role);await page.waitForFunction(()=>document.querySelectorAll('.notification-center article button').length===0);
    await page.getByRole('button',{name:/通知|Notifications/,exact:true}).first().click();await page.locator('.top-popover.notifications').waitFor();assert.equal(await page.locator('.popover-heading button').count(),0);await page.keyboard.press('Escape');
   }
   await page.evaluate(()=>window.dailyRole('SALES_SPECIALIST'));await page.locator('.notification-center article button').first().waitFor();await locale('en');
   // A second hook instance receives the event while its mark is still pending.
   holdNotification=true;await page.getByRole('button',{name:'Notifications',exact:true}).first().click();await page.locator('.top-popover.notifications [role="status"]').waitFor();await notificationHeldReady;assert.ok(heldNotification);
   holdMark=true;await page.locator('.notification-center article button').first().evaluate(button=>button.click());await page.waitForFunction(()=>document.querySelector('.notification-center')?.getAttribute('aria-busy')==='true');assert.ok(heldMark);
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('crm:notifications-changed')));await heldMark.fulfill({json:{ok:true}});heldMark=null;
   await page.waitForFunction(()=>document.querySelectorAll('.notification-center article').length===1&&document.querySelector('.notification-center')?.getAttribute('aria-busy')==='false');assert.equal(marks.length,1);assert.equal(await page.locator(`.notification-center a[href="/tasks/${id(1)}"]`).count(),0);
   await heldNotification.route.fulfill({json:heldNotification.data}).catch(()=>{});heldNotification=null;
   await page.waitForFunction(()=>document.querySelector('.top-popover.notifications')?.getAttribute('aria-busy')==='false');assert.equal(await page.locator(`.top-popover.notifications a[href="/tasks/${id(1)}"]`).count(),0);
   await page.keyboard.press('Escape');notificationReadFailure=true;await page.locator('.notification-center article button').first().click();await page.getByText(/Marking as read was confirmed, but/).waitFor();assert.equal(marks.length,2);notificationReadFailure=false;await page.getByRole('button',{name:'Refresh notifications',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.notification-center article').length===0);assert.equal(marks.length,2);
   read.clear();await page.getByRole('button',{name:'Refresh notifications',exact:true}).click();await page.locator('.notification-center article').first().waitFor();markLoss=true;await page.locator('.notification-center article button').first().click();await page.getByText(/read status is unconfirmed/).waitFor();assert.ok(await page.locator('.notification-center article button').evaluateAll(nodes=>nodes.every(node=>node.disabled)));await page.getByRole('button',{name:'Refresh notifications',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.notification-center article').length===1);assert.equal(marks.length,3);
   for(const lang of ['zh-CN','en'])for(const width of [1440,375,320]){await locale(lang);await page.setViewportSize({width,height:1000});await shot(`notifications-${lang}-${width}`,['view-only roles hide writes in page and popover','late pre-write read discarded','cross-instance refresh serialization','accepted mark refresh-only','uncertain write display recovery','responsive']);}
  }
 }finally{await context.close();}
};
