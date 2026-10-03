import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { emailHistoryFilters } from "../lib/customer-email-history.ts";
import { loadCustomerEmailHistory } from "../lib/customer-email-history-repository.ts";

test("bulk history validates classifications and bounded pagination", () => {
  assert.deepEqual(emailHistoryFilters.parse({}), { q: "", purpose: "", status: "", page: 1, pageSize: 20 });
  assert.equal(emailHistoryFilters.parse({ q: " 客户 ", page: "2", pageSize: "50", purpose: "MARKETING", status: "SENT" }).q, "客户");
  for (const input of [{ purpose: "INVALID" }, { status: "RECEIVED" }, { page: 0 }, { pageSize: 100 }, { q: "x".repeat(161) }]) assert.equal(emailHistoryFilters.safeParse(input).success, false);
});
test("combined history filters are forwarded to a paginated server query", async () => {
  const response = { items: [], total: 0, page: 3, pageSize: 10 };
  const read = async (path, init) => {
    assert.equal(path, "/db/rpc/customer_email_history_page");
    assert.deepEqual(JSON.parse(init.body), { search_term: "a_%", message_purpose: "SERVICE", delivery_state: "FAILED", page_number: 3, requested_page_size: 10 });
    return response;
  };
  assert.equal(await loadCustomerEmailHistory({ q: "a_%", purpose: "SERVICE", status: "FAILED", page: 3, pageSize: 10 }, read), response);
});
test("history reads preserve capabilities and existing bulk message identity", async () => {
  const source = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const [api, sql, page] = await Promise.all([source("app/api/customer-email/history/route.ts"), source("db/migrations/202610030090_customer_email_history.sql"), source("app/(crm)/messages/page.tsx")]);
  assert.match(api, /requireApiCapability\("messages.view"\)/);
  assert.match(api, /private, no-store/);
  assert.match(page, /tab==="bulk".*requireCapability\("messages.view"\)/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /t.workspace_id=public.current_workspace_id\(\)/);
  assert.match(sql, /m.idempotency_key=t.creation_request_key/);
  assert.match(sql, /starts_with\(t.creation_request_key,'customer-email:'\)/);
  assert.doesNotMatch(sql, /insert into|update public|delete from/i);
});
