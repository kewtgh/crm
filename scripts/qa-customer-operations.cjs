/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:"zh-CN",bypassCSP:true});
  const requests=[],customer="00000000-0000-4000-8000-000000000002";
  const snapshot={subject:"HOUSEHOLD",id:"00000000-0000-4000-8000-000000000001",nameZh:"测试家庭",nameEn:"Test family",shortName:"",ownerName:"负责销售",profile:{},level:1,plan:null,entries:[],entryTotal:0,completed:0,contacts:[{id:customer,name_zh:"家长",communication_level:1}],contracts:[],opportunities:[],students:[],products:[],limited:false};
  try{
    const page=await context.newPage();observe(page);page.setDefaultTimeout(5000);
    const health=await page.goto(`${base}/api/health`);assert.ok(health?.ok());assert.equal((await health.json()).version,report.evidence.appVersion);
    await page.route("**/api/customer-operations**",async route=>{const data=route.request().postDataJSON();if(data){requests.push(data);if(data.operation==="plan")snapshot.plan={title:data.title,target_level:data.targetLevel,target_count:data.targetCount,start_date:data.startDate,due_date:data.dueDate,updated_at:new Date().toISOString()};if(data.operation==="entry"){snapshot.entries.push({id:"entry",kind:data.kind,summary:data.summary,next_step:data.nextStep,occurred_at:data.occurredAt});snapshot.entryTotal++;snapshot.completed++;}}await route.fulfill({json:data?{item:{id:"saved"}}:snapshot});});
    await page.route("**/api/search/related**",route=>route.fulfill({json:{items:[{value:`CONTACT:${customer}`,labelZh:"家长 / Parent",labelEn:"Parent",type:"CONTACT"}]}}));
    await page.route("**/api/customer-email",async route=>{const data=route.request().postDataJSON();requests.push(data);await route.fulfill({json:data.operation==="preview"?{items:[{id:customer,name:"家长",email:"parent@example.test",blocked:false,subject:"跟进",body:"家长，您好！您的对接人是负责销售。",purpose:"SERVICE"}],hash:"a".repeat(64)}:{queued:1,failed:0,results:[{id:customer,queued:true,threadId:"thread"}]}});});
    const bundle=await build({entryPoints:["tests/fixtures/customer-operations-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome145",alias:{"next/navigation":path.resolve("tests/fixtures/qa-navigation.ts"),"next/link":path.resolve("tests/fixtures/qa-link.tsx")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html lang="zh-CN"><head><title>Customer operations QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync("dist/client/_next/static").filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file}`});await page.addScriptTag({content:bundle.outputFiles[0].text});
    for(const viewport of [{width:1440,height:900},{width:375,height:812}]){
      await page.setViewportSize(viewport);await page.getByRole("tab",{name:"跟进与目标",exact:true}).click();const planSection=page.locator('details:has(input[name="targetCount"])');if(!await planSection.evaluate(element=>element.open))await page.getByText("设置或调整跟进目标",{exact:true}).click();
      const plan=page.locator('form:has(input[name="targetCount"])');await plan.locator('input[name="title"]').fill("客户跟进目标");await plan.locator('input[name="dueDate"]').fill("2026-10-31");await plan.getByRole("button",{name:"保存",exact:true}).click();await page.getByText("客户跟进目标",{exact:true}).first().waitFor();
      const entrySection=page.locator('details:has(textarea[name="summary"])');if(!await entrySection.evaluate(element=>element.open))await page.getByText("记录实际跟进",{exact:true}).click();const entry=page.locator('form:has(textarea[name="summary"])');await entry.locator('textarea[name="summary"]').fill("已经沟通需求");await entry.locator('textarea[name="nextStep"]').fill("确认会谈时间");await entry.getByRole("button",{name:"保存",exact:true}).click();await page.getByText("已经沟通需求",{exact:true}).last().waitFor();
      await page.getByRole("tab",{name:"合同与产品",exact:true}).click();await page.getByRole("tab",{name:"客户与家庭成员",exact:true}).click();await page.getByRole("link",{name:"家长",exact:true}).waitFor();
      const mail=page.locator('section:has(> h1)');await mail.locator(".select-trigger").click();await mail.getByRole("option",{name:"家长 / Parent",exact:true}).click();await mail.getByRole("button",{name:"生成个性化预览",exact:true}).click();await mail.getByText("家长 · parent@example.test",{exact:true}).click();assert.ok((await mail.locator("pre").textContent()).includes("负责销售"));
      await mail.getByRole("button",{name:"确认并入队（1 位）",exact:true}).click();await mail.getByText("已入队 1 位，未入队 0 位。",{exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`customer-operations-${viewport.width}.png`),fullPage:true});
      report.pages.push({label:`customer-operations-${viewport.width}`,route:"isolated-customer-operations-fixture",viewport,checks:["follow-up-plan","follow-up-entry","tabs","family-members","email-preview","bulk-queue","no-overflow"],boundary:"Mocked API responses; SQL authorization verified separately on isolated PostgreSQL."});
      await mail.getByRole("button",{name:"开始新批次",exact:true}).click();
    }
    assert.ok(requests.filter(item=>item.operation==="queue").every(item=>item.previewHash==="a".repeat(64)&&item.contactIds.length===1));
  }catch(error){report.errors.push({kind:"customer-operations",message:error.message});throw error;}finally{await context.close();}
};
