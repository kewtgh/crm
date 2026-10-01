/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:"zh-CN",bypassCSP:true});
  try {
    const page=await context.newPage(); observe(page); page.setDefaultTimeout(4000);
    const health=await page.goto(`${base}/api/health`); assert.ok(health?.ok()); assert.equal((await health.json()).version,report.evidence.appVersion);
    const snapshot={id:"00000000-0000-4000-8000-000000000001",nameZh:"测试学校与机构",nameEn:"Test institution",shortName:"测试机构",ownerName:"负责销售",profile:{city:"台北",email:"school@example.test",notes_markdown:"机构需求说明"},level:2,plan:null,entries:[],entryTotal:0,completed:0,contacts:[{id:"person",name_zh:"机构对接人",owner_name:"负责销售",communication_level:2}],contracts:[],opportunities:[],students:[],products:[],limited:false};
    await page.route("**/api/customer-operations**",route=>{const subject=new URL(route.request().url()).searchParams.get("subject");return route.fulfill({json:{...snapshot,subject,nameZh:subject==="HOUSEHOLD"?"测试家庭":subject==="CONTACT"?"测试客户":snapshot.nameZh,contacts:subject==="CONTACT"?[]:snapshot.contacts,students:subject==="HOUSEHOLD"?[{id:"child",name_zh:"家庭孩子"}]:[]}});});
    const bundle=await build({entryPoints:["tests/fixtures/ui-system-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome145",alias:{"next/navigation":path.resolve("tests/fixtures/qa-navigation.ts"),"next/link":path.resolve("tests/fixtures/qa-link.tsx")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html lang="zh-CN"><head><title>UI system QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync("dist/client/_next/static").filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:375,height:812}]){
      await page.setViewportSize(viewport); await page.getByRole("button",{name:"ORGANIZATION",exact:true}).click();
      const panel=page.locator(".customer-operations-panel");
      await panel.getByRole("tab",{name:"机构联系人",exact:true}).click(); await panel.getByRole("link",{name:"机构对接人",exact:true}).waitFor();
      assert.equal(await panel.getByText("孩子与学生",{exact:true}).count(),0); assert.equal(await panel.getByText("家庭成员与孩子",{exact:true}).count(),0);
      await panel.getByRole("tab",{name:"机构联系人",exact:true}).press("Home"); assert.equal(await panel.getByRole("tab",{name:"信息概况",exact:true}).getAttribute("aria-selected"),"true");
      await panel.getByRole("tab",{name:"信息概况",exact:true}).press("ArrowRight"); assert.equal(await panel.getByRole("tab",{name:"跟进与目标",exact:true}).getAttribute("aria-selected"),"true");
      await page.getByRole("button",{name:"HOUSEHOLD",exact:true}).click(); await panel.getByRole("tab",{name:"家庭成员与孩子",exact:true}).click(); await panel.getByRole("link",{name:"家庭孩子",exact:true}).waitFor();
      await page.getByRole("button",{name:"CONTACT",exact:true}).click(); await panel.getByRole("tab",{name:"档案与通信授权",exact:true}).waitFor(); assert.equal(await panel.getByRole("tab",{name:"机构联系人",exact:true}).count(),0);
      const actions=page.locator(".product-row-actions"); assert.equal(await actions.getByRole("button",{name:"删除",exact:true}).count(),0);
      await actions.locator("summary").click(); await actions.getByRole("button",{name:"删除",exact:true}).waitFor(); await actions.locator("summary").press("Escape"); assert.equal(await actions.getByRole("button",{name:"删除",exact:true}).count(),0);
      await actions.locator("summary").click(); await page.getByRole("heading",{name:"产品与服务",exact:true}).click(); assert.equal(await actions.getByRole("button",{name:"删除",exact:true}).count(),0);
      const boxes=await actions.locator(":scope > button, :scope > details > summary").evaluateAll(elements=>elements.map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom}))); assert.ok(Math.max(...boxes.map(b=>b.top))<Math.min(...boxes.map(b=>b.bottom)),`all row actions on the same line: ${JSON.stringify(boxes)}`);
      await actions.getByRole("button",{name:"详情",exact:true}).click(); const dialog=page.getByRole("dialog"); await dialog.getByRole("tab",{name:"价格与计费",exact:true}).click();
      assert.ok((await dialog.textContent()).includes("12,345.67")); assert.ok((await dialog.textContent()).includes("1,800.25"));
      await dialog.getByRole("tab",{name:"购买客户",exact:true}).click(); await dialog.getByText("LUM-001",{exact:false}).waitFor();
      await page.screenshot({path:path.join(output,`product-detail-${viewport.width}.png`),fullPage:true});
      const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getClientRects().length).slice(0,12).map(e=>({tag:e.tagName,class:e.className,right:e.getBoundingClientRect().right}))}));
      assert.ok(overflow.scroll<=viewport.width+1,`no document overflow: ${JSON.stringify(overflow)}`);
      await page.keyboard.press("Escape"); await dialog.waitFor({state:"hidden"});
      await page.screenshot({path:path.join(output,`ui-system-${viewport.width}.png`),fullPage:true});
      assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--brand").trim()),"#176b79");
      await actions.locator("summary").click(); await actions.getByRole("button",{name:"删除",exact:true}).click(); await page.getByRole("alertdialog").waitFor(); await page.getByRole("button",{name:"取消",exact:true}).click();
      assert.equal(await page.locator(".product-list-row").count(),1,"cancel deletion preserves product");
      report.pages.push({label:`ui-system-${viewport.width}`,route:"isolated-ui-system-fixture",viewport,checks:["subject-boundaries","keyboard-tabs","hidden-delete","same-line-actions","cancel-delete","currency-prices","detail-modal","calm-theme","no-overflow"],boundary:"Actual components and production CSS, mocked customer API. No production data changes."});
    }
  } catch(error) { report.errors.push({kind:"ui-system",message:error.message}); throw error; } finally { await context.close(); }
};
