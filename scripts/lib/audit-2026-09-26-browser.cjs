/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

module.exports = async function auditInteractions({ page, context, identity, base, workspaceId, query }) {
  const headers = { origin: base, "x-csrf-token": identity.token.csrf_token };
  const taskId = randomUUID();
  const taskName = `Audit task ${taskId}`;
  const viewName = `Audit view ${randomUUID()}`;
  let viewId;
  try {
    await query(`insert into public.crm_tasks(id,workspace_id,title_zh,title_en,owner_id,created_by,due_at)
      values($1,$2,$3,$3,$4,$4,now()-interval '1 day')`, [taskId, workspaceId, taskName, identity.id]);
    await page.goto(`${base}/tasks`, { waitUntil: "networkidle" });
    const taskRow = page.locator(".task-work-row").filter({ hasText: taskName });
    await taskRow.getByRole("button").click();
    await taskRow.waitFor({ state: "hidden" });
    await page.waitForFunction(name => {
      const rows = [...document.querySelectorAll(".data-table tbody tr")];
      return rows.some(row => row.textContent.includes(name) && row.textContent.includes("已完成"));
    }, taskName);

    await page.getByRole("button", { name: "管理保存视图" }).click();
    const drawer = page.locator(".record-drawer");
    await drawer.locator('input[name="name"]').fill(viewName);
    await drawer.locator('select[name="visibility"]').selectOption("TEAM");
    const accepted = page.waitForResponse(response => response.url().endsWith("/api/views") && response.request().method() === "POST");
    await drawer.getByRole("button", { name: "保存当前视图" }).click();
    const response = await accepted;
    assert.equal(response.ok(), true, "Team view save failed");
    viewId = (await response.json()).item.id;
    await page.waitForFunction(() => document.querySelector('.saved-view-form input[name="name"]')?.value === "");
    assert.equal(await drawer.getByText(viewName, { exact: true }).count(), 1);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "管理保存视图" }).click();
    await drawer.getByText(viewName, { exact: true }).waitFor();

    await query(`insert into public.user_notifications(workspace_id,user_id,kind,title_key,body_key)
      select $1,$2,'AUDIT_QA','nav.notifications','notifications.description' from generate_series(1,11)`, [workspaceId, identity.id]);
    for (const body of ["{}", '{"ids":[]}', "{"]) {
      const rejected = await context.request.patch(`${base}/api/notifications`, { headers: { ...headers, "content-type": "application/json" }, data: body });
      assert.equal(rejected.status(), 400, "Invalid notification selection must be rejected");
    }
    const before = await context.request.get(`${base}/api/notifications`);
    assert.equal((await before.json()).total, 11, "Rejected requests changed unread notifications");
    await page.goto(`${base}/notifications`, { waitUntil: "networkidle" });
    const paging = page.locator(".pagination");
    await paging.getByRole("button").last().click();
    await page.waitForFunction(() => document.querySelectorAll(".notification-center>article").length === 1);
    await page.getByRole("button", { name: "标记已读" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".notification-center>article").length === 10);
    const after = await context.request.get(`${base}/api/notifications`);
    assert.equal((await after.json()).total, 10);
    process.stdout.write("[QA] pass task/table synchronization, saved-view persistence, notification rejection and last-page recovery\n");
  } finally {
    if (viewId) {
      const removed = await context.request.post(`${base}/api/views`, { headers, data: { operation: "delete", id: viewId } });
      assert.equal(removed.ok(), true, "QA view cleanup failed");
    }
    await query("delete from public.shared_views where owner_id=$1 and name=$2", [identity.id, viewName]);
    await query("delete from public.user_notifications where user_id=$1 and kind='AUDIT_QA'", [identity.id]);
    await query("delete from public.crm_tasks where id=$1 and owner_id=$2", [taskId, identity.id]);
  }
};
