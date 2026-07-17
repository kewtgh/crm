import crypto from "node:crypto";

const required = [
  "APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing v1.1 smoke variables: ${missing.join(", ")}`);

const app = process.env.APP_URL.replace(/\/$/, "");
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const suffix = Date.now().toString(36);
const email = `v11-${suffix}@example.invalid`;
const password = `V11!${crypto.randomBytes(18).toString("base64url")}aA1`;
const serviceHeaders = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
};
const createdUserResponse = await fetch(`${supabase}/auth/v1/admin/users`, {
  method: "POST",
  headers: serviceHeaders,
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: `v11.${suffix}`, chinese_name: "版本验收", english_name: "Release Smoke" },
    app_metadata: { role: "SALES_MANAGER", account_status: "ACTIVE" },
  }),
  signal: AbortSignal.timeout(10_000),
});
const createdUser = await createdUserResponse.json();
if (!createdUserResponse.ok || !createdUser.id) throw new Error("Unable to create the isolated v1.1 smoke user");

const authResponse = await fetch(`${supabase}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "content-type": "application/json",
  },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(10_000),
});
const auth = await authResponse.json();
if (!authResponse.ok || !auth.access_token) throw new Error("Local administrator authentication failed");

const cookie = `crm_access_token=${auth.access_token}; crm_refresh_token=${auth.refresh_token}`;
const originHeaders = { cookie, origin: app, "content-type": "application/json" };

async function appRequest(path, options = {}) {
  const response = await fetch(`${app}${path}`, {
    ...options,
    headers: { cookie, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

try {
  const invalidSchool = await appRequest("/api/crm/schools", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({
      operation: "create",
      nameZh: `版本验收学校${suffix}`,
      nameEn: `Release School ${suffix}`,
      curriculum: "Bilingual",
      email: "",
      phone: "",
      contact: "",
    }),
  });
  if (invalidSchool.response.status !== 400 || invalidSchool.body?.error?.code !== "INVALID_INPUT") {
    throw new Error("Resource-specific school validation did not reject a missing city");
  }

  const schools = await appRequest("/api/crm/schools?page=1&pageSize=10");
  if (!schools.response.ok || typeof schools.body?.metrics?.total !== "number" || schools.body.metrics.total !== schools.body.total) {
    throw new Error("CRM exact metrics do not match the unfiltered resource total");
  }

  const missingEvidence = await appRequest(`/api/opportunities/${crypto.randomUUID()}`, {
    method: "PATCH",
    headers: originHeaders,
    body: JSON.stringify({ stage: "WON", probability: 100 }),
  });
  if (missingEvidence.response.status !== 400 || missingEvidence.body?.error?.code !== "WON_EVIDENCE_REQUIRED") {
    throw new Error("Won transition did not reject missing evidence");
  }

  for (const path of [
    "/api/opportunities?page=1&pageSize=10",
    "/api/finance?page=1&pageSize=10&contractPage=1&receivablePage=1&paymentPage=1&refundPage=1&reconciliationPage=1",
    "/api/data-quality?page=1&pageSize=10",
    "/api/products",
    "/api/contracts?page=1&pageSize=5&status=all&query=",
  ]) {
    const result = await appRequest(path);
    if (!result.response.ok) throw new Error(`${path} failed (${result.response.status}: ${result.body?.error?.code ?? result.body?.code ?? "unknown"} / ${result.body?.error?.message ?? result.body?.message ?? "unknown"})`);
  }
  process.stdout.write("v1.1.0 remediation smoke passed: resource validation, exact metrics, stage evidence guard, funnel, finance risk queries, and data quality.\n");
} finally {
  await fetch(`${supabase}/auth/v1/admin/users/${createdUser.id}`, {
    method: "DELETE",
    headers: serviceHeaders,
    signal: AbortSignal.timeout(10_000),
  });
}
