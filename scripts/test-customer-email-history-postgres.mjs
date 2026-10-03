import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname)) throw new Error("This rollback-only check requires a local MIGRATION_DATABASE_URL");
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout='5s'; set local lock_timeout='3s'");
  await client.query(await readFile(new URL("../db/migrations/202610030090_customer_email_history.sql", import.meta.url), "utf8"));
  const actor = randomUUID(), foreignActor = randomUUID(), workspace = randomUUID(), foreignWorkspace = randomUUID();
  await client.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)", [actor, `${actor}@example.test`, `qa_${actor.replaceAll("-", "")}`]);
  for (const ws of [workspace, foreignWorkspace]) {
    await client.query("insert into public.workspaces(id,slug,name) values($1,$2,'Bulk history QA')", [ws, `qa-${ws}`]);
    await client.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,'ADMIN','ACTIVE')", [ws, actor]);
  }
  await client.query("insert into app_auth.accounts(id,email,username) values($1,$2,$3)", [foreignActor, `${foreignActor}@example.test`, `qa_${foreignActor.replaceAll("-", "")}`]);
  await client.query("insert into public.workspace_memberships(workspace_id,user_id,role,status) values($1,$2,'ADMIN','ACTIVE')", [foreignWorkspace, foreignActor]);
  await client.query("select set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true),set_config('app.role','ADMIN',true),set_config('app.aal','aal2',true)", [actor, workspace]);
  const add = async ({ ws = workspace, key = `customer-email:${randomUUID()}`, subject = "服务跟进", purpose = "SERVICE", status = "SENT", direction = "OUTBOUND", body = "正文资料", messageKey = key }) => {
    const contact = randomUUID(), thread = randomUUID();
    await client.query("insert into public.contacts(id,workspace_id,name_zh,name_en,email,owner_id,created_by) values($1,$2,'客户','Customer',$4,$3,$3)", [contact, ws, actor, `qa+${contact}@example.test`]);
    await client.query("insert into public.communication_threads(id,workspace_id,contact_id,subject,channel,purpose,created_by,assigned_to,creation_request_key,creation_request_fingerprint) values($1,$2,$3,$4,'EMAIL',$5,$6,$6,$7,$8)", [thread, ws, contact, subject, purpose, actor, key, "a".repeat(64)]);
    await client.query("insert into public.communication_messages(workspace_id,thread_id,direction,body,delivery_status,sent_by,idempotency_key,provider_message_id) values($1,$2,$3,$4,$5,$6,$7,'qa-receipt')", [ws, thread, direction, body, status, actor, messageKey]);
  };
  await add({ subject: "课程 100%_资料", purpose: "MARKETING" });
  await add({ status: "FAILED" });
  await add({ ws: foreignWorkspace });
  await add({ key: `individual:${randomUUID()}` });
  await add({ messageKey: `reply:${randomUUID()}` });
  await add({ direction: "INBOUND", status: "RECEIVED" });
  // The configured migration role cannot SET ROLE crm_app; this transaction
  // verifies query semantics and explicit workspace/authentication boundaries.
  const history = async (q = "", purpose = "", status = "", page = 1, pageSize = 20) => (await client.query("select public.customer_email_history_page($1,$2,$3,$4,$5) result", [q, purpose, status, page, pageSize])).rows[0].result;
  assert.equal((await history()).total, 2);
  assert.equal((await history("%_", "MARKETING", "SENT")).total, 1);
  assert.equal((await history("正文", "SERVICE", "FAILED")).total, 1);
  assert.equal((await history("@example.test")).total, 2);
  assert.equal((await history("missing")).total, 0);
  assert.equal((await history("", "MARKETING", "FAILED")).total, 0);
  assert.equal((await history("", "", "", 999)).page, 1);
  await client.query("select set_config('app.workspace_id',$1,true),set_config('app.user_id',$2,true)", [foreignWorkspace, foreignActor]);
  assert.equal((await history()).total, 1);
  await client.query("select set_config('app.user_id','',true)");
  assert.equal((await history()).total, 0);
  process.stdout.write("Bulk history PostgreSQL checks passed: historical identity, literal keyword/body/email search, combined filters, pagination and workspace isolation.\n");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
