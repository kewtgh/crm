/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:"zh-CN",bypassCSP:true});
  const family="00000000-0000-4000-8000-000000000002",product="00000000-0000-4000-8000-000000000004",writes=[];
  try{
    const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
    await page.goto(`${base}/api/health`);
    await page.route("**/api/search/related**",route=>route.fulfill({json:{items:[{value:`HOUSEHOLD:${family}`,labelZh:"签约家庭",labelEn:"Buying family",type:"HOUSEHOLD"}]}}));
    await page.route("**/api/products",route=>route.fulfill({json:{items:[{id:product,nameZh:"大学预科",nameEn:"Foundation",active:true}]}}));
    const summary={validCount:0,renewalCount:0,under30Count:0,riskCount:0,renewalByCurrency:{},lifecycle:{draft:0,active:0,preparing:0,negotiating:0,risk:0},renewalAlerts:[]};
    await page.route("**/api/contracts**",route=>{if(route.request().method()==="POST")writes.push(route.request().postDataJSON());return route.fulfill({json:{items:[],total:0,summary}});});
    const finance={quotes:[],quoteTotal:0,contracts:[],contractTotal:0,receivables:[],receivableTotal:0,payments:[],paymentTotal:0,refunds:[],refundTotal:0,reconciliations:[],reconciliationTotal:0,pageSize:10,risk:{openReceivables:0,overdueReceivables:0,pendingRefunds:0,reconciliationExceptions:0},products:[{id:product,code:"FOUNDATION",nameZh:"大学预科",nameEn:"Foundation"}],bundles:[],exchangeRates:[]};
    await page.route("**/api/finance**",route=>{if(route.request().method()==="POST")writes.push(route.request().postDataJSON());return route.fulfill({json:finance});});
    const bundle=await build({entryPoints:["tests/fixtures/family-purchasing-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome145",alias:{"next/link":path.resolve("tests/fixtures/qa-link.tsx"),"next/navigation":path.resolve("tests/fixtures/qa-navigation.ts")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html lang="zh-CN"><head><title>Family purchasing QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync("dist/client/_next/static",{recursive:true}).filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file.replaceAll("\\","/")}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole("button",{name:"新建合同草稿",exact:true}).click();
    const dialog=page.getByRole("dialog");await dialog.getByRole("button",{name:"客户",exact:true}).click();await dialog.getByRole("option",{name:/签约家庭/}).click();
    await dialog.locator('[name="contractNumber"]').fill("FAMILY-QA");await dialog.locator('[name="startDate"]').fill("2026-10-03");await dialog.locator('[name="endDate"]').fill("2027-07-01");await dialog.locator('[data-money-input="value"]').fill("1000");
    for(const viewport of [{width:1440,height:900},{width:375,height:812}]){await page.setViewportSize(viewport);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`family-contract-${viewport.width}.png`),fullPage:true});}
    await dialog.getByRole("button",{name:"创建",exact:true}).click();await dialog.waitFor({state:"hidden"});assert.equal(writes[0].householdId,family);assert.equal(writes[0].organizationId,null);
    await page.getByRole("button",{name:"QA switch",exact:true}).click();await page.getByRole("button",{name:"新建报价",exact:true}).click();
    const form=page.locator("form.finance-create");await form.getByRole("button",{name:"购买方（组织 / 家庭）",exact:true}).click();await form.getByRole("option",{name:/签约家庭/}).click();
    await form.locator('[name="number"]').fill("FAMILY-QUOTE-QA");await form.locator('[name="validUntil"]').fill("2027-01-01");await form.locator("select").filter({has:page.locator(`option[value="${product}"]`)}).selectOption(product);await form.locator('[data-money-input="subtotal"]').fill("1000");await form.locator('[name="termsZh"]').fill("按约提供预科咨询服务");await form.locator('[name="termsEn"]').fill("Foundation advisory services");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,"family-quote-375.png"),fullPage:true});
    await form.getByRole("button",{name:"创建",exact:true}).click();await form.waitFor({state:"hidden"});assert.equal(writes[1].target_household,family);assert.equal(writes[1].target_organization,null);
    report.pages.push({label:"family-purchasing",route:"isolated-family-purchasing-fixture",checks:["family-contract-payload","family-quote-payload","desktop-mobile-no-overflow"],boundary:"Real components and production CSS, mocked API. Database writes tested separately."});
  }finally{await context.close();}
};
