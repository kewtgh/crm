/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const executable = process.env.PLAYWRIGHT_CHROMIUM_1228_PATH
  || "C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
const base = (process.env.QA_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
const output = path.resolve(
  process.env.QA_OUTPUT_DIR || "work/browser-qa-chromium-1228/captcha-fallback",
);
fs.mkdirSync(output, { recursive: true });

async function runScenario(browser, name, intercept, timing) {
  const context = await browser.newContext({ locale: "zh-CN" });
  await context.route("https://challenges.cloudflare.com/**", intercept);
  const page = await context.newPage();
  const sameOriginCaptchaRequests = [];
  const localAltchaAssets = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/captcha/")) sameOriginCaptchaRequests.push(url);
    if (url.startsWith(base) && /altcha/i.test(url)) localAltchaAssets.push(url);
  });
  const localChallengeRequest = page.waitForRequest(
    (request) => request.url().includes("/api/captcha/challenge"),
    { timeout: 12_000 },
  );
  const startedAt = Date.now();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator('[data-captcha-provider="altcha"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("altcha-widget").waitFor({ state: "attached", timeout: 5_000 });
  await localChallengeRequest;
  const elapsedMs = Date.now() - startedAt;
  const notice = await page.locator(".captcha-fallback-notice").innerText();
  assert.match(notice, /已自动切换到本地验证/);
  assert.ok(elapsedMs >= timing.minimumMs, `${name} switched too early (${elapsedMs}ms)`);
  assert.ok(elapsedMs <= timing.maximumMs, `${name} switched too late (${elapsedMs}ms)`);
  assert.ok(localAltchaAssets.length > 0, `${name} did not load an ALTCHA asset from the app origin`);
  assert.ok(sameOriginCaptchaRequests.length > 0, `${name} did not request a local challenge`);
  assert.ok(
    sameOriginCaptchaRequests.every((url) => url.startsWith(base)),
    `${name} emitted a cross-origin CAPTCHA API request`,
  );
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  await context.close();
  return {
    name,
    elapsedMs,
    notice,
    localAltchaAssets,
    sameOriginCaptchaRequests,
  };
}

async function main() {
  assert.ok(fs.existsSync(executable), `Pinned Chromium 1228 is missing: ${executable}`);
  const browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: ["--disable-gpu"],
  });
  try {
    const scenarios = [];
    scenarios.push(await runScenario(
      browser,
      "script-load-failure",
      (route) => route.abort("failed"),
      { minimumMs: 0, maximumMs: 5_000 },
    ));
    scenarios.push(await runScenario(
      browser,
      "load-timeout",
      (route) => route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "/* intentionally no window.turnstile: timeout regression */",
      }),
      { minimumMs: 6_500, maximumMs: 9_000 },
    ));
    const report = {
      runAt: new Date().toISOString(),
      browser: "ms-playwright/chromium-1228",
      executable,
      browserVersion: browser.version(),
      baseUrl: base,
      scenarios,
    };
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(
      `CAPTCHA fallback QA passed ${scenarios.length} scenarios with Chromium ${report.browserVersion}.\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
