/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:"zh-CN",bypassCSP:true}),saved=[],requests=[],templateRequests=[],queueAttempts=new Set(),templateAttempts=new Set(),portalSaved=[],portalRequests=[];
  try{
    const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
    const health=await page.goto(`${base}/api/health`);assert.ok(health?.ok());assert.equal((await health.json()).version,report.evidence.appVersion);
    await page.route("**/api/settings/avatar**",route=>route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGkwAAAAASUVORK5CYII=","base64")}));
    await page.route("**/api/imports?**",route=>route.fulfill({json:{items:[],total:0}}));
    await page.route("**/api/search/related**",route=>route.fulfill({json:{items:[]}}));
    const portalContacts=[1,2].map(i=>({household_id:`00000000-0000-4000-8000-${String(500+i).padStart(12,"0")}`,contact_id:`00000000-0000-4000-8000-${String(600+i).padStart(12,"0")}`,household_zh:`家庭 ${i}`,household_en:`Family ${i}`,name_zh:`家长 ${i}`,name_en:`Parent ${i}`,email:`parent${i}@example.test`,city:i===1?"台北":"上海",tags:i===1?["重点"]:[],contact_type:"PARENT"}));
    await page.route("**/api/portal/recipients?**",route=>{
      const params=new URL(route.request().url()).searchParams;
      const items=portalContacts.filter(item=>(!params.get("region")||item.city===params.get("region"))&&(!params.get("tag")||item.tags.includes(params.get("tag")))&&(!params.get("type")||item.contact_type===params.get("type")));
      return route.fulfill({json:{items,total:items.length,regions:["台北","上海"],tags:["重点"],types:["PARENT"]}});
    });
    await page.route("**/api/portal/templates",route=>{
      const data=route.request().postDataJSON();if(!data)return route.fulfill({json:{items:portalSaved.filter(item=>!item.archived)}});
      if(data.operation==="archive"){const item=portalSaved.find(item=>item.id===data.id);item.archived=true;item.revision++;return route.fulfill({json:{archived:true}});}
      const item={id:data.id,name:data.name,visibility:data.visibility,revision:data.expectedRevision===null?1:data.expectedRevision+1,...data.content};
      const index=portalSaved.findIndex(row=>row.id===item.id);if(index>=0)portalSaved[index]=item;else portalSaved.push(item);
      return route.fulfill({json:{item}});
    });
    await page.route("**/api/portal/invitations",route=>{
      const data=route.request().postDataJSON();portalRequests.push(data);const person=portalContacts.find(item=>item.household_id===data.householdId);
      return route.fulfill({json:{invitationUrl:`${base}/portal/invite/${"q".repeat(43)}`,invitations:[{id:"invitation-qa",householdId:person.household_id,householdZh:person.household_zh,householdEn:person.household_en,email:person.email,status:"ACTIVE",expiresAt:data.expiresAt,lastAccessedAt:null,createdAt:new Date().toISOString()}],updates:[]}});
    });
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
    for(const file of fs.readdirSync("dist/client/_next/static",{recursive:true}).filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file.replaceAll("\\","/")}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    // Exercise latest-result guards even when the transport cannot cancel an old read.
    await page.evaluate(()=>{const original=window.fetch;window.fetch=(input,init)=>typeof input==="string"&&input.startsWith("/api/communications?")?original(input,{...init,signal:undefined}):original(input,init);});
    const overflow=async()=>{
      const detail=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right}))}));
      assert.ok(detail.scroll<=detail.width+1,`no document overflow: ${JSON.stringify(detail)}`);
    };
    const qualityControls=async()=>{
      const controls=await page.locator(".quality-rule-grid article").evaluateAll(cards=>cards.map(card=>{
        const select=card.querySelector("select"),checkbox=card.querySelector('input[type="checkbox"]'),rect=select.getBoundingClientRect(),checkRect=checkbox.getBoundingClientRect(),style=getComputedStyle(select);
        return{width:rect.width,height:rect.height,sameRow:Math.abs(rect.y+rect.height/2-checkRect.y-checkRect.height/2)<2,color:style.color,background:style.backgroundColor};
      }));
      assert.ok(controls.every(control=>control.width>=76&&control.width<=112&&control.height>=44&&control.sameRow),JSON.stringify(controls));
      assert.equal(new Set(controls.map(control=>control.color)).size,3);
      assert.equal(new Set(controls.map(control=>control.background)).size,3);
    };
    if(process.env.QA_UX_VIEW==="email-compose"){
      for(const locale of ["zh-CN","en"]){
        if(locale==="en") { await page.getByRole("button",{name:"QA locale",exact:true}).click();await page.waitForFunction(()=>document.documentElement.lang==="en"); }
        for(const viewport of [{width:1440,height:1000},{width:375,height:812}]){
          await page.setViewportSize(viewport);await page.getByRole("button",{name:"QA quality",exact:true}).click();await page.getByRole("button",{name:"QA email",exact:true}).click();
          const mail=page.locator(".customer-email-panel");await mail.locator(".email-recipient-list input").first().waitFor();
          const sections=await mail.locator(".email-compose-section").evaluateAll(elements=>elements.map(element=>({x:element.getBoundingClientRect().x,y:element.getBoundingClientRect().y,color:getComputedStyle(element).backgroundColor})));
          assert.equal(sections.length,3);assert.equal(new Set(sections.map(section=>section.color)).size,3);
          if(viewport.width>960)assert.ok(sections[1].x>sections[0].x&&Math.abs(sections[1].y-sections[0].y)<2);else assert.ok(sections[1].y>sections[0].y);
          await mail.locator(".email-compose-template select").first().selectOption("PROGRAM");
          await mail.locator(".email-compose-template select").nth(1).selectOption("en");
          await mail.locator(".email-template-sample summary").click();await mail.locator(".email-template-sample").getByText("Program information",{exact:true}).waitFor();
          await mail.locator(".email-recipient-filters select").first().selectOption("台北");
          await page.waitForFunction(()=>document.querySelectorAll(".email-recipient-list input").length===1);
          await mail.locator(".email-recipient-picker .email-filter-actions button").first().click();assert.equal(await mail.locator(".email-selected-recipients .tag-values > span").count(),1);
          await overflow();await page.screenshot({path:path.join(output,`email-compose-${locale}-${viewport.width}.png`),fullPage:true});
          await mail.getByRole("button",{name:/新建自定义模板|Create custom template/}).click();const editor=page.getByRole("dialog");
          assert.equal(await editor.locator(".email-template-language").count(),2);assert.equal(new Set(await editor.locator(".email-template-language").evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor))).size,2);
          await editor.getByLabel(/模板名称|Template name/).fill(`Layout ${locale} ${viewport.width}`);
          await overflow();await page.screenshot({path:path.join(output,`email-editor-${locale}-${viewport.width}.png`),fullPage:true});
          await editor.getByRole("button",{name:/^取消$|^Cancel$/}).click();await editor.waitFor({state:"hidden"});
          await mail.getByRole("button",{name:/生成个性化预览|Generate personalized previews/}).click();await mail.locator(".email-personalized-previews details").first().waitFor();
          assert.equal(requests.at(-1).locale,"en");assert.equal(requests.at(-1).template,"PROGRAM");
          await mail.getByRole("button",{name:/确认并入队|Confirm & queue/}).click();await mail.getByRole("button",{name:/重试本批次|Retry this batch/}).waitFor();
          assert.ok(await mail.locator(".email-compose-template select").first().isDisabled());assert.ok(await mail.locator(".email-recipient-filters select").first().isDisabled());
          const frozen=requests.at(-1);await mail.getByRole("button",{name:/重试本批次|Retry this batch/}).click();await mail.locator(".email-batch-results").waitFor();assert.deepEqual(requests.at(-1),frozen);
          await mail.getByRole("button",{name:/开始新批次|Start a new batch/}).click();assert.equal(await mail.locator(".email-selected-recipients .tag-values > span").count(),0);await overflow();
          report.pages.push({label:`email-compose-${locale}-${viewport.width}`,route:"isolated-ux-fixture",viewport,checks:["three-distinct-colored-sections","responsive-layout","template-content-and-language","recipient-filter-and-selection","bilingual-editor-cards","personalized-preview","draft-lock","same-batch-retry","new-batch-reset","no-overflow"],boundary:"Actual components and production CSS; APIs mocked. No emails sent."});
        }
      }
      return;
    }
    if(process.env.QA_UX_VIEW==="worker-badges"){
      await page.getByRole("button",{name:"QA workers",exact:true}).click();
      for(const locale of ["zh-CN","en"]){
        if(locale==="en") { await page.getByRole("button",{name:"QA locale",exact:true}).click();await page.waitForFunction(()=>document.documentElement.lang==="en"); }
        for(const viewport of [{width:1440,height:1000},{width:375,height:812},{width:320,height:812}]){
          await page.setViewportSize(viewport);
          if(viewport.width<600)await page.locator(".operations-mobile-tabs button").nth(1).click();
          await page.locator(".worker-list article").first().waitFor();
          const badges=await page.locator(".worker-list article > .status-badge,.operations-queue-grid article > .status-badge").evaluateAll(elements=>elements.map(badge=>{
            const rect=badge.getBoundingClientRect(),card=badge.parentElement.getBoundingClientRect(),text=badge.parentElement.querySelector("div").getBoundingClientRect(),style=getComputedStyle(badge);
            const range=document.createRange();range.selectNodeContents(badge);const content=range.getBoundingClientRect();
            return {worker:badge.parentElement.parentElement.classList.contains("worker-list"),right:rect.left>=text.right-1&&rect.right<=card.right+1,aligned:Math.abs(rect.y+rect.height/2-text.y-text.height/2)<2,contained:content.left>=rect.left+4&&content.right<=rect.right-4&&content.top>=rect.top&&content.bottom<=rect.bottom,width:rect.width,height:rect.height,radius:parseFloat(style.borderRadius),color:style.backgroundColor};
          }));
          assert.equal(badges.length,4);assert.ok(badges.every(badge=>badge.contained&&badge.height>=28&&badge.radius>=badge.height/2),JSON.stringify(badges));
          assert.ok(badges.filter(badge=>badge.worker).every(badge=>badge.right&&badge.aligned),JSON.stringify(badges));
          assert.equal(new Set(badges.map(badge=>badge.color)).size,2);await overflow();
          await page.screenshot({path:path.join(output,`worker-badges-${locale}-${viewport.width}.png`),fullPage:true});
          report.pages.push({label:`worker-badges-${locale}-${viewport.width}`,route:"isolated-ux-fixture",viewport,checks:["worker-status-right-aligned","worker-status-vertically-centered","queue-and-worker-pill-text-contained","rounded-background","no-overflow"],boundary:"Actual components and production CSS; queue/worker metrics are fixtures."});
        }
      }
      return;
    }
    if(process.env.QA_UX_VIEW==="quality-history"){
      const records=Array.from({length:23},(_,i)=>({id:`bulk-${i}`,threadId:`thread-${i}`,contactZh:`客户 ${i}`,contactEn:`Customer ${i}`,email:`customer${i}@example.test`,subject:i===0?"课程资料":"服务跟进",purpose:i===0?"MARKETING":"SERVICE",deliveryStatus:i===0?"SENT":"FAILED",createdAt:"2026-10-03T01:00:00Z",deliveredAt:i===0?"2026-10-03T01:01:00Z":null}));
      await page.route("**/api/customer-email/history?**",route=>{
        const params=new URL(route.request().url()).searchParams,q=params.get("q"),purpose=params.get("purpose"),status=params.get("status"),pageSize=Number(params.get("pageSize")),pageNumber=Number(params.get("page"));
        const matching=records.filter(item=>(!q||`${item.subject} ${item.contactZh} ${item.email}`.includes(q))&&(!purpose||item.purpose===purpose)&&(!status||item.deliveryStatus===status));
        return route.fulfill({json:{items:matching.slice((pageNumber-1)*pageSize,pageNumber*pageSize),total:matching.length,page:pageNumber,pageSize}});
      });
      for(const viewport of [{width:1440,height:1000},{width:375,height:812}]){
        await page.setViewportSize(viewport);await page.getByRole("button",{name:"QA quality",exact:true}).click();
        await page.locator(".quality-rule-grid select").first().waitFor();await qualityControls();await overflow();
        await page.screenshot({path:path.join(output,`quality-${viewport.width}.png`),fullPage:true});
        await page.getByRole("button",{name:"QA history",exact:true}).click();
        const history=page.locator(".email-history-page");
        await history.getByText("共 23 条群发记录",{exact:true}).waitFor();assert.equal(await history.locator(".email-history-record").count(),20);
        await history.getByRole("button",{name:"2",exact:true}).click();await history.locator(".email-history-record").filter({hasText:"客户 22"}).waitFor();assert.equal(await history.locator(".email-history-record").count(),3);
        await history.getByLabel("发送用途",{exact:true}).selectOption("MARKETING");await history.getByText("共 1 条群发记录",{exact:true}).waitFor();
        await history.getByLabel("投递状态",{exact:true}).selectOption("FAILED");await history.getByText("没有符合条件的群发记录，请调整关键词或清除筛选。",{exact:true}).waitFor();
        await history.getByRole("button",{name:"清除筛选",exact:true}).click();await history.getByText("共 23 条群发记录",{exact:true}).waitFor();
        await history.locator(".search-field input").fill("customer0@example.test");await history.getByText("共 1 条群发记录",{exact:true}).waitFor();
        assert.equal(await history.getByRole("link",{name:"查看会话"}).getAttribute("href"),"/messages?thread=thread-0");
        await history.getByLabel("投递状态",{exact:true}).selectOption("SENT");await history.locator(".status-badge").filter({hasText:"已发送"}).waitFor();await overflow();
        await page.screenshot({path:path.join(output,`bulk-email-${viewport.width}.png`),fullPage:true});
        report.pages.push({label:`quality-and-bulk-email-${viewport.width}`,route:"isolated-ux-fixture",viewport,checks:["compact-severity","severity-colors","enabled-and-severity-same-row","bulk-history-pagination","purpose-and-delivery-filters","filter-reset-to-first-page","keyword-search","conversation-link","no-overflow"],boundary:"Actual components and production CSS; history API mocked. No emails sent."});
      }
      return;
    }
    for(const viewport of [{width:1440,height:1000},{width:375,height:812}]){
      await page.setViewportSize(viewport);await page.getByRole("button",{name:"QA quality",exact:true}).click();
      await page.locator(".quality-rule-grid select").first().waitFor();
      await qualityControls();await overflow();
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
      const filters=mail.locator(".email-recipient-filters");assert.equal(await filters.locator("select").count(),3);assert.equal(await filters.locator("input").count(),0);
      const filterBoxes=await filters.locator("select").evaluateAll(elements=>elements.map(e=>({y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width})));
      assert.ok(filterBoxes.every(box=>box.width>=80),"structured filters remain readable");
      if(viewport.width>600)assert.ok(filterBoxes.every(box=>Math.abs(box.y-filterBoxes[0].y)<1),"desktop filters share one row");else assert.ok(filterBoxes[1].y>filterBoxes[0].y,"mobile filters stack with their labels");
      await filters.getByRole("combobox",{name:/^地区/}).selectOption("台北");await mail.getByText("匹配 1 位客户",{exact:true}).waitFor();
      await filters.getByRole("combobox",{name:/^地区/}).selectOption("台北");await mail.getByText("收件客户 1",{exact:true}).waitFor();
      await filters.getByRole("combobox",{name:/^客户标签/}).selectOption("重点");
      await filters.getByRole("combobox",{name:/^客户类型/}).selectOption("PARENT");await mail.getByText("匹配 1 位客户",{exact:true}).waitFor();
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
      await mail.getByRole("button",{name:"生成个性化预览",exact:true}).click();await mail.locator(".email-personalized-previews details").first().waitFor();assert.equal(requests.at(-1).template,"CUSTOM");assert.ok(requests.at(-1).customTemplate.bodyZh.includes("{{name}}"));
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
      await page.getByRole("button",{name:"QA portal",exact:true}).click();const portal=page.locator(".portal-workspace");
      await portal.getByRole("button",{name:"创建邀请",exact:true}).click();let invite=page.getByRole("dialog");
      await invite.getByLabel("家庭与已登记收件人",{exact:false}).locator("option").filter({hasText:"家庭 1"}).waitFor({state:"attached"});
      const portalFilters=invite.locator(".portal-recipient-picker .email-recipient-filters");assert.equal(await portalFilters.locator("input").count(),0);
      assert.ok(await portalFilters.locator("select").evaluateAll(elements=>elements.every(e=>Math.abs(e.getBoundingClientRect().y-elements[0].getBoundingClientRect().y)<1)));
      await portalFilters.getByRole("combobox",{name:/^地区/}).selectOption("台北");await invite.getByText("匹配 1 位客户",{exact:true}).waitFor();await portalFilters.getByRole("combobox",{name:/^客户标签/}).selectOption("重点");await portalFilters.getByRole("combobox",{name:/^客户类型/}).selectOption("PARENT");
      await invite.getByRole("button",{name:"定制并保存邀请模板",exact:true}).click();const portalEditor=page.getByRole("dialog");
      await portalEditor.getByLabel("模板名称",{exact:false}).fill(`门户公共 ${viewport.width}`);await portalEditor.getByLabel("模板范围",{exact:false}).selectOption("WORKSPACE");await portalEditor.getByLabel("默认有效期",{exact:false}).selectOption("3");await portalEditor.getByRole("button",{name:"保存",exact:true}).click();
      invite=page.getByRole("dialog");await invite.getByLabel("邀请模板",{exact:false}).locator("option").filter({hasText:`门户公共 ${viewport.width}`}).waitFor({state:"attached"});
      await invite.getByLabel("家庭与已登记收件人",{exact:false}).selectOption(`${portalContacts[0].household_id}:${portalContacts[0].contact_id}`);
      await invite.getByLabel("邮件主题",{exact:false}).fill("自定义邀请 {{family}}");
      await page.screenshot({path:path.join(output,`portal-dialog-${viewport.width}.png`),fullPage:true});await invite.getByRole("button",{name:"创建安全链接",exact:true}).click();await portal.locator(".portal-invitation-result").waitFor();
      assert.equal(portalRequests.at(-1).email,"parent1@example.test");assert.equal(portalRequests.at(-1).householdId,portalContacts[0].household_id);assert.equal(portalRequests.at(-1).body,undefined);
      const message=await portal.locator(".portal-invitation-result").textContent();assert.ok(message.includes("自定义邀请 家庭 1"));assert.ok(message.includes("家长 1"));assert.ok(message.includes("/portal/invite/"));assert.ok(!message.includes("{{portal_url}}"));
      await portal.getByRole("combobox",{name:/^状态/}).selectOption("REVOKED");assert.equal(await portal.locator(".v220-list article").count(),0);await portal.getByRole("combobox",{name:/^状态/}).selectOption("");assert.equal(await portal.locator(".v220-list article").count(),1);
      await overflow();await page.screenshot({path:path.join(output,`portal-result-${viewport.width}.png`),fullPage:true});
      await page.getByRole("button",{name:"QA sales",exact:true}).click();await portal.getByRole("button",{name:"邀请模板与筛选",exact:true}).click();invite=page.getByRole("dialog");
      const sharedPortal=portalSaved.find(item=>item.name===`门户公共 ${viewport.width}`);await invite.getByLabel("邀请模板",{exact:false}).selectOption(`saved:${sharedPortal.id}`);assert.equal(await invite.getByRole("button",{name:"归档模板",exact:true}).count(),0);
      await invite.getByRole("button",{name:"复制为个人模板",exact:true}).click();await page.getByRole("dialog").getByLabel("模板名称",{exact:false}).fill(`门户个人 ${viewport.width}`);await page.getByRole("dialog").getByRole("button",{name:"保存为个人模板",exact:true}).click();
      invite=page.getByRole("dialog");await invite.getByLabel("邀请模板",{exact:false}).locator("option").filter({hasText:`门户个人 ${viewport.width}`}).waitFor({state:"attached"});assert.equal(await invite.getByRole("button",{name:"创建安全链接",exact:true}).isDisabled(),true);
      await invite.getByRole("button",{name:"取消",exact:true}).click();await page.getByRole("button",{name:"QA admin",exact:true}).click();
      report.pages.push({label:`ux-refinements-${viewport.width}`,route:"isolated-ux-fixture",viewport,checks:["severity-control-width","worker-readable-status","page-double-calendar-distinction","four-import-downloads","recipient-and-filters","structured-filters-one-row","select-page","six-bilingual-presets","idempotent-template-retry","admin-public-template","personal-copy","confirmed-soft-archive","unknown-queue-draft-lock","same-payload-retry","out-of-order-thread-guard","sending-draft-and-navigation-lock","portal-structured-filters","portal-public-template-save","portal-personal-copy","portal-create-role-boundary","portal-personalized-message","portal-record-filters","no-overflow"],boundary:"Actual components and production CSS; API mocked, including accepted writes with lost responses and uncancellable old reads. Persistence and RLS tested separately; no real invitations or emails sent."});
    }
    assert.equal(saved.length,6);
    await page.waitForFunction(()=>document.querySelector(".user-avatar img")?.complete);assert.equal(await page.locator(".user-avatar img").count(),1);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent("lumina:avatar-updated",{detail:{url:"/api/settings/avatar?v=updated"}})));await page.waitForFunction(()=>document.querySelector(".user-avatar img")?.getAttribute("src").includes("updated"));
  }catch(error){report.errors.push({kind:"ux-refinements",message:error.message});throw error;}finally{await context.close();}
};
