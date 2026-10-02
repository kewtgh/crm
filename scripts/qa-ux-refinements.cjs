/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:"zh-CN",bypassCSP:true}),saved=[],requests=[];
  try{
    const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
    const health=await page.goto(`${base}/api/health`);assert.ok(health?.ok());assert.equal((await health.json()).version,report.evidence.appVersion);
    await page.route("**/api/settings/avatar**",route=>route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGkwAAAAASUVORK5CYII=","base64")}));
    await page.route("**/api/imports?**",route=>route.fulfill({json:{items:[],total:0}}));
    await page.route("**/api/search/related**",route=>route.fulfill({json:{items:[]}}));
    await page.route("**/api/customer-email/templates",route=>{
      const data=route.request().postDataJSON();if(!data)return route.fulfill({json:{items:saved}});
      const item={id:data.id??`00000000-0000-4000-8000-${String(saved.length+1).padStart(12,"0")}`,name:data.name,...data.content};
      const index=saved.findIndex(row=>row.id===item.id);if(index>=0)saved[index]=item;else saved.push(item);
      return route.fulfill({json:{item}});
    });
    await page.route("**/api/customer-email/recipients?**",route=>{
      const params=new URL(route.request().url()).searchParams,region=params.get("region"),tag=params.get("tag"),type=params.get("type");
      const items=[1,2,3].map(i=>({id:`00000000-0000-4000-8000-${String(100+i).padStart(12,"0")}`,name_zh:`收件客户 ${i}`,name_en:`Customer ${i}`,email:`customer${i}@example.test`,city:i===1?"台北":"上海",contact_type:i===1?"PARENT":"CONTACT",tags:i===1?["重点"]:[],blocked:i===3})).filter(row=>(!region||row.city===region)&&(!tag||row.tags.includes(tag))&&(!type||row.contact_type===type));
      return route.fulfill({json:{items,total:items.length,regions:["台北","上海"],tags:["重点"],types:["PARENT","CONTACT"]}});
    });
    await page.route("**/api/customer-email",route=>{const data=route.request().postDataJSON();requests.push(data);return route.fulfill({json:data.operation==="preview"?{items:data.contactIds.map(id=>({id,name:"收件客户",email:"customer@example.test",subject:data.customTemplate?.subjectZh??"主题",body:data.customTemplate?.bodyZh??"正文",purpose:"SERVICE",blocked:false})),hash:"a".repeat(64)}:{queued:data.contactIds.length,failed:0,results:data.contactIds.map(id=>({id,queued:true,threadId:"thread"}))}});});
    const bundle=await build({entryPoints:["tests/fixtures/ux-refinements-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome145",alias:{"next/navigation":path.resolve("tests/fixtures/qa-navigation.ts"),"next/link":path.resolve("tests/fixtures/qa-link.tsx")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html lang="zh-CN"><head><title>Scoped UX QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync("dist/client/_next/static").filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
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
      await mail.getByRole("button",{name:"地区",exact:true}).click();await mail.getByRole("option",{name:"台北",exact:true}).click();await mail.getByText("匹配 1 位客户",{exact:true}).waitFor();
      await mail.getByRole("button",{name:"地区",exact:true}).click();await mail.getByRole("option",{name:"台北",exact:true}).click();await mail.getByText("收件客户 1",{exact:true}).waitFor();
      await mail.getByRole("button",{name:"客户标签",exact:true}).click();await mail.getByRole("option",{name:"重点",exact:true}).click();
      await mail.getByRole("button",{name:"客户类型",exact:true}).click();await mail.getByRole("option",{name:"家长",exact:true}).click();await mail.getByText("匹配 1 位客户",{exact:true}).waitFor();
      await mail.getByRole("button",{name:"选择本页可发客户",exact:true}).click();assert.equal(await mail.locator(".email-recipient-list input:checked").count(),1);
      await mail.getByRole("button",{name:"新建自定义模板",exact:true}).click();const dialog=page.getByRole("dialog");
      await dialog.getByLabel("模板名称",{exact:false}).fill(`QA模板 ${viewport.width}`);await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.waitFor({state:"hidden"});
      await mail.getByRole("button",{name:"编辑邮件模板",exact:true}).click();await page.getByRole("dialog").getByLabel("模板名称",{exact:false}).fill(`QA模板副本 ${viewport.width}`);await page.getByRole("dialog").getByRole("button",{name:"另存为新模板",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
      await mail.getByRole("button",{name:"生成个性化预览",exact:true}).click();await mail.locator("details").first().waitFor();assert.equal(requests.at(-1).template,"CUSTOM");assert.ok(requests.at(-1).customTemplate.bodyZh.includes("{{name}}"));
      await overflow();await page.screenshot({path:path.join(output,`email-${viewport.width}.png`),fullPage:true});
      report.pages.push({label:`ux-refinements-${viewport.width}`,route:"isolated-ux-fixture",viewport,checks:["severity-control-width","worker-readable-status","failed-worker-label","page-double-calendar-distinction","four-import-downloads","recipient-and-filters","select-page","six-bilingual-presets","save-multiple-custom-templates","custom-preview","no-overflow"],boundary:"Actual components and production CSS; API mocked. Persistence, RLS, filter results and image processing tested separately."});
    }
    assert.equal(saved.length,4);
    await page.waitForFunction(()=>document.querySelector(".user-avatar img")?.complete);assert.equal(await page.locator(".user-avatar img").count(),1);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent("lumina:avatar-updated",{detail:{url:"/api/settings/avatar?v=updated"}})));await page.waitForFunction(()=>document.querySelector(".user-avatar img")?.getAttribute("src").includes("updated"));
  }catch(error){report.errors.push({kind:"ux-refinements",message:error.message});throw error;}finally{await context.close();}
};
