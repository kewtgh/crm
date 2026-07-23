/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto");
const fs = require("node:fs");

const executable = process.env.PLAYWRIGHT_CHROMIUM_1228_PATH
  || "C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
const playwrightPath = process.env.PLAYWRIGHT_CORE_PATH
  || "playwright-core";
const { chromium } = require(playwrightPath);
const base = (process.env.AUTH_SMOKE_BASE_URL || "http://localhost:3210").replace(/\/$/, "");
const supabase = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mailpit = process.env.AUTH_SMOKE_MAILPIT_URL || "http://127.0.0.1:56324";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(response) {
  return response.json().catch(() => ({}));
}

async function latestEmailCode(email) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await json(await fetch(`${mailpit}/api/v1/messages`));
    const message = (list.messages || []).find((item) =>
      (item.To || item.to || []).some((recipient) =>
        String(recipient.Address || recipient.address || recipient).toLowerCase() === email.toLowerCase()
      )
    );
    if (message) {
      const id = message.ID || message.Id || message.id;
      const detail = await json(await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(id)}`));
      const source = [detail.Text, detail.HTML, detail.text, detail.html, detail.Subject].filter(Boolean).join(" ");
      const code = source.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Email verification code was not delivered to the local mailbox");
}

async function waitForTurnstile(page) {
  await page.waitForSelector(".turnstile-status.verified", { timeout: 25_000 });
}

async function submitLogin(page, username, password, remember) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator('input[name="identifier"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  if (remember) await page.locator('input[name="remember"]').check();
  await waitForTurnstile(page);
  const loginResponse = page.waitForResponse((response) =>
    response.url() === `${base}/api/auth/login` && response.request().method() === "POST"
  );
  await page.locator('button[type="submit"]').click();
  const response = await loginResponse;
  if (!response.ok()) {
    const result = await response.json().catch(() => ({}));
    throw new Error(`Application login failed (${response.status()}: ${result.code || "unknown"})`);
  }
}

(async () => {
  assert(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(base), "Auth smoke refuses a non-local application");
  assert(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(supabase), "Auth smoke refuses a non-local Supabase");
  assert(service, "SUPABASE_SERVICE_ROLE_KEY is required");
  assert(fs.existsSync(executable), "Pinned Chromium executable is missing");

  const suffix = Date.now().toString(36);
  const email = `device-${suffix}@example.invalid`;
  const username = `device.qa.${suffix}`;
  const temporaryPassword = `Tmp!${crypto.randomBytes(18).toString("base64url")}Aa1`;
  const permanentPassword = `New!${crypto.randomBytes(18).toString("base64url")}Aa1`;
  const adminHeaders = {
    apikey: service,
    authorization: `Bearer ${service}`,
    "content-type": "application/json",
  };
  let userId;
  let browser;
  try {
    const createdResponse = await fetch(`${supabase}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { username, chinese_name: "设备验收", english_name: "Device QA" },
        app_metadata: {
          role: "SALES_SPECIALIST",
          account_status: "ACTIVE",
          workspace_id: "00000000-0000-4000-8000-000000000001",
        },
      }),
    });
    const created = await json(createdResponse);
    assert(createdResponse.ok && created.id, `Could not create auth-smoke user (${createdResponse.status})`);
    userId = created.id;

    browser = await chromium.launch({ headless: true, executablePath: executable, args: ["--disable-gpu"] });
    const context = await browser.newContext();
    const page = await context.newPage();

    await submitLogin(page, username, temporaryPassword, true);
    await page.waitForURL("**/verify-device", { timeout: 15_000 });
    const code = await latestEmailCode(email);
    await page.locator('input[name="code"]').fill(code);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/change-password", { timeout: 15_000 });
    await page.locator('input[name="newPassword"]').fill(permanentPassword);
    await page.locator('input[name="confirmPassword"]').fill(permanentPassword);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    const firstCookies = await context.cookies(base);
    const trusted = firstCookies.find((cookie) => cookie.name === "crm_trusted_device");
    assert(trusted && trusted.httpOnly, "Verified device did not receive an HttpOnly trust cookie");

    await context.clearCookies();
    await context.addCookies([trusted]);
    await submitLogin(page, username, permanentPassword, false);
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
    assert(!page.url().includes("verify-device"), "Trusted device was asked for another email code");

    const sessionCookies = await context.cookies(base);
    for (const name of ["crm_access_token", "crm_refresh_token"]) {
      const cookie = sessionCookies.find((item) => item.name === name);
      assert(cookie && cookie.expires === -1, `${name} ignored the session-only sign-in choice`);
    }
    assert(!sessionCookies.some((cookie) => cookie.name === "crm_session_persistent"), "Session-only sign-in received a persistence marker");
    const refreshResult = await page.evaluate(async () => {
      const response = await fetch("/api/auth/refresh?mode=json", { headers: { accept: "application/json" } });
      return { status: response.status, cacheControl: response.headers.get("cache-control") };
    });
    assert(refreshResult.status === 200, "Session-only token rotation failed");
    assert(refreshResult.cacheControl === "no-store", "Auth refresh response can be cached");
    const rotatedCookies = await context.cookies(base);
    for (const name of ["crm_access_token", "crm_refresh_token"]) {
      const cookie = rotatedCookies.find((item) => item.name === name);
      assert(cookie && cookie.expires === -1, `${name} became persistent after token rotation`);
    }
    assert(!rotatedCookies.some((cookie) => cookie.name === "crm_session_persistent"), "Token rotation created a persistence marker");

    const devices = await page.evaluate(async () => {
      const response = await fetch("/api/settings/trusted-devices");
      return { status: response.status, cacheControl: response.headers.get("cache-control"), body: await response.json() };
    });
    assert(devices.status === 200, "Trusted-device settings API was unavailable");
    assert(devices.cacheControl === "no-store", "Private API response can be cached");
    assert(devices.body.devices?.some((device) => device.current), "Current trusted device was not listed");
    console.log("Auth device smoke passed: Turnstile, username/password, email OTP, password replacement, trusted-device reuse, session-only rotation, and private API cache policy.");
  } finally {
    if (browser) await browser.close();
    if (userId) {
      await fetch(`${supabase}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: adminHeaders });
    }
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
