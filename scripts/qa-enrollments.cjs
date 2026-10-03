/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:"zh-CN",bypassCSP:true}),rows=[],sources=[],history=[],receipts=new Map(),requests=[];
  const ids={STUDENT:"00000000-0000-4000-8000-000000000001",HOUSEHOLD:"00000000-0000-4000-8000-000000000003",COHORT:"00000000-0000-4000-8000-000000000004",USER:"00000000-0000-4000-8000-000000000099",ORGANIZATION:"00000000-0000-4000-8000-000000000005",CONTACT:"00000000-0000-4000-8000-000000000006",EVENT:"00000000-0000-4000-8000-000000000007",CAMPAIGN:"00000000-0000-4000-8000-000000000008",REFERRAL:"00000000-0000-4000-8000-000000000009"};
  const names={STUDENT:["张三","Zhang San"],HOUSEHOLD:["张家","Zhang Family"],COHORT:["GAPP 秋季 2027","GAPP Fall 2027"],USER:["QA","QA"],ORGANIZATION:["上海学校","Shanghai School"],CONTACT:["王顾问","Counselor Wang"],EVENT:["GAPP 宣讲","GAPP Seminar"],CAMPAIGN:["秋季招生","Fall recruitment"],REFERRAL:["2026-10-03 转介","2026-10-03 referral"]};
  let unknownNext=false,conflictNext=false;
  try{
    const page=await context.newPage();observe(page);page.setDefaultTimeout(4000);await page.setViewportSize({width:1440,height:900});
    const health=await page.goto(`${base}/api/health`);assert.ok(health?.ok());
    assert.equal((await context.request.get(`${base}/api/enrollments`)).status(),401);
    assert.equal((await context.request.post(`${base}/api/enrollments`,{headers:{origin:base},data:{}})).status(),401);
    assert.equal((await context.request.patch(`${base}/api/enrollments`,{headers:{origin:base},data:{}})).status(),401);
    await page.route("**/api/search/related**",route=>{const type=new URL(route.request().url()).searchParams.get("types");return route.fulfill({json:{items:ids[type]?[{value:`${type}:${ids[type]}`,type,labelZh:names[type][0],labelEn:names[type][1]}]:[]}});});
    await page.route("**/api/education**",route=>route.fulfill({json:{item:{id:ids.STUDENT,personId:ids.CONTACT,nameZh:"张三",nameEn:"Zhang San",householdId:ids.HOUSEHOLD,householdZh:"张家",householdEn:"Zhang Family",studentNumber:"S001",grade:"Grade 11",academicYear:"2026",status:"ACTIVE",updatedAt:"2026-10-03T00:00:00Z",birthDate:"",currentClass:"",personalityMarkdown:"",learningExpectationsMarkdown:"",strengthsMarkdown:"",supportNeedsMarkdown:"",interests:[],preferredLearningStyle:"",academicRecords:[],guardians:[]}}}));
    await page.route("**/api/enrollments**",async route=>{
      const params=new URL(route.request().url()).searchParams;
      if(route.request().method()==="GET"){
        if(new URL(route.request().url()).pathname.endsWith("/finance"))return route.fulfill({json:{item:{enrollmentId:rows[0]?.id,available:false,partial:false,allocationStatus:null,contracts:[],exclusiveTotalsByCurrency:[],sharedContracts:[]}}});
        if(params.get("resource")==="contracts")return route.fulfill({json:{items:[]}});
        if(params.get("resource")==="options"){const type=params.get("type");return route.fulfill({json:{items:[{value:ids[type],labelZh:names[type][0],labelEn:names[type][1]}]}});}
        if(params.get("resource")==="history")return route.fulfill({json:{items:history}});
        if(params.get("resource")==="attributions")return route.fulfill({json:{items:sources}});
        if(params.has("id"))return route.fulfill({json:{item:rows.find(row=>row.id===params.get("id"))}});
        const items=rows.filter(row=>(!params.get("status")||row.status===params.get("status"))&&(!params.get("studentId")||row.student_id===params.get("studentId"))&&(!params.get("cohortId")||row.cohort_id===params.get("cohortId"))&&(!params.get("ownerId")||row.owner_id===params.get("ownerId"))&&(!params.get("query")||/张|Zhang|S001/i.test(params.get("query"))));
        return route.fulfill({json:{items,total:items.length,page:Number(params.get("page")||1),pageSize:Number(params.get("pageSize")||20)}});
      }
      const body=route.request().postDataJSON();requests.push(body);
      if(conflictNext){conflictNext=false;return route.fulfill({status:409,json:{code:"ENROLLMENT_VERSION_CONFLICT"}});}
      const input=body.operation==="attribution"?body.input:body;
      let item=receipts.get(input.requestKey);
      if(!item){
        if(body.operation==="attribution"){
          item={...input.data,id:input.id,created_at:"2026-10-03T00:00:00Z",organization_name_zh:"上海学校",organization_name_en:"Shanghai School",contact_name_zh:"王顾问",contact_name_en:"Counselor Wang",event_name:"GAPP Seminar",campaign_name_zh:"秋季招生",campaign_name_en:"Fall recruitment",referral_on:"2026-10-03",referral_organization_name_zh:"上海学校",referral_organization_name_en:"Shanghai School",referral_household_name_zh:"张家",referral_household_name_en:"Zhang Family"};sources.push(item);
          if(item.attribution_type==="PRIMARY")rows.find(row=>row.id===item.enrollment_id).has_primary_attribution=true;
        }else{
          const previous=rows.find(row=>row.id===input.id);
          item={...input.data,id:input.id,revision:(input.expectedRevision??0)+1,created_at:"2026-10-03T00:00:00Z",updated_at:"2026-10-03T00:00:00Z",student_name_zh:"张三",student_name_en:"Zhang San",student_number:"S001",cohort_name_zh:"GAPP 秋季 2027",cohort_name_en:"GAPP Fall 2027",product_name_zh:"GAPP 产品",product_name_en:"GAPP Product",owner_name_zh:"QA",owner_name_en:"QA",household_name_zh:"张家",household_name_en:"Zhang Family",can_edit:true,has_primary_attribution:previous?.has_primary_attribution??false};
          if(!previous||previous.status!==item.status)history.push({id:String(history.length+1),from_status:previous?.status??null,to_status:item.status,enrollment_revision:item.revision,changed_at:item.updated_at,reason:input.statusReason});
          if(previous)rows[rows.indexOf(previous)]=item;else rows.push(item);
        }
        receipts.set(input.requestKey,item);
      }
      if(unknownNext){unknownNext=false;return route.fulfill({status:503,json:{code:"ENROLLMENT_SAVE_FAILED"}});}
      return route.fulfill({json:{item}});
    });
    const bundle=await build({entryPoints:["tests/fixtures/enrollments-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome145",alias:{"next/link":path.resolve("tests/fixtures/qa-link.tsx"),"next/navigation":path.resolve("tests/fixtures/qa-navigation.ts")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html lang="zh-CN"><head><title>Enrollment QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync("dist/client/_next/static",{recursive:true}).filter(file=>file.endsWith(".css")))await page.addStyleTag({url:`${base}/_next/static/${file.replaceAll("\\","/")}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const dialog=page.getByRole("dialog"),choose=async(label,option,scope=dialog)=>{await scope.getByRole("button",{name:label,exact:true}).click();await scope.getByRole("option",{name:option,exact:true}).click();};
    await page.getByRole("button",{name:"新建参与记录",exact:true}).click();await choose("学生","张三");await choose("产品批次","GAPP 秋季 2027");
    await dialog.getByRole("button",{name:"家庭业务上下文",exact:true}).getByText("张家",{exact:true}).waitFor();
    await dialog.locator('[name="status"]').selectOption("ACTIVE");await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.getByText(/请检查学生、批次、负责人和生命周期日期/).waitFor();assert.equal(requests.length,0);
    await dialog.locator('[name="enrolled_at"]').fill("2027-09-01T08:00");unknownNext=true;await dialog.getByRole("button",{name:"保存",exact:true}).click();
    await dialog.getByRole("button",{name:"重试并确认保存结果",exact:true}).waitFor();assert.equal(await dialog.locator('[name="status"]').isDisabled(),true);await page.keyboard.press("Escape");assert.equal(await dialog.isVisible(),true);
    await dialog.getByRole("button",{name:"重试并确认保存结果",exact:true}).click();await dialog.getByRole("tab",{name:"概览",exact:true}).waitFor();assert.deepEqual(requests[0],requests[1]);assert.equal(rows.length,1);
    await dialog.getByRole("button",{name:"编辑参与记录",exact:true}).click();assert.equal(await dialog.getByLabel("学生",{exact:true}).isEditable(),false);assert.equal(await dialog.getByLabel("产品批次",{exact:true}).isEditable(),false);
    await dialog.locator('[name="statusReason"]').fill("保留冲突草稿");conflictNext=true;await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.getByText(/记录已被其他人修改/).waitFor();assert.equal(await dialog.locator('[name="statusReason"]').inputValue(),"保留冲突草稿");await dialog.getByRole("button",{name:"取消",exact:true}).click();
    await dialog.getByRole("tab",{name:"来源归因",exact:true}).click();await dialog.getByRole("button",{name:"添加主要来源",exact:true}).click();await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.getByText("请至少选择一个真实来源。",{exact:true}).waitFor();
    await choose("学校 / 机构","上海学校");await choose("联系人 / 顾问","王顾问");await choose("教育活动","GAPP 宣讲");await choose("招生活动 Campaign","秋季招生");await choose("家庭转介","2026-10-03 转介");
    await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.getByRole("button",{name:"添加主要来源",exact:true}).waitFor();assert.equal(await dialog.getByRole("button",{name:"添加主要来源",exact:true}).isDisabled(),true);
    await dialog.getByRole("button",{name:"添加辅助来源",exact:true}).click();await choose("联系人 / 顾问","王顾问");await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.getByText("辅助来源",{exact:true}).waitFor();assert.equal(sources.length,2);
    await dialog.getByRole("tab",{name:"状态历史",exact:true}).click();await dialog.getByText("建立记录 → 正式参与",{exact:true}).waitFor();
    await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
    await page.getByPlaceholder("搜索学生姓名或学号…").fill("Zhang");await page.getByRole("button",{name:"搜索",exact:true}).click();await choose("产品批次","GAPP 秋季 2027",page);await choose("负责人","QA",page);
    await page.locator(".enrollment-filters select").selectOption("COMPLETED");await page.getByText("当前范围暂无参与记录。",{exact:true}).waitFor();await page.locator(".enrollment-filters select").selectOption("ACTIVE");await page.getByRole("button",{name:"详情",exact:true}).waitFor();
    for(const viewport of [{width:1440,height:900},{width:375,height:812}]){
      await page.setViewportSize(viewport);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`enrollments-list-${viewport.width}.png`),fullPage:true});
      await page.getByRole("button",{name:"详情",exact:true}).click();await dialog.getByRole("tab",{name:"概览",exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`enrollment-detail-${viewport.width}.png`),fullPage:true});
      await dialog.getByRole("button",{name:"编辑参与记录",exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`enrollment-editor-${viewport.width}.png`),fullPage:true});await dialog.getByRole("button",{name:"取消",exact:true}).click();
      if(viewport.width===375){await dialog.getByRole("tab",{name:"来源归因",exact:true}).click();assert.equal(await dialog.getByRole("button",{name:"添加主要来源",exact:true}).isDisabled(),true);await dialog.getByRole("button",{name:"添加辅助来源",exact:true}).click();await choose("教育活动","GAPP 宣讲");await dialog.getByRole("button",{name:"保存",exact:true}).click();await dialog.getByRole("button",{name:"添加辅助来源",exact:true}).waitFor();assert.equal(sources.length,3);await page.screenshot({path:path.join(output,"enrollment-attribution-375.png"),fullPage:true});}
      await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
      await page.getByRole("button",{name:"新建参与记录",exact:true}).click();await dialog.getByRole("button",{name:"学生",exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
      report.pages.push({label:`enrollments-${viewport.width}`,route:"isolated-enrollments-fixture",viewport,checks:["list/search/cohort/owner/status","create/detail/edit","immutable-identities","lifecycle-validation","household-prefill","PRIMARY/ASSIST-five-sources","canonical-history","uncertain-retry","conflict-draft","no-overflow"],boundary:"Actual Enrollment components and production CSS with mocked business API; real unauthenticated API and PostgreSQL authorization/transactions verified separately."});
    }
    await page.getByRole("button",{name:"QA English",exact:true}).click();await page.getByRole("heading",{name:"Enrollments",exact:true}).waitFor();await page.getByRole("button",{name:"Details",exact:true}).click();await dialog.getByRole("tab",{name:"Attribution",exact:true}).click();await dialog.getByText("Organization / school: Shanghai School",{exact:true}).waitFor();assert.equal(await dialog.getByRole("button",{name:"Add primary attribution",exact:true}).isDisabled(),true);assert.ok(!/\benrollments\.[a-zA-Z]/.test(await dialog.textContent()));await page.keyboard.press("Escape");
    for(const width of [1440,375]){
      await page.setViewportSize({width,height:width===375?812:900});
      await page.screenshot({path:path.join(output,`enrollments-list-${width}-en.png`),fullPage:true});
      await page.getByRole("button",{name:"Details",exact:true}).click();await dialog.getByRole("tab",{name:"Overview",exact:true}).waitFor();
      await dialog.getByText("Some financial information is unavailable under your current access.",{exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(output,`enrollment-detail-${width}-en.png`),fullPage:true});
      await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});
      report.pages.push({label:`enrollments-${width}-en`,route:"isolated-enrollments-fixture",viewport:{width},locale:"en",checks:["English list/detail","Enrollment remains visible without Finance","no-overflow"],boundary:"Actual components and production CSS; finance-unavailable fixture, database access verified separately."});
    }
    await page.getByRole("button",{name:"QA Student detail",exact:true}).click();await dialog.getByRole("heading",{name:"Enrollments",exact:true}).waitFor();assert.equal(await dialog.getByRole("link",{name:"View enrollments",exact:true}).getAttribute("href"),`/enrollments?studentId=${ids.STUDENT}`);await dialog.getByRole("link",{name:"GAPP Product · GAPP Fall 2027",exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,"student-enrollments-375.png"),fullPage:true});
    await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden"});await page.setViewportSize({width:1440,height:900});await page.getByRole("button",{name:"Details",exact:true}).click();await dialog.getByRole("link",{name:"View enrollments",exact:true}).waitFor();await page.screenshot({path:path.join(output,"student-enrollments-1440.png"),fullPage:true});
    report.pages.push({label:"student-detail-enrollments",route:"isolated-actual-students-detail",viewports:[375,1440],checks:["existing-student-detail-entry","existing-student-record","bilingual","enrollment-deep-link","no-overflow"]});
    const expected=report.errors.filter(error=>error.url.includes("/api/enrollments")&&(error.kind==="response"&&["409","503"].includes(error.message)||error.kind==="console"&&/Failed to load resource.*(?:409|503)/.test(error.message)));
    assert.equal(expected.filter(error=>error.kind==="response").length,2);report.expectedErrors=expected;report.errors=report.errors.filter(error=>!expected.includes(error));
    console.log("PASS Enrollment Chromium: responsive list/create/detail, Student integration, five attribution sources, bilingual UI, immutable identity, revision conflict and stable retry");
  }finally{await context.close();}
};
