/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const pg = require("pg");
const argon2 = require("argon2");

const executable = process.env.PLAYWRIGHT_CHROMIUM_1228_PATH
  || "C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const base = (process.env.AUTH_SMOKE_BASE_URL || process.env.APP_URL || "http://localhost:3200").replace(/\/$/, "");
const databaseUrl = process.env.SYSTEM_DATABASE_URL;
const deliveryUrl = new URL(process.env.EMAIL_DELIVERY_WEBHOOK_URL || "http://127.0.0.1:3999/delivery");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startDeliveryCapture() {
  assert(["127.0.0.1", "localhost"].includes(deliveryUrl.hostname), "Auth smoke requires a loopback delivery webhook");
  const deliveries = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try { deliveries.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch {}
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: crypto.randomUUID() }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(deliveryUrl.port || 80), deliveryUrl.hostname, () => resolve({
      server,
      async deviceCode(email) {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const delivery = deliveries.find((item) =>
            item.to?.toLowerCase() === email.toLowerCase()
            && item.template === "device-verification"
            && /^\d{6}$/.test(item.payload?.code));
          if (delivery) return delivery.payload.code;
          await new Promise((wait) => setTimeout(wait, 250));
        }
        throw new Error("Device verification code was not delivered");
      },
    }));
  });
}

async function submitLogin(page, username, password, remember) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator('input[name="identifier"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  if (remember) await page.locator('input[name="remember"]').check();
  await page.waitForSelector(".turnstile-status.verified", { timeout: 25_000 });
  const loginResponse = page.waitForResponse((response) =>
    response.url() === `${base}/api/auth/login` && response.request().method() === "POST");
  await page.locator('button[type="submit"]').click();
  const response = await loginResponse;
  if (!response.ok()) {
    const result = await response.json().catch(() => ({}));
    throw new Error(`Application login failed (${response.status()}: ${result.code || "unknown"})`);
  }
}

(async () => {
  assert(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(base), "Auth smoke refuses a non-local application");
  assert(databaseUrl, "SYSTEM_DATABASE_URL is required");
  assert(fs.existsSync(executable), "Pinned Chromium executable is missing");
  const capture = await startDeliveryCapture();
  const suffix = Date.now().toString(36);
  const id = crypto.randomUUID();
  const email = `device-${suffix}@example.invalid`;
  const username = `device.qa.${suffix}`;
  const initialPassword = `Tmp!${crypto.randomBytes(18).toString("base64url")}Aa1`;
  const changedPassword = `Changed!${crypto.randomBytes(18).toString("base64url")}Aa1`;
  const passwordHash = await argon2.hash(initialPassword, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let browser;
  try {
    await client.query("begin");
    await client.query(
      `insert into app_auth.accounts(id,email,username,status,email_confirmed_at,must_change_password)
       values($1,$2,$3,'ACTIVE',now(),false)`,
      [id, email, username],
    );
    await client.query(
      `insert into app_auth.password_credentials(user_id,password_hash,parameters)
       values($1,$2,$3)`,
      [id, passwordHash, { algorithm: "argon2id", memoryCost: 65_536, timeCost: 3, parallelism: 1 }],
    );
    await client.query(
      `insert into public.user_profiles(user_id,username,display_name_zh,display_name_en)
       values($1,$2,'设备验收','Device QA')`,
      [id, username],
    );
    await client.query(
      `insert into public.workspace_memberships(workspace_id,user_id,role,status,must_change_password)
       values($1,$2,'SALES_SPECIALIST','ACTIVE',false)`,
      [process.env.CRM_WORKSPACE_ID, id],
    );
    await client.query(
      `insert into public.sales_team_members(
        workspace_id,auth_user_id,name_zh,name_en,role,team,active
       ) values($1,$2,'设备验收','Device QA','SALES_SPECIALIST','QA',true)`,
      [process.env.CRM_WORKSPACE_ID, id],
    );
    await client.query("commit");

    browser = await chromium.launch({ headless: true, executablePath: executable, args: ["--disable-gpu"] });
    const context = await browser.newContext();
    const page = await context.newPage();
    await submitLogin(page, username, initialPassword, true);
    await page.waitForURL("**/verify-device", { timeout: 15_000 });
    const code = await capture.deviceCode(email);
    await page.locator('input[name="code"]').fill(code);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const firstCookies = await context.cookies(base);
    const trusted = firstCookies.find((cookie) => cookie.name === "crm_trusted_device");
    const session = firstCookies.find((cookie) => cookie.name === "crm_session");
    const csrf = firstCookies.find((cookie) => cookie.name === "crm_csrf");
    const persistence = firstCookies.find((cookie) => cookie.name === "crm_session_persistent");
    const minimumExpiry = Date.now() / 1000 + 29 * 24 * 60 * 60;
    assert(trusted?.httpOnly, "Verified device did not receive an HttpOnly trust cookie");
    assert(session?.httpOnly && session.expires > minimumExpiry, "Persistent server session cookie is invalid");
    assert(csrf && !csrf.httpOnly && csrf.expires > minimumExpiry, "CSRF cookie is invalid");
    assert(persistence?.httpOnly && persistence.expires > minimumExpiry, "Persistence marker is invalid");

    await context.clearCookies();
    await context.addCookies([trusted]);
    await submitLogin(page, username, initialPassword, true);
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
    const beforeRotation = (await context.cookies(base)).find((cookie) => cookie.name === "crm_session")?.value;
    const refresh = await page.evaluate(async () => {
      const response = await fetch("/api/auth/refresh?mode=json", { headers: { accept: "application/json" } });
      return { status: response.status, cacheControl: response.headers.get("cache-control") };
    });
    assert(refresh.status === 200 && refresh.cacheControl === "no-store", "Session rotation endpoint failed");
    const rotated = await context.cookies(base);
    assert(rotated.find((cookie) => cookie.name === "crm_session")?.value !== beforeRotation, "Session token was not rotated");
    assert(rotated.find((cookie) => cookie.name === "crm_session")?.expires > minimumExpiry, "Rotation shortened the persistent session");

    const devices = await page.evaluate(async () => {
      const response = await fetch("/api/settings/trusted-devices");
      return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() };
    });
    assert(devices.status === 200 && devices.cacheControl === "no-store", "Trusted-device settings response is invalid");
    assert(devices.body.devices?.some((device) => device.current), "Current trusted device was not listed");

    const passwordChange = await page.evaluate(async ({ currentPassword, newPassword }) => {
      const csrfToken = document.cookie.match(/(?:^|; )crm_csrf=([^;]+)/)?.[1] || "";
      const response = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrfToken) },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      return { status: response.status, body: await response.json() };
    }, { currentPassword: initialPassword, newPassword: changedPassword });
    assert(passwordChange.status === 200, `Password change failed (${passwordChange.status})`);
    assert(passwordChange.body.sessionsRevoked && passwordChange.body.trustedDevicesRevoked, "Password change did not revoke authentication state");
    const remainingCookies = await context.cookies(base);
    for (const name of ["crm_session", "crm_csrf", "crm_session_persistent", "crm_trusted_device"]) {
      assert(!remainingCookies.some((cookie) => cookie.name === name), `Password change retained ${name}`);
    }
    const verification = await client.query(
      `select
        credential.password_hash,
        (select count(*) from app_auth.sessions where user_id=$1 and revoked_at is null) as sessions,
        (select count(*) from public.trusted_login_devices where user_id=$1 and revoked_at is null) as devices
       from app_auth.password_credentials credential where credential.user_id=$1`,
      [id],
    );
    assert(await argon2.verify(verification.rows[0].password_hash, changedPassword), "Changed Argon2id password was not stored");
    assert(Number(verification.rows[0].sessions) === 0, "Active sessions remained after password change");
    assert(Number(verification.rows[0].devices) === 0, "Trusted devices remained after password change");
    process.stdout.write(
      "Auth device smoke passed: login, email verification, trusted device, 30-day session rotation, CSRF, and global revocation.\n",
    );
  } finally {
    if (browser) await browser.close();
    await client.query("delete from public.audit_events where actor_id=$1", [id]).catch(() => undefined);
    await client.query("delete from app_auth.accounts where id=$1", [id]).catch(() => undefined);
    await client.end();
    await new Promise((resolve) => capture.server.close(resolve));
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
