/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:"zh-CN",bypassCSP:true}),requests=[],records={organizations:[],needs:[],pathways:[],events:[],referrals:[]};
  const school="00000000-0000-4000-8000-000000000001",family="00000000-0000-4000-8000-000000000002",student="00000000-0000-4000-8000-000000000003";
  const labels={[`ORGANIZATION:${school}`]:"学校 / School",[`HOUSEHOLD:${family}`]:"家庭 / Family",[`STUDENT:${student}`]:"学生 / Student"};
  let heldSave,heldResolve,failNext=false,conflictNext=false,failRead=false;
  const heldReady=new Promise(resolve=>{heldResolve=resolve;});
  try{
    const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);
    const health=await page.goto(`${base}/api/health`);assert.ok(health?.ok());assert.equal((await health.json()).version,report.evidence.appVersion);
    assert.equal((await context.request.get(`${base}/api/education-business?resource=needs`)).status(),401);
    // Middleware rejects unauthenticated writes before the route's origin/CSRF validation.
    assert.equal((await context.request.post(`${base}/api/education-business`,{data:{}})).status(),401);
    await page.route("**/api/search/related**",route=>{
      const type=new URL(route.request().url()).searchParams.get("types"),id=type==="HOUSEHOLD"?family:type==="STUDENT"?student:school;
      return route.fulfill({json:{items:[{value:`${type}:${id}`,labelZh:labels[`${type}:${id}`]??"联系人",labelEn:labels[`${type}:${id}`]??"Contact"}]}});
    });
    await page.route("**/api/education-business**",async route=>{
      const params=new URL(route.request().url()).searchParams;
      if(route.request().method()==="GET"){
        if(failRead){failRead=false;return route.fulfill({status:503,json:{code:"BUSINESS_LOAD_FAILED"}});}
        const resource=params.get("resource")??"organizations",items=records[resource];return route.fulfill({json:{items,total:items.length,page:1,pageSize:20,labels,editableIds:items.map(item=>item.id),today:"2026-10-02"}});
      }
      const data=route.request().postDataJSON();requests.push(data);
      if(conflictNext){conflictNext=false;return route.fulfill({status:409,json:{code:"BUSINESS_VERSION_CONFLICT"}});}
      const existing=records[data.resource].find(item=>item.id===data.id),item={...data.data,id:data.id,revision:existing?existing.revision+1:1,updated_at:"2026-10-02T00:00:00Z"};
      if(!existing)records[data.resource].push(item);else Object.assign(existing,item);
      if(data.resource==="events")labels[`EVENT:${item.id}`]=item.name;
      if(failNext){failNext=false;heldSave=()=>route.fulfill({status:500,json:{code:"BUSINESS_SAVE_FAILED"}});heldResolve();return;}
      return route.fulfill({json:{item}});
    });
    const bundle=await build({entryPoints:["tests/fixtures/education-business-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome145",alias:{"next/link":path.resolve("tests/fixtures/qa-link.tsx"),"next/navigation":path.resolve("tests/fixtures/qa-navigation.ts")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html lang="zh-CN"><head><title>Education business QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync("dist/client/_next/static").filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByText("共 0 条记录",{exact:true}).waitFor();
    const dialog=()=>page.getByRole("dialog");
    const choose=async(label,option)=>{await dialog().getByRole("button",{name:label,exact:true}).click();await dialog().getByRole("option",{name:option,exact:true}).click();};
    const tab=async name=>{await page.getByRole("tab",{name,exact:true}).click();await page.getByText(/共 \d+ 条记录/).waitFor();};
    const save=async()=>{await dialog().getByRole("button",{name:"保存",exact:true}).click();await dialog().waitFor({state:"hidden"});};
    await page.getByRole("button",{name:"补充组织业务档案",exact:true}).click();await choose("学校 / 主办组织","学校 / School");
    await dialog().locator('[name="organization_type"]').selectOption("PARTNER");await dialog().getByLabel("家庭转介伙伴",{exact:true}).check();await dialog().getByLabel("游学合作伙伴",{exact:true}).check();await dialog().locator('[name="next_action"]').fill("确认合作与宣讲");await save();assert.equal(records.organizations[0].roles.length,2);
    await tab("家庭教育需求");await page.getByRole("button",{name:"补充家庭教育需求",exact:true}).click();await choose("家庭","家庭 / Family");await dialog().getByLabel("大学预科",{exact:true}).check();await dialog().locator('[name="budget_min"]').fill("0");await dialog().locator('[name="budget_max"]').fill("10000");await dialog().locator('[name="budget_currency"]').selectOption("GBP");await save();assert.equal(records.needs[0].budget_min,0);
    await tab("学生升学方案");await page.getByRole("button",{name:"新建升学方案",exact:true}).click();await choose("学生","学生 / Student");await dialog().locator('[name="intake_date"]').fill("2027-09-01");await dialog().locator('[name="application_deadline"]').fill("2026-10-01");await dialog().locator('[name="language_test"]').selectOption("IELTS");await dialog().locator('[name="language_score"]').fill("6.5");await dialog().locator('[name="stage"]').selectOption("PREPARING");await save();await page.getByText("申请期限已过且仍在准备阶段，请核实下一步。",{exact:true}).waitFor();
    await tab("宣讲与游学");await page.getByRole("button",{name:"新建宣讲 / 游学活动",exact:true}).click();await dialog().locator('[name="name"]').fill("大学环境体验");await choose("学校 / 主办组织","学校 / School");await dialog().locator('[name="kind"]').selectOption("STUDY_TOUR");await dialog().locator('[name="starts_on"]').fill("2026-11-01");await dialog().locator('[name="ends_on"]').fill("2026-11-03");await save();
    await tab("学校 / 机构转介");await page.getByRole("button",{name:"登记家庭转介",exact:true}).click();await choose("来源学校 / 机构","学校 / School");await choose("家庭","家庭 / Family");await choose("来源活动","大学环境体验");await dialog().locator('[name="referred_on"]').fill("2026-10-02");await dialog().locator('[name="next_action"]').fill("向家长介绍桥梁项目");
    failNext=true;await dialog().getByRole("button",{name:"保存",exact:true}).click();await heldReady;await dialog().getByRole("button",{name:"取消",exact:true}).isDisabled().then(value=>assert.equal(value,true));await heldSave();await dialog().getByRole("button",{name:"重试并确认保存结果",exact:true}).click();await dialog().waitFor({state:"hidden"});const attempts=requests.filter(item=>item.resource==="referrals");assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);assert.equal(records.referrals.length,1);
    await page.getByRole("button",{name:"编辑资料",exact:true}).click();await dialog().locator('[name="next_action"]').fill("保留此冲突草稿");conflictNext=true;await dialog().getByRole("button",{name:"保存",exact:true}).click();await dialog().getByText(/记录已被其他人修改/).waitFor();assert.equal(await dialog().locator('[name="next_action"]').inputValue(),"保留此冲突草稿");await dialog().getByRole("button",{name:"取消",exact:true}).click();
    // Desktop/mobile cards and all five editors use production CSS.
    for(const viewport of [{width:1440,height:900},{width:375,height:812}]){
      await page.setViewportSize(viewport);
      for(const name of ["学校与机构档案","家庭教育需求","学生升学方案","宣讲与游学","学校 / 机构转介"]){await tab(name);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
      await page.getByRole("button",{name:"登记家庭转介",exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.keyboard.press("Escape");await dialog().waitFor({state:"hidden"});await page.screenshot({path:path.join(output,`education-business-${viewport.width}.png`),fullPage:true});
      report.pages.push({label:`education-business-${viewport.width}`,route:"isolated-education-business-fixture",viewport,checks:["five-business-record-types","relations","actual-language-score","budget-zero","deadline-advice","pending-lock","stable-uncertain-retry","conflict-draft","no-overflow","escape-close"],boundary:"Real UI and production CSS with mocked API; database constraints verified separately."});
    }
    await page.getByRole("tab",{name:"学校与机构档案",exact:true}).focus();await page.keyboard.press("ArrowRight");await page.getByRole("tab",{name:"家庭教育需求",exact:true}).getAttribute("aria-selected").then(value=>assert.equal(value,"true"));
    await page.getByRole("button",{name:"QA English",exact:true}).click();await page.getByRole("heading",{name:"Education business",exact:true}).waitFor();assert.ok(!await page.locator("body").textContent().then(text=>/\b(?:business|common)\.[a-zA-Z]/.test(text)));
    // A committed save followed by a failed list read must remain a success notice.
    await page.getByRole("button",{name:"QA 中文",exact:true}).click();await tab("学校 / 机构转介");await page.getByRole("button",{name:"编辑资料",exact:true}).click();await dialog().locator('[name="next_action"]').fill("更新已确认");failRead=true;await save();await page.getByText("已保存，但列表刷新失败。请刷新查看，勿重复新建。",{exact:true}).waitFor();await page.getByRole("button",{name:"重新加载",exact:true}).click();
    const expected=report.errors.filter(error=>error.url.includes('/api/education-business')&&(error.kind==="response"&&["500","409","503"].includes(error.message)||error.kind==="console"&&/Failed to load resource.*(?:500|409|503)/.test(error.message)));
    assert.equal(expected.filter(error=>error.kind==="response").length,3);
    report.errors=report.errors.filter(error=>!expected.includes(error));report.warnings.push(...expected.map(error=>({...error,kind:"expected-injected-failure"})));
  }catch(error){report.errors.push({kind:"education-business",message:error.message});throw error;}finally{await context.close();}
};
