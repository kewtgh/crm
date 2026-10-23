/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { build } = require("esbuild");

module.exports = async ({ browser, base, output, report }) => {
  const context = await browser.newContext({ bypassCSP: true, locale: "zh-CN" });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(4000);
    page.on("pageerror", error => report.errors.push({ kind: "pageerror", message: error.message.slice(0, 200) }));
    const health = await page.goto(`${base}/api/health`); assert.equal((await health.json()).version, report.evidence.appVersion);
    let failed = false, response = { role: "SALES_SPECIALIST", generatedAt: "2026-10-23T04:00:00Z", items: [], total: 0, urgent: 0, unavailableSources: [] };
    await page.route("**/api/**", route => route.fulfill(failed ? { status: 503, json: { code: "ACTION_CENTER_FAILED" } } : { json: response }));
    const bundle = await build({ entryPoints: ["tests/fixtures/action-review-qa.tsx"], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", target: "chrome156", alias: { "next/link": path.resolve("tests/fixtures/ux-foundation-link.tsx"), "next/navigation": path.resolve("tests/fixtures/ux-foundation-navigation.ts") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
    await page.setContent('<html lang="zh-CN"><head><title>Fictional action review QA</title></head><body><div id="root"></div></body></html>');
    for (const file of fs.readdirSync("dist/client/_next/static", { recursive: true }).filter(file => file.endsWith(".css"))) await page.addStyleTag({ url: `${base}/_next/static/${file.replaceAll("\\", "/")}` });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => Boolean(window.actionScenario));
    const nav = async href => page.evaluate(href => window.actionNavigate(href), href);
    const scenario = async (name, role) => page.evaluate(({ name, role }) => window.actionScenario(name, role), { name, role });
    const cards = count => page.waitForFunction(count => document.querySelectorAll(".action-center-card").length === count, count);
    const shot = async (label, checks) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, label);
      assert.equal(await page.locator(".action-center-filters").evaluateAll(nodes => nodes.every(nav => {
        const bounds = nav.getBoundingClientRect();
        return [...nav.querySelectorAll("button")].every(button => {
          const rect = button.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
        });
      })), true, `${label}: all category labels stay visible`);
      await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true });
      report.pages.push({ label, viewport: page.viewportSize(), status: "PASS", checks, boundary: "Real components and production CSS with fictional API fixtures; no live RLS test." });
      process.stdout.write(`[QA action-review] ${label} passed\n`);
    };
    for (const locale of ["zh-CN", "en"]) for (const width of [1440, 375]) {
      const en = locale === "en"; await page.setViewportSize({ width, height: 1000 });
      await page.getByRole("button", { name: en ? "QA English" : "QA 中文", exact: true }).click();
      await nav("/action-center?context=example"); await scenario("normal"); await cards(5);
      await page.getByRole("button", { name: en ? "Governance" : "治理", exact: true }).click(); await cards(1);
      assert.equal(new URL(page.url()).searchParams.get("context"), "example");
      assert.equal(new URL(page.url()).searchParams.get("category"), "governance");
      await page.getByRole("combobox", { name: en ? "Priority" : "优先级", exact: true }).selectOption("high"); await cards(0);
      await page.getByRole("heading", { name: en ? "No work matches these filters" : "没有符合筛选的事项", exact: true }).waitFor();
      await page.evaluate(() => history.back()); await cards(1);
      assert.equal(await page.getByRole("combobox").inputValue(), "all");
      await page.getByRole("button", { name: en ? "Clear action filters" : "清除行动筛选", exact: true }).click(); await cards(5);
      assert.equal(new URL(page.url()).searchParams.get("context"), "example");
      await nav("/action-center?category=work&priority=urgent&context=example"); await cards(1);
      assert.equal(await page.locator(".action-center-card").getAttribute("href"), "/tasks?queue=overdue");
      await page.keyboard.press("Tab"); assert.ok(await page.evaluate(() => document.activeElement !== document.body));
      await shot(`action-filter-${locale}-${width}`, ["category and urgency", "deep link", "history", "reset", "unrelated context", "keyboard", "overflow"]);
      await nav("/action-center"); await scenario("partial-empty"); await cards(0);
      await page.getByText(en ? "Work information is incomplete" : "待办信息尚不完整", { exact: true }).waitFor();
      await page.getByRole("heading", { name: en ? "The full workload is not yet confirmed" : "待办信息尚未确认完整", exact: true }).waitFor();
      assert.equal(await page.getByText(en ? "No urgent items" : "没有紧急事项", { exact: true }).count(), 0);
      await shot(`action-partial-${locale}-${width}`, ["unknown differs from clear", "missing source", "bilingual responsive"]);
      await scenario("normal"); await cards(5); failed = true;
      await page.locator(".action-freshness button").click(); await page.locator(".inline-message.error").waitFor(); await cards(5);
      await page.getByText(en ? /previous snapshot is still shown/ : /当前仍显示上次读取的快照/).waitFor();
      failed = false; await page.locator(".action-freshness button").click();
      await page.getByText(en ? "No urgent items" : "没有紧急事项", { exact: true }).waitFor();
      assert.equal(await page.locator(".inline-message.error").count(), 0);
      await page.getByRole("heading", { name: en ? "This area is clear" : "当前分区已清空", exact: true }).waitFor();
      report.pages.push({ label: `action-recovery-${locale}-${width}`, status: "PASS", checks: ["failed refresh retains prior work", "stale warning", "successful retry clears error"] });
    }
    await page.setViewportSize({ width: 375, height: 1000 }); await nav("/dashboard");
    for (const role of ["OPERATIONS_SPECIALIST", "SALES_SPECIALIST", "ADMIN"]) {
      await scenario("dashboard", role); await page.locator(".focus-task").waitFor();
      assert.equal(await page.locator('a[href="/contracts"]').count() > 0, role !== "OPERATIONS_SPECIALIST");
      assert.equal(await page.locator('a[href="/notifications"]').count() > 0, role !== "OPERATIONS_SPECIALIST");
      const href = role === "ADMIN" ? "/admin/approvals" : "/approvals";
      assert.equal(await page.locator(`.metric-card[href="${href}"]`).count(), 1);
      assert.equal(await page.locator('.focus-task a[href="/tasks/00000000-0000-4000-8000-000000000001"]').count(), 1);
      assert.equal(await page.locator('.dashboard-task-links a[href="/tasks?queue=overdue"]').count(), 1);
      await shot(`dashboard-role-${role.toLowerCase()}`, ["permitted contracts/notifications", "personal or admin approval", "task context", "queue deep links"]);
    }
    await scenario("dashboard-unknown", "OPERATIONS_SPECIALIST");
    await page.getByText(/Approval counts are unavailable/).waitFor();
    assert.equal(await page.locator('.metric-card[href="/approvals"]').count(), 0);
    assert.equal(await page.locator('a[href="/approvals"]').count(), 1);
    report.pages.push({ label: "dashboard-unknown-approval", status: "PASS", checks: ["unknown approval count is not rendered as zero", "list recovery entry"] });
  } finally { await context.close(); }
};
