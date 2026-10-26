/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report})=>{
 const context=await browser.newContext({bypassCSP:true,locale:"zh-CN"});
 try{
  require("tsx/cjs");const {calendarFixture}=require("../tests/fixtures/calendar-exports-qa-data.cjs");
  const page=await context.newPage();page.setDefaultTimeout(3500);page.on("pageerror",error=>report.errors.push({kind:"pageerror",message:error.message.slice(0,200)}));
  assert.equal((await (await page.goto(base+"/api/health")).json()).version,report.evidence.appVersion);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),target=today.slice(0,8)+"10";
  let items=calendarFixture(target),failRead=false,holdRead=false,held=null,loseCreate=false,loseAction=false,exportFailure=false,shrink=false;
  const creates=[],actions=[],relatedRequests=[],exportRequests=[],created=new Map(),completed=new Map();
  const ready={id:"aaaaaaaa-0000-4000-8000-000000000001",type:"CRM_EXPORT",format:"CSV",status:"READY",createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),errorMessage:null};
  await page.route("**/api/**",async route=>{
   const request=route.request(),url=new URL(request.url()),method=request.method();
   if(url.pathname==="/api/calendar"&&method==="GET"){
    if(failRead)return route.fulfill({status:503,json:{code:"CALENDAR_LOAD_FAILED"}});
    const data={items:[...items],total:items.length,truncated:false};if(holdRead){holdRead=false;held={route,data};return;}
    return route.fulfill({json:data});
   }
   if(url.pathname==="/api/calendar/relations"){relatedRequests.push(url.pathname);return route.fulfill({json:{items:[{value:"CONTACT:00000000-0000-4000-8000-000000000098",labelZh:"示例联系人",labelEn:"Fictional Contact",type:"CONTACT"},{value:"STUDENT:00000000-0000-4000-8000-000000000097",labelZh:"不支持对象",labelEn:"Unsupported Student",type:"STUDENT"}]}});}
   if(url.pathname==="/api/calendar"&&method==="POST"){
    creates.push(request.postData());const data=request.postDataJSON();
    if(!created.has(data.requestKey)){const id="00000000-0000-4000-8000-000000000050";created.set(data.requestKey,id);items.push({id,eventVersion:1,date:data.date,time:data.time,title:data.title,titleEn:data.title,related:data.related,type:data.type,channel:data.channel,reminder:"calendar.reminder.30m",deliveryStatus:"NONE"});}
    if(loseCreate){loseCreate=false;return route.abort("failed");}return route.fulfill({json:{item:{id:created.get(data.requestKey),event_version:1}}});
   }
   if(url.pathname.startsWith("/api/calendar/")&&method==="PATCH"){
    actions.push(request.postData());const data=request.postDataJSON(),id=url.pathname.split("/").at(-1);
    if(!completed.has(data.requestKey)){completed.set(data.requestKey,2);items=items.filter(item=>item.id!==id);}
    if(loseAction){loseAction=false;return route.abort("failed");}return route.fulfill({json:{ok:true,eventVersion:completed.get(data.requestKey)}});
   }
   if(url.pathname==="/api/exports"){
    exportRequests.push(url.searchParams.get("page"));if(exportFailure)return route.fulfill({status:503,json:{code:"EXPORTS_LOAD_FAILED"}});
    const currentPage=Number(url.searchParams.get("page")),query=url.searchParams.get("q");
    if(query==="slow")await new Promise(resolve=>setTimeout(resolve,400));
    const rows=url.searchParams.get("status")==="FAILED"?[]:[{...ready,id:query==="fast"?"ffffffff-0000-4000-8000-000000000001":ready.id}];
    return route.fulfill({json:{items:shrink&&currentPage===2?[]:rows,total:rows.length,page:currentPage,pageSize:10}});
   }
   return route.fulfill({json:{items:[],total:0}});
  });
  const bundle=await build({entryPoints:["tests/fixtures/calendar-exports-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome156",alias:{"next/link":path.resolve("tests/fixtures/qa-link.tsx")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  await page.setContent('<html lang="zh-CN"><head><title>Fictional calendar and export QA</title></head><body><div id="root"></div></body></html>');
  for(const file of fs.readdirSync("dist/client/_next/static",{recursive:true}).filter(file=>file.endsWith(".css")))await page.addStyleTag({url:base+"/_next/static/"+file.replaceAll("\\","/")});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>Boolean(window.workflowView));
  const view=async name=>{await page.evaluate(name=>window.workflowView(name),name);await page.waitForFunction(name=>document.querySelector("main")?.getAttribute("data-qa-view")===name,name);};
  const shot=async(label,checks)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,label);assert.equal(await page.locator('.reminder-actions button,.calendar-legend>span').evaluateAll(nodes=>nodes.every(node=>{const parent=node.closest('.reminder-item,.calendar-legend').getBoundingClientRect(),rect=node.getBoundingClientRect();return rect.left>=parent.left-1&&rect.right<=parent.right+1&&rect.top>=parent.top-1&&rect.bottom<=parent.bottom+1;})),true,label+': controls and legend stay inside their containers');await page.screenshot({path:path.join(output,label+".png"),fullPage:true});report.pages.push({label,viewport:page.viewportSize(),checks,boundary:"Real components and production CSS with fictional API responses. Database invariants tested separately."});process.stdout.write(`[QA calendar-exports] ${label} passed\n`);};
  const selectDay=async()=>{await page.locator(`.calendar-day[aria-label^="${target}"]`).click();await page.waitForFunction(()=>document.querySelectorAll(".reminder-item").length===10);};
  for(const locale of ["zh-CN","en"])for(const width of [1440,375]){
   await page.setViewportSize({width,height:1000});await page.evaluate(locale=>window.workflowLocale(locale),locale);await view("calendar");await selectDay();assert.equal(await page.getByRole("dialog").count(),0);
   await page.locator('.reminder-panel .pagination button').filter({hasText:/^2$/}).click();await page.waitForFunction(()=>document.querySelectorAll(".reminder-item").length===3);
   await shot(`calendar-agenda-${locale}-${width}`,["date inspection without mutation","all 13 appointments reachable","bilingual","overflow"]);
   await view("exports");await page.locator(".export-job-list article").first().waitFor();assert.equal(await page.locator('a[href^="/api/exports/"]').count(),1);assert.equal(await page.locator(".export-job-list article").nth(1).locator("a").count(),0);
   await shot(`exports-${locale}-${width}`,["ready eligibility","expired download disabled","responsive"]);
  }
  await view("calendar");await selectDay();failRead=true;await page.getByRole("button",{name:"Refresh calendar",exact:true}).click();await page.locator(".calendar-page > .inline-message.error").waitFor();assert.equal(await page.getByRole("dialog").count(),0);assert.equal(await page.locator(".reminder-item").count(),10);
  failRead=false;await page.getByRole("button",{name:"Refresh calendar",exact:true}).click();await page.waitForFunction(()=>!document.querySelector(".calendar-page > .inline-message.error"));
  holdRead=true;await page.getByRole("button",{name:"Refresh calendar",exact:true}).click();await page.getByRole("button",{name:"Schedule event",exact:true}).click();
  const dialog=page.getByRole("dialog");await dialog.locator('input[name="title"]').fill("Fictional recovered appointment");await dialog.locator('select[name="reminder"]').selectOption("30");
  await dialog.locator(".select-trigger").click();await dialog.getByRole("option",{name:/Fictional Contact/}).click();assert.ok(relatedRequests.every(value=>value==="/api/calendar/relations"));assert.equal(await dialog.getByText("Unsupported Student",{exact:true}).count(),0);
  loseCreate=true;await dialog.locator('button[type="submit"]').evaluate(button=>{button.click();button.click();});await dialog.locator("fieldset:disabled").waitFor();await dialog.getByText(/result is unconfirmed/).waitFor();assert.equal(creates.length,1);await page.keyboard.press("Escape");assert.equal(await page.getByRole("dialog").count(),1);
  await page.evaluate(()=>window.workflowLocale("zh-CN"));await dialog.locator('button[type="submit"]').click();await dialog.waitFor({state:"hidden"});assert.equal(creates[0],creates[1]);assert.equal(JSON.parse(creates[1]).reminder,30);
  if(held){await held.route.fulfill({json:held.data}).catch(()=>{});held=null;}await page.locator(".reminder-item").filter({hasText:"Fictional recovered appointment"}).waitFor();
  assert.equal(await page.locator(".reminder-item").filter({hasText:"Fictional recovered appointment"}).count(),1);await shot("calendar-create-recovery",["accepted response loss","unchanged bytes across locale","uncertain input and escape lock","delayed read cannot remove accepted save","supported relation"]);
  loseAction=true;const row=page.locator(".reminder-item").filter({hasText:"Fictional recovered appointment"});await row.locator(".reminder-actions button").nth(2).click();await page.getByText(/操作结果尚未确认/).waitFor();await page.getByRole("button",{name:"重试并确认保存结果",exact:true}).click();await row.waitFor({state:"hidden"});assert.equal(actions[0],actions[1]);assert.equal(JSON.parse(actions[0]).expectedVersion,1);await shot("calendar-action-recovery",["exact action retry","version carried","completed event removed from agenda and grid"]);
  await page.evaluate(()=>window.workflowLocale("en"));await view("exports-page2");shrink=true;await page.getByRole("button",{name:"Refresh exports",exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pagination button[aria-current="page"]')?.textContent==="1");assert.deepEqual(exportRequests.slice(-2),["2","1"]);
  exportFailure=true;await page.getByRole("button",{name:"Refresh exports",exact:true}).click();await page.locator(".export-list .inline-message.error").waitFor();assert.equal(await page.locator('a[href^="/api/exports/"]').count(),0);exportFailure=false;await page.getByRole("button",{name:"Refresh exports",exact:true}).click();await page.locator('a[href^="/api/exports/"]').waitFor();
  const search=page.locator(".export-list .search-field input");await search.fill("slow");await page.waitForRequest(request=>new URL(request.url()).searchParams.get("q")==="slow");await search.fill("fast");await page.locator('a[href*="ffffffff"]').waitFor();await page.waitForTimeout(450);assert.equal(await page.locator('a[href*="aaaaaaaa"]').count(),0);
  await page.locator(".compact-select select").selectOption("FAILED");await page.getByText("No export jobs match this search or status. Adjust the filters.",{exact:true}).waitFor();await shot("export-recovery",["shrunken page reloads actual first page","failed read disables stale downloads","retry recovery","latest search wins","filtered empty distinct"]);
 }finally{await context.close();}
};
