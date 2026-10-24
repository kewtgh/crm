/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");

module.exports=async({browser,base,output,report})=>{
  const context=await browser.newContext({bypassCSP:true,locale:"zh-CN"});
  try{
    const page=await context.newPage();page.setDefaultTimeout(4000);
    // Deliberate HTTP failures exercise recovery; unexpected JS errors still fail the phase.
    page.on("pageerror",error=>report.errors.push({kind:"pageerror",url:"workflow-quality",message:error.message.slice(0,200)}));
    const health=await page.goto(`${base}/api/health`);assert.equal((await health.json()).version,report.evidence.appVersion);
    const id=number=>`00000000-0000-4000-8000-${String(number).padStart(12,"0")}`;
    const dueAt=new Date().toISOString();
    const items=Array.from({length:25},(_,index)=>({id:id(index+1),titleZh:`示例任务 ${index+1}`,titleEn:`Example Task ${index+1}`,related:"Fictional Academy",status:"TODO",priority:"NORMAL",ownerId:id(index===24?98:99),ownerName:index===24?"Advisor B":"Advisor A",dueAt,slaDueAt:null,revision:1}));
    let removed=new Set(),failRead=false,delayRead=false,heldRead=null,failWrite=false,taskWrites=0;
    const saved=[],directoryRequests=[];
    const workspace=()=>({canViewTeam:false,capacity:[],items:items.filter(item=>!removed.has(item.id))});
    await page.route("**/api/**",async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==="/api/tasks"&&request.method()==="GET"){
        if(failRead)return route.fulfill({status:503,json:{code:"TASK_WORKSPACE_LOAD_FAILED"}});
        const data=workspace();
        if(delayRead){delayRead=false;heldRead={route,data};return;}
        return route.fulfill({json:data});
      }
      if(url.pathname.startsWith("/api/tasks/")&&request.method()==="PATCH"){
        taskWrites++;
        if(failWrite)return route.fulfill({status:409,json:{code:"TASK_STATE_CHANGED"}});
        const taskId=url.pathname.split("/").at(-1);removed.add(taskId);return route.fulfill({json:{ids:[taskId],affected:1}});
      }
      if(url.pathname==="/api/tasks"&&request.method()==="POST"){
        const body=request.postDataJSON();assert.equal(body.operation,"bulkComplete");assert.ok(body.tasks.length<=12);assert.ok(body.reason.length>=3);assert.ok(body.requestKey);
        const ids=body.tasks.map(task=>task.id);ids.forEach(value=>removed.add(value));return route.fulfill({json:{ids,affected:ids.length}});
      }
      if(url.pathname==="/api/crm/schools"){
        directoryRequests.push(Object.fromEntries(url.searchParams));
        return route.fulfill({json:{items:[],total:0,metrics:{total:0,needsAttention:0,averageCompleteness:0}}});
      }
      if(url.pathname==="/api/views"){
        if(request.method()==="POST"){
          const body=request.postDataJSON();saved.push(body);
          return route.fulfill({json:{item:{id:id(60)}}});
        }
        return route.fulfill({json:{items:saved.map(body=>({...body.config,id:id(60),name:body.name,visibility:body.visibility,source:"SERVER",owned:true}))}});
      }
      return route.fulfill({json:{items:[],total:0}});
    });
    const bundle=await build({entryPoints:["tests/fixtures/workflow-quality-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome156",alias:{"next/link":path.resolve("tests/fixtures/qa-link.tsx"),"next/navigation":path.resolve("tests/fixtures/ux-foundation-navigation.ts")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html><head><title>Fictional workflow QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync("dist/client/_next/static",{recursive:true}).filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file.replaceAll("\\","/")}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForFunction(()=>Boolean(window.qualityNavigate));
    const waitRows=async count=>page.waitForFunction(count=>document.querySelectorAll(".task-work-row").length===count,count);
    for(const [locale,width] of [["zh-CN",1440],["en",375]]){
      const en=locale==="en";await page.setViewportSize({width,height:1000});
      await page.getByRole("button",{name:en?"QA English":"QA 中文",exact:true}).click();
      await page.evaluate(()=>window.qualityNavigate("/tasks?q=directory-context"));
      const firstPage=page.locator('.task-work-list .pagination button').filter({hasText:/^1$/});
      if(await firstPage.count())await firstPage.click();
      await waitRows(12);
      await page.locator('.task-work-list .pagination button').filter({hasText:/^2$/}).click();
      await page.getByRole("link",{name:en?/Example Task 13/:/示例任务 13/}).waitFor();
      await page.locator('.task-work-row input[type=checkbox]').first().check();
      await page.locator('.task-work-list .pagination button').filter({hasText:/^3$/}).click();await waitRows(1);
      assert.equal(await page.locator('.task-work-row input:checked').count(),0);
      await page.locator('.task-work-list .search-field input').fill(en?"Example Task 25":"示例任务 25");await waitRows(1);
      await page.locator('.task-work-list .search-field input').fill("");
      await page.getByRole("button",{name:en?"Due today (mine)":"今日到期（我的）",exact:true}).click();await waitRows(12);
      assert.equal(new URL(page.url()).searchParams.get("q"),"directory-context");assert.equal(new URL(page.url()).searchParams.get("queue"),"today");
      await page.evaluate(()=>history.back());await page.waitForFunction(()=>!new URLSearchParams(location.search).has("queue"));
      await page.keyboard.press("Tab");assert.equal(await page.evaluate(()=>document.activeElement!==document.body),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
      await page.screenshot({path:path.join(output,`workflow-quality-queue-${locale}-${width}.png`),fullPage:true});
      report.pages.push({path:"task-queue",locale,width,status:"PASS",checks:["pagination","search","selection scope","today deep link","unrelated URL context","history","keyboard","overflow"]});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('.task-work-list .pagination button').filter({hasText:/^1$/}).click();await waitRows(12);
    failRead=true;await page.getByRole("button",{name:"Refresh task queue",exact:true}).click();await page.locator('[role="alert"]').waitFor();
    failRead=false;await page.getByRole("button",{name:"Refresh task queue",exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));
    failWrite=true;await page.locator('.task-work-row .icon-button').first().click();await page.getByText(/no new completion was confirmed/).waitFor();
    assert.equal(await page.locator('.task-work-row').count(),12);failWrite=false;
    delayRead=true;await page.getByRole("button",{name:"Refresh task queue",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.task-work-list p[role="status"]'));
    assert.equal(await page.locator('.task-work-row .icon-button').first().isDisabled(),true);
    assert.ok(heldRead);await heldRead.route.fulfill({json:heldRead.data}).catch(()=>{});heldRead=null;
    await page.waitForFunction(()=>document.querySelector('.task-work-list')?.getAttribute('aria-busy')==='false');
    const before=taskWrites;await page.locator('.task-work-row .icon-button').first().click();
    await page.waitForFunction(()=>!document.querySelector('.task-work-row a[href$="000000000001"]'));
    assert.equal(taskWrites,before+1);
    await page.getByRole("button",{name:"Refresh task queue",exact:true}).waitFor({state:"visible"});
    assert.equal(await page.locator('.task-work-row a[href$="000000000001"]').count(),0);
    await page.locator('.task-work-row input[type=checkbox]').nth(0).check();await page.locator('.task-work-row input[type=checkbox]').nth(1).check();
    await page.getByRole("button",{name:/^Complete selected/}).click();
    let bulkDialog=page.getByRole("dialog");await bulkDialog.locator('textarea[name="reason"]').fill("Fictional completed work verified");
    await bulkDialog.locator('.primary-button').click();await bulkDialog.waitFor({state:"hidden"});
    assert.equal(removed.size,3);
    report.pages.push({path:"task-recovery",status:"PASS",checks:["failed read recovery","zero-row conflict keeps row","completion invalidates delayed read"]});

    for(const [locale,width] of [["zh-CN",1440],["en",375]]){
      const en=locale==="en";await page.setViewportSize({width,height:1000});await page.getByRole("button",{name:en?"QA English":"QA 中文",exact:true}).click();
      await page.evaluate(()=>window.qualityNavigate("/schools?city=Example%20City&commercialTier=A&queue=today"));
      await page.waitForFunction(()=>document.querySelector('.data-surface')?.getAttribute("aria-busy")==="false");
      await page.getByRole("button",{name:"QA Views",exact:true}).click();
      let dialog=page.getByRole("dialog");await dialog.locator('input[name="name"]').fill(`Fictional complete view ${locale}`);
      await dialog.locator('.primary-button[type=submit]').click();
      await dialog.getByRole("button",{name:new RegExp(`^Fictional complete view ${locale}`)}).waitFor();
      await page.keyboard.press("Escape");
      await page.evaluate(()=>window.qualityNavigate("/schools?city=Different&commercialTier=B&queue=today"));
      await page.getByRole("button",{name:"QA Views",exact:true}).click();dialog=page.getByRole("dialog");
      await dialog.getByRole("button",{name:new RegExp(`^Fictional complete view ${locale}`)}).click();
      await page.waitForFunction(()=>new URLSearchParams(location.search).get("city")==="Example City");
      assert.equal(new URL(page.url()).searchParams.get("commercialTier"),"A");assert.equal(new URL(page.url()).searchParams.get("queue"),"today");
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
      await page.screenshot({path:path.join(output,`workflow-quality-view-${locale}-${width}.png`),fullPage:true});
      report.pages.push({path:"saved-view",locale,width,status:"PASS",checks:["local v2 complete-filter save","restore overwrites previous filters","unrelated context preserved","responsive"]});
    }
    await page.getByRole("button",{name:"QA Views",exact:true}).click();
    const shared=page.getByRole("dialog");await shared.locator('input[name="name"]').fill("Fictional shared complete view");await shared.locator('select[name="visibility"]').selectOption("TEAM");await shared.locator('.primary-button[type=submit]').click();
    await shared.getByRole("button",{name:/^Fictional shared complete view/}).waitFor();assert.equal(saved.at(-1).config.version,2);assert.equal(saved.at(-1).config.filters.city,"Example City");
    await page.keyboard.press("Escape");
    await page.evaluate(()=>window.qualityNavigate("/tasks"));await page.evaluate(()=>window.qualityNavigate("/schools?city=Other"));
    await page.getByRole("button",{name:"QA Views",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:/^Fictional shared complete view/}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get("city")==="Example City");
    await page.evaluate(()=>{
      const key=Object.keys(localStorage).find(key=>key.startsWith("lumina-saved-views:"));
      const views=JSON.parse(localStorage.getItem(key)||"[]");
      views.push({version:1,id:"legacy",name:"Fictional legacy view",query:"Legacy query",status:"all",sort:"primary",direction:"asc",pageSize:10,source:"LOCAL",visibility:"PERSONAL",owned:true});
      localStorage.setItem(key,JSON.stringify(views));
      window.qualityNavigate("/tasks");
    });
    await page.locator('.task-workspace').waitFor();await page.evaluate(()=>window.qualityNavigate("/schools?city=Retained"));
    await page.getByRole("button",{name:"QA Views",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:/^Fictional legacy view/}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get("q")==="Legacy query");
    assert.equal(new URL(page.url()).searchParams.get("city"),"Retained");
    assert.ok(directoryRequests.some(request=>request.city==="Example City"&&request.commercialTier==="A"));
    report.pages.push({path:"shared-view-boundary",status:"PASS",checks:["v2 team API payload","server view reload and restore","legacy local view keeps independent filters","bulk completion page scope"],boundary:"Actual React components and production CSS with fictional mocked APIs; not real-database E2E."});
  }finally{await context.close();}
};
