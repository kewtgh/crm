import crypto from "node:crypto";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing v0.9 smoke variables: ${missing.join(", ")}`);

const base = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceId = process.env.CRM_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000001";
const suffix = Date.now().toString(36);
const email = `v09-${suffix}@example.invalid`;
const password = `V09!${crypto.randomBytes(18).toString("base64url")}aA1`;
const serviceHeaders = {
  apikey: service,
  authorization: `Bearer ${service}`,
  "content-type": "application/json",
};

let token = "";
let userId = "";
let organizationId = "";
let staleOrganizationId = "";
let contactId = "";
let mergedContactId = "";
let productId = "";
let bundleId = "";
let opportunityId = "";
let contractId = "";
let webhookId = "";
let draftTaskId = "";

async function request(path, {
  method = "GET",
  body,
  serviceRole = false,
  headers = {},
  expectFailure = false,
} = {}) {
  const userHeaders = {
    apikey: anon,
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(serviceRole ? serviceHeaders : userHeaders), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null);
  if (expectFailure) {
    if (response.ok) throw new Error(`${method} ${path} unexpectedly succeeded`);
    return { status: response.status, result };
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed (${response.status}: ${
        result?.message ?? result?.msg ?? result?.error_description ?? result?.code ?? "unknown"
      })`,
    );
  }
  return result;
}

async function rpc(name, body, options = {}) {
  return request(`/rest/v1/rpc/${name}`, { method: "POST", body, ...options });
}

try {
  const signup = await request("/auth/v1/signup", {
    method: "POST",
    body: {
      email: `forbidden-${suffix}@example.invalid`,
      password,
    },
    expectFailure: true,
  });
  if (![400, 422].includes(signup.status)) throw new Error("Public signup was not rejected");

  const created = await request("/auth/v1/admin/users", {
    method: "POST",
    serviceRole: true,
    body: {
      email,
      password,
      email_confirm: true,
      app_metadata: { role: "SALES_DIRECTOR", account_status: "ACTIVE" },
      user_metadata: {
        username: `v09.${suffix}`,
        display_name_zh: "版本测试",
        display_name_en: "Version Nine Test",
      },
    },
  });
  userId = created.id;
  const signed = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  token = signed.access_token;

  const organizations = await request("/rest/v1/organizations?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      name_zh: `版本测试机构${suffix}`,
      name_en: `Version Nine Organization ${suffix}`,
      city: "Taipei",
      status: "UNVERIFIED",
      owner_id: userId,
    },
  });
  organizationId = organizations[0].id;
  const staleOrganizations = await request("/rest/v1/organizations?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      name_zh: `待跟进机构${suffix}`,
      name_en: `Stale Organization ${suffix}`,
      city: "Taipei",
      status: "ATTENTION",
      owner_id: userId,
    },
  });
  staleOrganizationId = staleOrganizations[0].id;

  const contacts = await request("/rest/v1/contacts?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: [
      {
        organization_id: organizationId,
        name_zh: "主联系人",
        name_en: "Primary Contact",
        email: `primary-${suffix}@example.invalid`,
        phone: null,
        status: "UNVERIFIED",
        owner_id: userId,
      },
      {
        organization_id: organizationId,
        name_zh: "重复联系人",
        name_en: "Duplicate Contact",
        email: null,
        phone: `+8869${suffix.slice(-7).padStart(7, "0")}`,
        status: "UNVERIFIED",
        owner_id: userId,
      },
    ],
  });
  contactId = contacts[0].id;
  mergedContactId = contacts[1].id;

  const permission = await rpc("explain_record_access", {
    resource_type: "ORGANIZATION",
    resource_id: organizationId,
    requested_action: "EDIT",
  });
  if (permission.allowed !== true || permission.reason !== "ROLE_SCOPE") {
    throw new Error("Permission explainer did not return the database decision");
  }

  const product = await rpc("create_product_with_price", {
    product_code: `V09-${suffix}`,
    product_name_zh: "版本测试产品",
    product_name_en: "Version Nine Product",
    product_billing: "PROJECT",
    product_duration_zh: "一个项目周期",
    product_duration_en: "One project cycle",
    price_currency: "CNY",
    price_amount: 120000,
  });
  productId = product.id;
  const bundle = await rpc("create_product_bundle", {
    bundle_code: `B-${suffix}`,
    bundle_name_zh: "版本测试产品包",
    bundle_name_en: "Version Nine Bundle",
    bundle_items: [{
      productId,
      quantity: 1,
      optional: false,
      discountCeiling: 10,
    }],
  });
  bundleId = bundle.id;

  const opportunities = await request("/rest/v1/opportunities?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      organization_id: organizationId,
      product_id: productId,
      title_zh: "版本测试商机",
      title_en: "Version Nine Opportunity",
      stage: "DISCOVERY",
      amount: 120000,
      currency: "CNY",
      probability: 30,
      expected_close_date: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
      next_action_zh: "安排方案会议",
      next_action_en: "Schedule solution meeting",
      owner_id: userId,
    },
  });
  opportunityId = opportunities[0].id;
  const invalidStage = await rpc("change_opportunity_stage", {
    target_opportunity: opportunityId,
    next_stage: "EVALUATION",
    next_probability: 50,
    next_expected_close: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    next_action_zh: "",
    next_action_en: "",
    stage_reason: "",
    stage_evidence: "",
  }, { expectFailure: true });
  if (invalidStage.status < 400 || invalidStage.status >= 500) {
    throw new Error("Opportunity guard did not return a business-rule rejection");
  }
  const opportunity = await rpc("change_opportunity_stage", {
    target_opportunity: opportunityId,
    next_stage: "EVALUATION",
    next_probability: 50,
    next_expected_close: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    next_action_zh: "完成方案评审",
    next_action_en: "Complete solution review",
    stage_reason: "Qualified need",
    stage_evidence: "Discovery notes recorded",
  });
  if (opportunity.stage !== "EVALUATION") throw new Error("Opportunity stage did not update");

  const activity = await rpc("record_customer_activity", {
    target_organization: organizationId,
    target_contact: contactId,
    target_opportunity: opportunityId,
    activity_kind: "MEETING",
    occurred: new Date().toISOString(),
    summary_zh: "完成需求确认会议",
    summary_en: "Completed the discovery meeting",
    next_step_zh: "完成方案评审",
    next_step_en: "Complete the solution review",
  });
  if (activity.activity_type !== "MEETING") throw new Error("Customer activity was not recorded");

  const contract = await rpc("create_contract_draft", {
    contract_no: `V09-CTR-${suffix}`,
    target_organization: organizationId,
    target_product: productId,
    period_start: new Date().toISOString().slice(0, 10),
    period_end: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    contract_currency: "CNY",
    contract_amount: 120000,
    relationship: 2,
  });
  contractId = contract.id;
  const playbook = await rpc("save_renewal_playbook", {
    target_contract: contractId,
    playbook_stage: "DISCOVERY",
    risk: "MEDIUM",
    action_zh: "确认续约预算",
    action_en: "Confirm renewal budget",
    action_due: new Date(Date.now() + 7 * 86400000).toISOString(),
    outcome: "",
  });
  if (playbook.stage !== "DISCOVERY") throw new Error("Renewal playbook was not saved");

  const preview = await rpc("duplicate_merge_preview", {
    resource: "CONTACTS",
    target_record: contactId,
    source_record: mergedContactId,
  });
  if (preview.requiresConfirmation !== true) throw new Error("Duplicate preview omitted confirmation");
  const merged = await rpc("merge_duplicate_records", {
    resource: "CONTACTS",
    target_record: contactId,
    source_record: mergedContactId,
    field_choices: { phone: "SOURCE" },
  });
  if (merged !== contactId) throw new Error("Duplicate merge returned the wrong master");
  const removed = await request(`/rest/v1/contacts?select=id&id=eq.${mergedContactId}`);
  if (removed.length !== 0) throw new Error("Duplicate source record still exists");
  mergedContactId = "";

  const generated = await rpc("generate_next_best_actions", {
    target_organization: staleOrganizationId,
  });
  if (Number(generated) < 1) throw new Error("Rules engine did not generate a stale-relationship action");
  const actions = await request(
    `/rest/v1/next_best_actions?select=id,status&organization_id=eq.${staleOrganizationId}&status=eq.SUGGESTED`,
  );
  if (!actions[0]) throw new Error("Generated next action is not visible");
  const decided = await rpc("decide_next_best_action", {
    target_action: actions[0].id,
    decision: "ACCEPTED",
    reason: "",
  });
  draftTaskId = decided.draft_task_id;
  if (!draftTaskId) throw new Error("Accepted next action did not create a task draft");

  const heartbeat = await rpc("record_worker_heartbeat", {
    worker: "WEBHOOK_INBOX",
    successful: true,
    failure: null,
    details: { smoke: "v0.9.0" },
  }, { serviceRole: true });
  if (heartbeat.worker_key !== "WEBHOOK_INBOX") throw new Error("Worker heartbeat was not recorded");

  const integrations = await request(
    `/rest/v1/integration_connections?select=provider,status&workspace_id=eq.${workspaceId}`,
  );
  if (integrations.length !== 5 || integrations.some((item) => item.status !== "DISCONNECTED")) {
    throw new Error("Integration center does not expose five honest disconnected states");
  }

  const insertedWebhook = await request("/rest/v1/webhook_inbox?select=id", {
    method: "POST",
    serviceRole: true,
    headers: { Prefer: "return=representation" },
    body: {
      workspace_id: workspaceId,
      provider: "EMAIL",
      event_id: `smoke-${suffix}`,
      event_type: "delivery.smoke",
      payload: { smoke: true },
      signature_digest: crypto.createHash("sha256").update(suffix).digest("hex"),
    },
  });
  webhookId = insertedWebhook[0].id;
  const claimed = await rpc("claim_webhook_events", { batch_size: 100 }, { serviceRole: true });
  if (!claimed.some((item) => item.id === webhookId)) throw new Error("Webhook inbox event was not claimed");
  await rpc("complete_webhook_event", { target_event: webhookId }, { serviceRole: true });
  const completed = await request(
    `/rest/v1/webhook_inbox?select=status&id=eq.${webhookId}`,
    { serviceRole: true },
  );
  if (completed[0]?.status !== "PROCESSED") throw new Error("Webhook event was not completed");

  process.stdout.write(
    "v0.9.0 business smoke passed: signup boundary, permissions, activity, stage guard, renewal, merge, bundle, rules, heartbeat, integrations, and webhook inbox.\n",
  );
} finally {
  if (webhookId) {
    await request(`/rest/v1/webhook_inbox?id=eq.${webhookId}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
  if (draftTaskId) {
    await request(`/rest/v1/crm_tasks?id=eq.${draftTaskId}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
  if (contractId) {
    await request(`/rest/v1/reminders?source_id=eq.${contractId}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
    await request(`/rest/v1/contracts?id=eq.${contractId}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
  if (opportunityId) {
    await request(`/rest/v1/opportunities?id=eq.${opportunityId}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
  if (bundleId) {
    await request(`/rest/v1/product_bundles?id=eq.${bundleId}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
  if (productId) {
    await request(`/rest/v1/products?id=eq.${productId}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
  for (const id of [mergedContactId, contactId].filter(Boolean)) {
    await request(`/rest/v1/contacts?id=eq.${id}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
  for (const id of [staleOrganizationId, organizationId].filter(Boolean)) {
    await request(`/rest/v1/organizations?id=eq.${id}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
  if (userId) {
    await request(`/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      serviceRole: true,
    }).catch(() => undefined);
  }
}
