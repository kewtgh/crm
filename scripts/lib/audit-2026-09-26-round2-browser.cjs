/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");

module.exports = async function auditRound2({ page, identity, base, workspaceId, query, output }) {
  const taskId = randomUUID();
  const taskName = `Audit R2 ${taskId}`;
  const batchId = randomUUID();
  const rowId = randomUUID();
  let replacement;
  let notificationWrites = 0;
  const countWrite = request => { if (request.url().includes("/api/notifications") && request.method() === "PATCH") notificationWrites++; };
  page.on("request", countWrite);
  const importsPattern = "**/api/imports**";
  try {
    await query("insert into public.crm_tasks(id,workspace_id,title_zh,title_en,owner_id,created_by) values($1,$2,$3,$3,$4,$4)", [taskId,workspaceId,taskName,identity.id]);
    await query(`insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key,source_type,source_id)
      select $1,$2,'AUDIT_R2','nav.notifications','notifications.description','TASK',$3 from generate_series(1,2)`, [workspaceId,identity.id,taskId]);
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`${base}/dashboard`, {waitUntil:"networkidle"});
    assert.equal(await page.locator('.operations-snapshot a[href="/notifications"]').count(),1);
    await page.goto(`${base}/action-center`, {waitUntil:"networkidle"});
    assert.equal(await page.locator('.action-center-card[href="/notifications"]').count(),1);
    await page.goto(`${base}/admin`, {waitUntil:"networkidle"});
    assert.equal(await page.locator('.admin-task a[href="/notifications"]').count(),1);
    assert.equal(await page.locator('.admin-metric[href="/admin/operations"]').count(),1);
    await page.goto(`${base}/notifications`, {waitUntil:"networkidle"});
    await page.waitForFunction(()=>document.querySelectorAll(".notification-center>article").length===2);
    assert.equal(await page.locator(".notification-center article a").first().getAttribute("href"), `/tasks/${taskId}`);
    await page.locator(".notification-center article a").first().click();
    await page.waitForURL(`**/tasks/${taskId}`);
    await page.getByRole("heading", {level:1}).filter({hasText:taskName}).waitFor();
    await page.goto(`${base}/notifications`, {waitUntil:"networkidle"});
    await page.getByRole("button",{name:"刷新通知",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector(".notification-center")?.getAttribute("aria-busy")==="false");
    await page.setViewportSize({width:375,height:812});
    await page.screenshot({path:path.join(output,"notifications-populated-375.png"),fullPage:true});
    await page.setViewportSize({width:1440,height:900});
    await page.getByRole("button",{name:"通知",exact:true}).click();
    const popover=page.locator(".top-popover.notifications");
    await page.waitForFunction(()=>document.querySelectorAll(".top-popover.notifications>a:not(.popover-footer)").length===2);
    await popover.getByRole("button",{name:"全部已读",exact:true}).evaluate(button=>{button.click();button.click();});
    await page.waitForFunction(()=>document.querySelectorAll(".notification-center>article").length===0&&document.querySelector(".notification-center")?.getAttribute("aria-busy")==="false");
    assert.equal(notificationWrites,1,"Double click should submit once");
    await page.waitForFunction(()=>document.querySelectorAll(".top-popover.notifications>a:not(.popover-footer)").length===0);
    process.stdout.write("[QA R2] pass notification detail, refresh, cross-surface sync and duplicate guard\n");

    // Browser-only fixtures: no import or customer records are created by these requests.
    await page.goto(`${base}/imports`,{waitUntil:"networkidle"});
    const batch={id:batchId,resourceType:"STUDENTS",filename:"audit-students.xlsx",status:"READY",total:51,valid:0,invalid:51,duplicates:0,applied:0,failed:0,createdAt:new Date().toISOString()};
    const row={id:rowId,batchId,rowNumber:2,normalized:{nameZh:"测试学生",nameEn:"Student",studentNumber:"R2-001",currentGrade:"G6"},status:"INVALID",errors:[],decision:null,duplicateId:null,score:null,reasons:[],lastError:null};
    await page.route(importsPattern,async route=>{
      const request=route.request();const url=new URL(request.url());
      const json=data=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
      if(request.method()==="POST") {
        const body=request.postDataJSON();assert.equal(body.operation,"repair");assert.equal(body.target_row,rowId);replacement=body.replacement;
        return json({ok:true});
      }
      if(url.pathname.endsWith("/dry-run")) return json({summary:{create:0,update:0,merge:0,skip:0,invalid:51,unresolved:0,canExecute:false}});
      if(url.searchParams.has("batch")) {
        if(url.searchParams.get("rowPageSize")==="10") return route.fulfill({status:200,contentType:"application/json",body:"not-json"});
        return json({items:[row],total:51});
      }
      if(url.searchParams.get("page")==="2") return route.fulfill({status:200,contentType:"application/json",body:"not-json"});
      return json({items:[batch],total:21});
    });
    await page.locator(".batch-list .pagination select").selectOption("20");
    await page.getByRole("button").filter({hasText:"audit-students.xlsx"}).click();
    await page.locator(".import-row").getByRole("button",{name:"修复此行"}).click();
    const drawer=page.locator(".record-drawer");
    await drawer.locator('input[name="studentNumber"]').waitFor();
    assert.equal(await drawer.locator('input[name="email"]').count(),0);
    assert.equal(await drawer.locator('input[name="studentNumber"]').inputValue(),"R2-001");
    await drawer.locator('input[name="studentNumber"]').fill("R2-002");
    await drawer.getByRole("button",{name:"保存",exact:true}).click();
    await drawer.waitFor({state:"hidden"});
    assert.equal(replacement.studentNumber,"R2-002");
    assert.equal(Object.hasOwn(replacement,"email"),false);
    await page.waitForFunction(()=>document.querySelectorAll(".import-row").length===1);
    await page.locator(".import-rows .pagination select").selectOption("10");
    await page.waitForFunction(()=>document.querySelector(".import-rows")?.textContent.includes("加载失败"));
    assert.equal(await page.locator(".import-rows .pagination select").inputValue(),"50");
    assert.equal(await page.locator(".import-row").count(),1);
    const paging=page.locator(".batch-list .pagination");
    await paging.getByRole("button",{name:"2",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector(".import-create")?.textContent.includes("加载失败"));
    assert.equal(await paging.locator('[aria-current="page"]').innerText(),"1");
    assert.equal(await paging.locator("select").inputValue(),"20");
    await page.screenshot({path:path.join(output,"imports-failure-preserves-state.png"),fullPage:true});
    process.stdout.write("[QA R2] pass historical student repair and failed batch/row pagination\n");
  } finally {
    await page.unroute(importsPattern);
    page.off("request",countWrite);
    await query("delete from public.user_notifications where user_id=$1 and kind='AUDIT_R2'",[identity.id]);
    await query("delete from public.crm_tasks where id=$1 and owner_id=$2",[taskId,identity.id]);
  }
};
