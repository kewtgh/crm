/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), {build} = require("esbuild");
module.exports = async ({browser, base, output, report, observe}) => {
  const context = await browser.newContext({locale: "zh-CN", bypassCSP: true}), rows = [], receipts = new Map(), requests = [];
  let unknownNext = false, conflictNext = false, failRead = false;
  try {
    const page = await context.newPage(); observe(page); page.setDefaultTimeout(4000);
    const health = await page.goto(`${base}/api/health`); assert.ok(health?.ok()); assert.equal((await health.json()).version, report.evidence.appVersion);
    assert.equal((await context.request.get(`${base}/api/product-cohorts?productId=00000000-0000-4000-8000-000000000001`)).status(), 401);
    assert.equal((await context.request.post(`${base}/api/product-cohorts`, {data: {}})).status(), 401);
    await page.route("**/api/product-cohorts**", async route => {
      if (route.request().method() === "GET") {
        if (failRead) { failRead = false; return route.fulfill({status: 503, json: {code: "COHORT_LOAD_FAILED"}}); }
        const status = new URL(route.request().url()).searchParams.get("status");
        return route.fulfill({json: {items: rows.filter(row => !status || row.status === status)}});
      }
      const body = route.request().postDataJSON(); requests.push(body);
      if (conflictNext) { conflictNext = false; return route.fulfill({status: 409, json: {code: "COHORT_VERSION_CONFLICT"}}); }
      let row = receipts.get(body.requestKey);
      if (!row) {
        const index = rows.findIndex(item => item.id === body.id);
        row = {...body.data, id: body.id, workspaceId: "00000000-0000-4000-8000-000000000001", revision: (body.expectedRevision ?? 0) + 1, createdBy: null, createdAt: "2026-10-03", updatedAt: "2026-10-03"};
        if (index < 0) rows.push(row); else rows[index] = row;
        receipts.set(body.requestKey, row);
      }
      if (unknownNext) { unknownNext = false; return route.fulfill({status: 503, json: {code: "COHORT_SAVE_FAILED"}}); }
      return route.fulfill({json: {item: row}});
    });
    const bundle = await build({entryPoints:["tests/fixtures/product-cohorts-qa.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",target:"chrome145",alias:{"next/link":path.resolve("tests/fixtures/qa-link.tsx"),"next/navigation":path.resolve("tests/fixtures/qa-navigation.ts")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
    await page.setContent('<html lang="zh-CN"><head><title>Product Cohort QA</title></head><body><div id="root"></div></body></html>');
    for (const file of fs.readdirSync("dist/client/_next/static", {recursive: true}).filter(file => file.endsWith(".css"))) await page.addStyleTag({url:`${base}/_next/static/${file.replaceAll("\\", "/")}`});
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    await page.getByRole("button", {name:"详情", exact:true}).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", {name:"产品批次", exact:true}).click();
    await dialog.getByText("此产品尚无招生与交付批次。", {exact:true}).waitFor();
    await dialog.getByRole("button", {name:"新建批次", exact:true}).click();
    await dialog.locator('[name="nameZh"]').fill("GAPP 秋季 2027");
    await dialog.locator('[name="code"]').fill("GAPP-FALL-2027");
    await dialog.locator('[name="intakeType"]').selectOption("FALL");
    await dialog.locator('[name="status"]').selectOption("RECRUITING");
    await dialog.locator('[name="applicationDeadline"]').fill("2027-10-01");
    await dialog.locator('[name="startOn"]').fill("2027-09-01");
    await dialog.getByRole("button", {name:"保存", exact:true}).click();
    await dialog.getByText("请检查名称、代码、日期顺序与容量。招生目标不能超过容量。", {exact:true}).waitFor(); assert.equal(requests.length, 0);
    await dialog.locator('[name="applicationDeadline"]').fill("2027-06-01");
    await dialog.locator('[name="targetEnrollment"]').fill("0"); await dialog.locator('[name="capacity"]').fill("30");
    unknownNext = true; await dialog.getByRole("button", {name:"保存", exact:true}).click();
    await dialog.getByRole("button", {name:"重试并确认保存结果", exact:true}).waitFor();
    assert.equal(await dialog.locator('[name="code"]').isDisabled(), true);
    await page.keyboard.press("Escape"); assert.equal(await dialog.isVisible(), true);
    await dialog.getByRole("button", {name:"重试并确认保存结果", exact:true}).click();
    await dialog.getByText("批次已保存。", {exact:true}).waitFor();
    assert.deepEqual(requests[0], requests[1]); assert.equal(rows.length, 1); assert.equal(rows[0].targetEnrollment, 0);
    await dialog.getByRole("button", {name:"编辑批次：GAPP 秋季 2027", exact:true}).click();
    await dialog.locator('[name="academicYear"]').fill("保留冲突草稿"); conflictNext = true;
    await dialog.getByRole("button", {name:"保存", exact:true}).click(); await dialog.getByText(/此批次已被其他人修改/).waitFor();
    assert.equal(await dialog.locator('[name="academicYear"]').inputValue(), "保留冲突草稿");
    await dialog.getByRole("button", {name:"取消", exact:true}).click();
    await dialog.getByRole("button", {name:"编辑批次：GAPP 秋季 2027", exact:true}).click();
    await dialog.locator('[name="status"]').selectOption("CANCELLED"); failRead = true;
    await dialog.getByRole("button", {name:"保存", exact:true}).click();
    await dialog.getByText("已保存，但列表刷新失败。请重新加载查看，勿重复新建。", {exact:true}).waitFor();
    await dialog.getByRole("button", {name:"重新加载", exact:true}).click();
    await dialog.locator(".status-badge").filter({hasText:"已取消"}).waitFor();
    for (const viewport of [{width:1440,height:900},{width:375,height:812}]) {
      await page.setViewportSize(viewport);
      await page.screenshot({path:path.join(output, `product-cohorts-${viewport.width}.png`),fullPage:true});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await dialog.getByRole("button", {name:"编辑批次：GAPP 秋季 2027", exact:true}).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({path:path.join(output, `product-cohort-editor-${viewport.width}.png`),fullPage:true});
      await dialog.getByRole("button", {name:"取消", exact:true}).click();
      report.pages.push({label:`product-cohorts-${viewport.width}`,route:"isolated-products-fixture",viewport,checks:["product-detail-cohorts","create/edit/cancel","date-validation","zero-target","receipt-retry","uncertain-close-lock","conflict-draft","save-refresh-failure","no-overflow"],boundary:"Actual Products page, drawer and Cohort UI with production CSS and mocked API; database RPC/RLS verified separately."});
    }
    await page.keyboard.press("Escape"); await dialog.waitFor({state:"hidden"});
    await page.getByRole("button", {name:"QA English",exact:true}).click();
    for(const width of [1440,375]){
    await page.setViewportSize({width,height:width===375?812:900});
    await page.getByRole("button", {name:"Details",exact:true}).click();
    await dialog.getByRole("tab", {name:"Cohorts",exact:true}).click();
    await dialog.getByRole("button", {name:"Create cohort",exact:true}).waitFor();
    await dialog.getByRole("button", {name:"Create cohort",exact:true}).click();
    await dialog.getByText("Academic year", {exact:true}).waitFor();
    assert.ok(!/\bcohorts\.[a-zA-Z]/.test(await dialog.textContent()));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({path:path.join(output,`product-cohort-editor-${width}-en.png`),fullPage:true});
    await page.keyboard.press("Escape"); await dialog.waitFor({state:"hidden"});
    report.pages.push({label:`product-cohorts-${width}-en`,route:"isolated-products-fixture",viewport:{width},locale:"en",checks:["English Product/Cohort editor","no-overflow"],boundary:"Actual Product/Cohort components and production CSS with mocked authenticated API."});
    }
    await page.getByRole("button", {name:"QA Read only",exact:true}).click();
    await page.getByRole("button", {name:"Details",exact:true}).click();
    await dialog.getByRole("tab", {name:"Cohorts",exact:true}).click();
    await dialog.locator(".status-badge").filter({hasText:"Cancelled"}).waitFor();
    assert.equal(await dialog.getByRole("button", {name:"Create cohort",exact:true}).count(), 0);
    assert.equal(await dialog.getByRole("button", {name:/Edit cohort:/}).count(), 0);
    const expected = report.errors.filter(error => error.url.includes('/api/product-cohorts') && (error.kind === "response" && ["409","503"].includes(error.message) || error.kind === "console" && /Failed to load resource.*(?:409|503)/.test(error.message)));
    assert.equal(expected.filter(error => error.kind === "response").length, 3);
    report.expectedErrors = expected; report.errors = report.errors.filter(error => !expected.includes(error));
    console.log("PASS Chromium Product Cohorts: affected Products detail, bilingual/permissions, responsive editor, validation, draft conflict and stable retry");
  } finally { await context.close(); }
};
