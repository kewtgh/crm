/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:"zh-CN",bypassCSP:true}),saved=[],requests=[],templateRequests=[],queueAttempts=new Set(),templateAttempts=new Set();
  try{
    const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
    const health=await page.goto(`${base}/api/health`);assert.ok(health?.ok());assert.equal((await health.json()).version,report.evidence.appVersion);
    await page.route("**/api/settings/avatar**",route=>route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGkwAAAAASUVORK5CYII=","base64")}));
    await page.route("**/api/imports?**",route=>route.fulfill({json:{items:[],total:0}}));
    await page.route("**/api/search/related**",route=>route.fulfill({json:{items:[]}}));
    await page.route("**/api/customer-email/templates",route=>{
      const data=route.request().postDataJSON();if(!data)return route.fulfill({json:{items:saved.filter(item=>!item.archived)}});
      templateRequests.push(data);
      if(data.operation==="archive"){const item=saved.find(item=>item.id===data.id);assert.equal(data.expectedRevision,item.revision);item.archived=true;item.revision++;return route.fulfill({json:{archived:true}});}
      const prior=saved.find(item=>item.id===data.id);
      const item={id:data.id,name:data.name,visibility:data.visibility,revision:data.expectedRevision===null?1:data.expectedRevision+1,...data.content};
      if(prior&&data.expectedRevision===null){assert.deepEqual(item,prior);return route.fulfill({json:{item:prior}});}
      const index=saved.findIndex(row=>row.id===item.id);if(index>=0)saved[index]=item;else saved.push(item);
      if(data.expectedRevision===null&&!templateAttempts.has(data.id)){templateAttempts.add(data.id);return route.fulfill({contentType:"application/json",body:"{"});}
      return route.fulfill({json:{item}});
    });
    await page.route("**/api/customer-email/recipients?**",route=>{
      const params=new URL(route.request().url()).searchParams,region=params.get("region"),tag=params.get("tag"),type=params.get("type");
      const items=[1,2,3].map(i=>({id:`00000000-0000-4000-8000-${String(100+i).padStart(12,"0")}`,name_zh:`收件客户 ${i}`,name_en:`Customer ${i}`,email:`customer${i}@example.test`,city:i===1?"台北":"上海",contact_type:i===1?"PARENT":"CONTACT",tags:i===1?["重点"]:[],blocked:i===3})).filter(row=>(!region||row.city===region)&&(!tag||row.tags.includes(tag))&&(!type||row.contact_type===type));
      return route.fulfill({json:{items,total:items.length,regions:["台北","上海"],tags:["重点"],types:["PARENT","CONTACT"]}});
    });
    await page.route("**/api/customer-email",route=>{const data=route.request().postDataJSON();requests.push(data);if(data.operation==="queue"&&!queueAttempts.has(data.requestKey)){queueAttempts.add(data.requestKey);return route.fulfill({contentType:"application/json",body:"{"});}return route.fulfill({json:data.operation==="preview"?{items:data.contactIds.map(id=>({id,name:"收件客户",email:"customer@example.test",subject:data.customTemplate?.subjectZh??"主题",body:data.customTemplate?.bodyZh??"正文",purpose:"SERVICE",blocked:false})),hash:"a".repeat(64)}:{queued:data.contactIds.length,failed:0,results:data.contactIds.map(id=>({id,queued:true,threadId:"thread"}))}});});
    let slowThread,sendRequest;
    const inboxItems=["a","b","c"].map(id=>({id:`thread-${id}`,contactId:id,contactZh:`客户 ${id}`,contactEn:`Customer ${id}`,email:`${id}@example.test`,subject:`会话 ${id}`,channel:"EMAIL",purpose:"SERVICE",status:"OPEN",lastMessageAt:null}));
    const threadResponse=id=>({...inboxItems.find(item=>item.id===id),messages:[],messageTotal:0,messagePage:1,messagePageSize:20});
    await page.route("**/api/communications**",route=>{
      if(route.request().method()==="POST"){sendRequest=route;return;}
      const id=new URL(route.request().url()).searchParams.get("threadId");
      if(id==="thread-b"){slowThread=route;return;}
      return route.fulfill({json:id?threadResponse(id):{items:inboxItems,total:3,page:1,pageSize:20}});
    });
    const bundle=await build({entryPoints:["tests/fixtures/ux-refinements-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome145",alias:{"next/navigation":path.resolve("tests/fixtures/qa-navigation.ts"),"next/link":path.resolve("tests/fixtures/qa-link.tsx")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html lang="zh-CN"><head><title>Scoped UX QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync("dist/client/_next/static").filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    // Exercise latest-result guards even when the transport cannot cancel an old read.
    await page.evaluate(()=>{const original=window.fetch;window.fetch=(input,init)=>typeof input==="string"&&input.startsWith("/api/communications?")?original(input,{...init,signal:undefined}):original(input,init);});
    const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"no document overflow");
    for(const viewport of [{width:1440,height:1000},{width:375,height:812}]){
      await page.setViewportSize(viewport);await page.getByRole("button",{name:"QA quality",exact:true}).click();
      await page.locator(".quality-rule-grid select").first().waitFor();
      assert.ok((await page.locator(".quality-rule-grid select").evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().width))).every(width=>width>=140));await overflow();
      await page.screenshot({path:path.join(output,`quality-${viewport.width}.png`),fullPage:true});
      await page.getByRole("button",{name:"QA workers",exact:true}).click();if(viewport.width===375)await page.locator(".operations-mobile-tabs").getByRole("button",{name:"队列",exact:true}).click();await page.locator(".worker-list article").first().waitFor();
      assert.ok((await page.locator(".worker-list").textContent()).includes("运行异常"));
      assert.ok(await page.locator(".worker-list article > .status-badge").evaluateAll(elements=>elements.every(e=>e.clientWidth>=e.scrollWidth)));await overflow();
      await page.screenshot({path:path.join(output,`workers-${viewport.width}.png`),fullPage:true});
      await page.getByRole("button",{name:"QA calendar",exact:true}).click();assert.equal(await page.locator(".double-calendar .month-view").count(),2);
      const months=await page.locator(".month-view h3").evaluateAll(elements=>elements.map(e=>({title:e.textContent,bg:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderBottomColor})));
      assert.notEqual(months[0].title,months[1].title);assert.notEqual(months[0].bg,months[1].bg);assert.notEqual(months[0].border,months[1].border);await overflow();
      await page.screenshot({path:path.join(output,`calendar-${viewport.width}.png`),fullPage:true});
      await page.getByRole("button",{name:"QA imports",exact:true}).click();
      for(const resource of ["CONTACTS","ORGANIZATIONS","HOUSEHOLDS","STUDENTS"]){await page.locator("select").first().selectOption(resource);assert.equal(await page.locator(".import-template-actions a").count(),3);for(const kind of ["blank","example","guide"])assert.ok(await page.locator(`.import-template-actions a[href*="kind=${kind}"]`).getAttribute("href").then(href=>href.includes(`resource=${resource}`)));}await overflow();
      await page.getByRole("button",{name:"QA email",exact:true}).click();await page.getByText("收件客户 1",{exact:true}).waitFor();
      const mail=page.locator(".customer-email-panel");assert.equal(await mail.locator("select optgroup").first().locator("option").count(),6);
      assert.ok(await mail.locator("label.field > span:first-child").evaluateAll(labels=>labels.filter(label=>label.querySelector(".required-indicator")).every(label=>["none","normal","\"\""].includes(getComputedStyle(label,"::after").content))),"one visible required marker, not two");
      await mail.getByRole("button",{name:"地区",exact:true}).click();await mail.getByRole("option",{name:"台北",exact:true}).click();await mail.getByText("匹配 1 位客户",{exact:true}).waitFor();
      await mail.getByRole("button",{name:"地区",exact:true}).click();await mail.getByRole("option",{name:"台北",exact:true}).click();await mail.getByText("收件客户 1",{exact:true}).waitFor();
      await mail.getByRole("button",{name:"客户标签",exact:true}).click();await mail.getByRole("option",{name:"重点",exact:true}).click();
      await mail.getByRole("button",{name:"客户类型",exact:true}).click();await mail.getByRole("option",{name:"家长",exact:true}).click();await mail.getByText("匹配 1 位客户",{exact:true}).waitFor();
      await mail.getByRole("button",{name:"选择本页可发客户",exact:true}).click();assert.equal(await mail.locator(".email-recipient-list input:checked").count(),1);
      await mail.getByRole("button",{name:"新建自定义模板",exact:true}).click();const dialog=page.getByRole("dialog");
      await dialog.getByLabel("模板名称",{exact:false}).fill(`QA公共模板 ${viewport.width}`);await dialog.getByLabel("模板范围",{exact:false}).selectOption("WORKSPACE");
      await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.getByText("模板未保存，请重试。",{exact:true}).waitFor();await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.waitFor({state:"hidden"});
      assert.equal(templateRequests.at(-1).id,templateRequests.at(-2).id);assert.equal(templateRequests.at(-1).visibility,"WORKSPACE");
      await mail.getByRole("button",{name:"编辑邮件模板",exact:true}).click();const copyDialog=page.getByRole("dialog");await copyDialog.getByLabel("模板名称",{exact:false}).fill(`QA模板副本 ${viewport.width}`);await copyDialog.getByRole("button",{name:"另存为新模板",exact:true}).click();await copyDialog.getByText("模板未保存，请重试。",{exact:true}).waitFor();await copyDialog.getByRole("button",{name:"另存为新模板",exact:true}).click();await copyDialog.waitFor({state:"hidden"});
      assert.equal(templateRequests.at(-1).visibility,"PERSONAL");
      await mail.getByRole("button",{name:"归档模板",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:"归档模板",exact:true}).click();await page.getByRole("alertdialog").waitFor({state:"hidden"});
      assert.equal(await mail.locator(`option`).filter({hasText:`QA模板副本 ${viewport.width}`}).count(),0);
      const publicTemplate=saved.find(item=>item.name===`QA公共模板 ${viewport.width}`);await mail.locator("select").first().selectOption(`saved:${publicTemplate.id}`);
      await page.getByRole("button",{name:"QA sales",exact:true}).click();assert.equal(await mail.getByRole("button",{name:"归档模板",exact:true}).count(),0);
      await mail.getByRole("button",{name:"复制为个人模板",exact:true}).click();const personalDialog=page.getByRole("dialog");
      assert.equal(await personalDialog.getByLabel("模板范围",{exact:false}).isDisabled(),true);
      await personalDialog.getByLabel("模板名称",{exact:false}).fill(`个人复制 ${viewport.width}`);await personalDialog.getByRole("button",{name:"保存为个人模板",exact:true}).click();await personalDialog.getByText("模板未保存，请重试。",{exact:true}).waitFor();await personalDialog.getByRole("button",{name:"保存为个人模板",exact:true}).click();await personalDialog.waitFor({state:"hidden"});
      assert.equal(templateRequests.at(-1).visibility,"PERSONAL");assert.equal(templateRequests.at(-1).expectedRevision,null);assert.notEqual(templateRequests.at(-1).id,publicTemplate.id);
      await page.getByRole("button",{name:"QA admin",exact:true}).click();await mail.locator("select").first().selectOption(`saved:${publicTemplate.id}`);
      await mail.getByRole("button",{name:"生成个性化预览",exact:true}).click();await mail.locator("details").first().waitFor();assert.equal(requests.at(-1).template,"CUSTOM");assert.ok(requests.at(-1).customTemplate.bodyZh.includes("{{name}}"));
      await mail.getByRole("button",{name:/确认并入队/}).click();await mail.getByText(/尚未确认本批次的入队结果/).waitFor();
      assert.equal(await mail.locator("select").first().isDisabled(),true);assert.equal(await mail.getByRole("button",{name:"开始新批次",exact:true}).count(),0);
      const originalPayload=requests.at(-1);await mail.getByRole("button",{name:/重试本批次/}).click();await mail.getByRole("button",{name:"开始新批次",exact:true}).waitFor();assert.deepEqual(requests.at(-1),originalPayload);
      await overflow();await page.screenshot({path:path.join(output,`email-${viewport.width}.png`),fullPage:true});
      await page.getByRole("button",{name:"QA inbox",exact:true}).click();
      const slowRead=page.waitForRequest(request=>request.url().includes("threadId=thread-b"));await page.locator(".communications-layout aside > button").nth(1).click();await slowRead;
      await page.locator(".communications-layout aside > button").nth(2).click();await page.locator(".communication-thread h2").getByText("会话 c",{exact:true}).waitFor();
      const oldRead=page.waitForResponse(response=>response.url().includes("threadId=thread-b"));await slowThread.fulfill({json:threadResponse("thread-b")});await oldRead;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.locator(".communication-thread h2").textContent(),"会话 c");
      await page.locator(".communication-composer textarea").fill("保留当前客户的消息");const send=page.waitForRequest(request=>request.method()==="POST"&&request.url().endsWith("/api/communications"));await page.getByRole("button",{name:"发送邮件",exact:true}).click();await send;
      assert.equal(await page.locator(".communication-composer textarea").isDisabled(),true);assert.equal(await page.locator(".communications-layout aside > button").first().isDisabled(),true);
      assert.equal(sendRequest.request().postDataJSON().threadId,"thread-c");await sendRequest.fulfill({json:{operation:"send",threadId:"thread-c",accepted:true}});await page.waitForFunction(()=>document.querySelector(".communication-composer textarea")?.value==="");await overflow();
      await page.screenshot({path:path.join(output,`inbox-${viewport.width}.png`),fullPage:true});
      report.pages.push({label:`ux-refinements-${viewport.width}`,route:"isolated-ux-fixture",viewport,checks:["severity-control-width","worker-readable-status","page-double-calendar-distinction","four-import-downloads","recipient-and-filters","select-page","six-bilingual-presets","idempotent-template-retry","admin-public-template","personal-copy","confirmed-soft-archive","unknown-queue-draft-lock","same-payload-retry","out-of-order-thread-guard","sending-draft-and-navigation-lock","no-overflow"],boundary:"Actual components and production CSS; API mocked, including accepted writes with lost responses and uncancellable old reads. Persistence and RLS tested separately."});
    }
    assert.equal(saved.length,6);
    await page.waitForFunction(()=>document.querySelector(".user-avatar img")?.complete);assert.equal(await page.locator(".user-avatar img").count(),1);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent("lumina:avatar-updated",{detail:{url:"/api/settings/avatar?v=updated"}})));await page.waitForFunction(()=>document.querySelector(".user-avatar img")?.getAttribute("src").includes("updated"));
  }catch(error){report.errors.push({kind:"ux-refinements",message:error.message});throw error;}finally{await context.close();}
};
