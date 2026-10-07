/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { build } = require('esbuild');
module.exports = async ({ browser, base, output, report, observe }) => {
  const context = await browser.newContext({ locale: 'zh-CN', bypassCSP: true });
  try {
    const page = await context.newPage(); observe(page); page.setDefaultTimeout(5000);
    const health = await page.goto(`${base}/api/health`); assert.ok(health?.ok()); assert.equal((await health.json()).version, report.evidence.appVersion);
    require('tsx/cjs'); const { executiveFixture, trendsFixture, supportFixture } = require('../tests/fixtures/management-experience.ts');
    const requests = [], expectedFailures = []; let scenario = 'normal';
    await page.route(`${base}/api/**`, route => {
      const url = new URL(route.request().url()), p = url.searchParams;
      if (url.pathname.startsWith('/api/management/') || url.pathname === '/api/student-success/analytics') {
        requests.push({ path: url.pathname, ...Object.fromEntries(p) });
        if (scenario === 'trends-failed' && url.pathname === '/api/management/trends' || scenario === 'overview-failed' && url.pathname === '/api/management/overview') {
          expectedFailures.push(route.request().url()); return route.fulfill({ status: 503, json: { error: { code: 'SYNTHETIC_UNAVAILABLE' } } });
        }
        const data = url.pathname === '/api/management/overview' ? executiveFixture() : url.pathname === '/api/management/trends' ? trendsFixture() : supportFixture();
        if ('period' in data) { data.period.from = p.get('from') || data.period.from; data.period.to = p.get('to') || data.period.to; }
        if ('modules' in data) for (const section of Object.values(data.modules)) for (const metric of section.metrics) if (metric.period) metric.period = data.period;
        if (scenario === 'restricted') {
          data.permissions.finance = false; data.permissions.commissionMoney = false;
          if (data.modules) { data.modules.finance.available = false; data.modules.finance.metrics = []; for (const section of Object.values(data.modules)) section.metrics = section.metrics.filter(m => !m.key.startsWith('commission')); }
          if (data.series) data.series = data.series.filter(s => s.module !== 'finance' && !s.key.startsWith('commission'));
        }
        if (scenario === 'module-unavailable' && data.modules) data.modules.delivery.available = false;
        if (scenario === 'malformed-support' && url.pathname === '/api/student-success/analytics') delete data.snapshot.activeCases;
        if (scenario === 'support-restricted' && url.pathname === '/api/student-success/analytics') data.permissions.canRead = false;
        if (scenario === 'zero-support' && url.pathname === '/api/student-success/analytics') { for (const key of Object.keys(data.snapshot)) if (typeof data.snapshot[key] === 'number') data.snapshot[key] = 0; data.snapshot.goalAttainment = { achieved: 0, evaluated: 0, rate: null }; }
        return route.fulfill({ json: data });
      }
      if (url.pathname === '/api/search/related') { const type = p.get('types'); return route.fulfill({ json: { items: [{ value: `${type}:00000000-0000-4000-8000-000000000010`, labelZh: '示例学习项目', labelEn: 'Example Learning Program' }] } }); }
      if (url.pathname === '/api/enrollments') return route.fulfill({ json: { items: [{ value: '00000000-0000-4000-8000-000000000011', labelZh: '示例秋季批次', labelEn: 'Example Autumn Cohort' }] } });
      if (url.pathname === '/api/notifications') return route.fulfill({ json: { items: [], total: 0, unread: 0, page: 1, pageSize: 20 } });
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    });
    const bundle = await build({ entryPoints: ['tests/fixtures/management-experience-qa.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', target: 'chrome145', alias: { 'next/navigation': path.resolve('tests/fixtures/ux-foundation-navigation.ts'), 'next/link': path.resolve('tests/fixtures/ux-foundation-link.tsx'), 'next/image': path.resolve('tests/fixtures/ux-foundation-image.tsx') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
    await page.setContent('<html lang="zh-CN"><head><title>Management experience synthetic QA</title></head><body><div id="root"></div></body></html>');
    for (const file of fs.readdirSync('dist/client/_next/static', { recursive: true }).filter(file => file.endsWith('.css'))) await page.addStyleTag({ url: `${base}/_next/static/${file.replaceAll('\\', '/')}` });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const nav = href => page.evaluate(href => window.managementNavigate(href), href);
    const reload = () => page.evaluate(() => window.managementReload());
    const waitExecutive = () => page.locator('[data-testid=executive-kpis] [data-metric=openOpportunities] strong').waitFor();
    const waitSupport = () => page.locator('[data-testid=support-health] [data-metric=activeCases] strong').waitFor();
    const shot = async (label, viewport, checks, fullPage = false) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label}: no page overflow`);
      const text = await page.locator('main').innerText(); assert.doesNotMatch(text, /undefined|null|\[object Object\]|(?:management|successAnalytics|ux\.management)\.[a-zA-Z]+\./);
      await page.screenshot({ path: path.join(output, `${label}.png`), fullPage });
      report.pages.push({ label, viewport, fullPage, checks, boundary: 'Actual AppShell/page components + production CSS; fictional mocked APIs and QA routing transport. No real DB/RLS claim.' });
      process.stdout.write(`[QA management-experience] ${label} passed\n`);
    };
    if(process.env.QA_CORE_ONLY==='1'){
      for(const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:375,height:812}]){
        await page.setViewportSize(viewport);await nav('/reports/executive');await waitExecutive();await page.locator('[data-testid=executive-changes] [data-series]').first().waitFor();
        const positions={};for(const key of ['executive-attention','executive-changes','executive-kpis']){const box=await page.locator(`[data-testid=${key}]`).boundingBox();positions[key]=box.y;if(viewport.width===1920)assert.ok(box.y<1080);}
        assert.equal(await page.locator('[data-domain-detail][open]').count(),0);await shot(`core-executive-${viewport.width}`,viewport,positions,viewport.width===1920);
      }
      const trigger=page.getByRole('button',{name:'筛选 · 0',exact:true});await trigger.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok(await trigger.evaluate(e=>e===document.activeElement));
      await nav('/student-success');await waitSupport();await shot('core-support-375',{width:375,height:812},{analyticsRegression:true});return;
    }
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 375, height: 812 }]) {
      await page.setViewportSize(viewport); await nav('/reports/executive'); await waitExecutive(); await page.locator('[data-testid=executive-changes] [data-series]').first().waitFor();
      assert.equal(await page.locator('[data-domain-detail][open]').count(), 0);
      assert.match(await page.locator('[data-series=leadsCreated]').first().innerText(), /减少.*-1.*-50%/);
      assert.match(await page.locator('[data-series=leadsConverted]').first().innerText(), /不可比较/);
      assert.equal(await page.locator('[data-testid=executive-changes] [data-series=openOpportunities]').count(), 0);
      assert.equal(await page.locator('[data-testid=executive-kpis] [data-metric=outstanding]').count(), 2);
      if (viewport.width === 1920) {
        const boxes = {};
        for (const id of ['executive-attention', 'executive-changes', 'executive-kpis']) { const box = await page.getByTestId(id).boundingBox(); assert.ok(box && box.y >= 0 && box.y < 1080, id); boxes[id] = box; }
        for (const selector of ['[data-testid=attention-total]', '[data-testid=executive-changes] strong', '[data-testid=executive-kpis] strong']) { const box = await page.locator(selector).first().boundingBox(); assert.ok(box && box.y + box.height < 1080, 'meaningful first-viewport value: ' + selector); }
        report.evidence.executiveFirstViewport = boxes;
        report.evidence.executiveDefaultDocumentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await shot('executive-1920-full', viewport, ['collapsed six domains', 'structural reduction, not height threshold'], true);
      }
      await shot(`executive-${viewport.width}`, viewport, ['attention/change/KPI priority', 'separate currencies', 'null percent', 'SNAPSHOT no comparison']);
      await page.getByRole('button', { name: '筛选 · 0', exact: true }).click(); const dialog = page.getByRole('dialog');
      await page.waitForFunction(() => document.querySelector('[role=dialog]')?.contains(document.activeElement));
      const first = dialog.locator('button:not([disabled])').first(), last = dialog.getByRole('button', { name: '应用筛选', exact: true });
      await last.focus(); await page.keyboard.press('Tab'); assert.ok(await first.evaluate(e => e === document.activeElement));
      await first.focus(); await page.keyboard.press('Shift+Tab'); assert.ok(await last.evaluate(e => e === document.activeElement));
      const before = requests.length;
      await dialog.locator('input[name=scope-from]').fill('2026-10-02'); assert.equal(requests.length, before);
      if (viewport.width === 1920) {
        await dialog.locator('input[name=scope-to]').fill('2026-10-01'); await dialog.getByRole('button', { name: '应用筛选', exact: true }).click();
        assert.equal(await dialog.count(), 1, 'invalid range keeps scope editor open'); assert.equal(requests.length, before, 'invalid scope does not request data');
        await dialog.locator('input[name=scope-to]').fill('2026-10-05');
      }
      await shot(`executive-scope-draft-${viewport.width}`, viewport, ['focus trap', 'draft isolation']);
      await dialog.getByRole('button', { name: '取消', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.equal(requests.length, before);
      assert.ok(await page.getByRole('button', { name: '筛选 · 0', exact: true }).evaluate(e => e === document.activeElement));
      await page.getByRole('button', { name: '筛选 · 0', exact: true }).click(); assert.equal(await dialog.locator('input[name=scope-from]').inputValue(), '2026-10-01');
      await dialog.locator('input[name=scope-from]').fill('2026-10-02');
      if (viewport.width === 1920) {
        await dialog.getByRole('button', { name: '产品批次', exact: true }).click(); await page.getByRole('option', { name: '示例秋季批次', exact: true }).click();
        await dialog.getByRole('button', { name: '产品', exact: true }).click(); await page.getByRole('option', { name: '示例学习项目', exact: true }).click();
        assert.ok((await dialog.getByRole('button', { name: '产品批次', exact: true }).innerText()).includes('选择'));
      }
      const applyRequestsStart = requests.length;
      await dialog.getByRole('button', { name: '应用筛选', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('[data-testid=applied-scope]')?.textContent.includes('2026-10-02')); await waitExecutive();
      assert.ok(requests.some(r => r.path === '/api/management/overview' && r.from === '2026-10-02'));
      assert.ok(requests.some(r => r.path === '/api/management/trends' && r.from === '2026-10-02'));
      assert.equal(requests.slice(applyRequestsStart).filter(r => r.path.startsWith('/api/management/')).length, 2, 'one applied request per independent source');
      await shot(`executive-scope-applied-${viewport.width}`, viewport, ['applied request once per source', 'visible scope']);
      const priorTrends = requests.filter(r => r.path === '/api/management/trends').length;
      await page.getByTestId('detailed-trends').locator('summary').click(); assert.equal(requests.filter(r => r.path === '/api/management/trends').length, priorTrends);
      await page.getByTestId('detailed-trends').locator('summary').click();
      await page.getByRole('button', { name: '清除筛选', exact: true }).click(); await waitExecutive();
      await nav('/student-success?view=analytics'); await waitSupport();
      assert.equal(await page.getByRole('tab', { name: '学生支持分析', exact: true }).getAttribute('aria-selected'), 'true');
      if (viewport.width === 1920) for (const id of ['support-health', 'support-goals', 'support-outcomes']) { const box = await page.getByTestId(id).boundingBox(); assert.ok(box && box.y < 1080, id); }
      if (viewport.width === 375) { const box = await page.getByTestId('support-health').boundingBox(); assert.ok(box && box.y < 812); report.evidence.mobileSupportHealthTop = box.y; }
      await shot(`support-analytics-${viewport.width}`, viewport, ['health/risk first', 'goals denominator', 'details collapsed', 'no stacked desktop filters']);
      await page.getByRole('button', { name: '筛选 · 0', exact: true }).click(); await dialog.locator('select[name=scope-health]').selectOption('AT_RISK'); const count = requests.length; await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.equal(requests.length, count);
      await page.getByRole('button', { name: '筛选 · 0', exact: true }).click(); assert.equal(await dialog.locator('select[name=scope-health]').inputValue(), ''); await dialog.locator('select[name=scope-health]').selectOption('AT_RISK'); await dialog.getByRole('button', { name: '应用筛选', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await waitSupport(); assert.ok(requests.some(r => r.path === '/api/student-success/analytics' && r.health === 'AT_RISK'));
      await shot(`support-scope-applied-${viewport.width}`, viewport, ['health draft/apply/cancel', 'scope response isolation']);
    }
    await page.setViewportSize({ width: 1920, height: 1080 }); await nav('/reports/executive'); await waitExecutive();
    scenario = 'trends-failed'; await reload(); await waitExecutive(); await page.getByTestId('executive-changes').getByRole('button', { name: '重新加载', exact: true }).waitFor();
    await shot('executive-trends-failed', { width: 1920, height: 1080 }, ['overview remains usable', 'bounded change error', 'retry']);
    scenario = 'normal'; await page.getByTestId('executive-changes').getByRole('button', { name: '重新加载', exact: true }).click(); await page.locator('[data-testid=executive-changes] [data-series]').first().waitFor();
    scenario = 'overview-failed'; await reload(); await page.getByTestId('executive-overview').getByRole('button', { name: '重新加载', exact: true }).waitFor(); assert.match(await page.getByTestId('executive-overview').innerText(), /总览加载失败/); await page.locator('[data-testid=executive-changes] [data-series]').first().waitFor(); assert.equal(await page.getByTestId('executive-kpis').count(),0);
    await shot('executive-overview-failed', { width: 1920, height: 1080 }, ['primary overview error', 'independently valid trends', 'no complete-dashboard claim']);
    scenario = 'restricted'; await page.evaluate(() => window.managementRole('SALES_SUPPORT')); await reload(); await waitExecutive();
    assert.equal(await page.locator('[data-module=finance] [data-metric]').count(),0); assert.match(await page.locator('[data-module=finance]').innerText(),/受限/); assert.equal(await page.locator('[data-testid=executive-kpis] [data-currency]').count(),0);
    await shot('executive-restricted', { width: 1920, height: 1080 }, ['restricted role', 'money omitted, never zero', 'commission permission']);
    scenario = 'module-unavailable'; await page.evaluate(() => window.managementRole('ADMIN')); await reload(); await waitExecutive(); assert.match(await page.locator('[data-module=delivery]').innerText(),/暂不可用/);
    await shot('executive-module-unavailable', { width: 1920, height: 1080 }, ['unavailable differs from restricted and zero']);
    scenario = 'zero-support'; await nav('/student-success?view=analytics'); await waitSupport(); assert.equal(await page.locator('[data-testid=support-health] [data-metric=activeCases] strong').innerText(),'0'); assert.match(await page.getByTestId('goal-attainment').innerText(),/尚未评价/);
    await shot('support-zero', { width: 1920, height: 1080 }, ['valid zero', 'zero denominator is not evaluated']);
    scenario = 'malformed-support'; await reload(); await page.getByRole('button', { name: '重新加载', exact: true }).waitFor(); assert.equal(await page.getByTestId('support-health').count(),0);
    await shot('support-required-field-error', { width: 1920, height: 1080 }, ['malformed required field is error, not optional fallback']);
    scenario = 'support-restricted'; await reload(); await page.getByText('访问受限', { exact: false }).first().waitFor(); assert.equal(await page.getByTestId('support-health').count(),0);
    await shot('support-restricted', { width: 1920, height: 1080 }, ['restricted distinct from zero']);
    scenario = 'normal'; await reload(); await waitSupport();
    await page.getByRole('tab', { name: '学生支持分析', exact: true }).focus(); await page.keyboard.press('End');
    await page.getByRole('tab', { name: '成果', exact: true }).waitFor(); assert.equal(await page.getByRole('tab', { name: '成果', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tabpanel').getByRole('heading', { name: '成果', exact: true }).waitFor();
    await page.keyboard.press('Home'); assert.equal(await page.getByRole('tab', { name: '支持个案', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: '学生支持分析', exact: true }).click(); await waitSupport();
    await page.locator('.locale-switcher').first().click();
    await page.getByRole('heading', { name: 'Health & risk', exact: true }).waitFor(); await shot('support-english', { width: 1920, height: 1080 }, ['English terminology']);
    await nav('/reports/executive'); await waitExecutive(); await page.getByRole('heading', { name: 'Period changes', exact: true }).waitFor(); await shot('executive-english', { width: 1920, height: 1080 }, ['English terminology', 'safe fallback']);
    // Only the exact injected HTTP failures are expected. Retain all other errors.
    const expected = report.errors.filter(error => expectedFailures.includes(error.url) && ['response','console'].includes(error.kind) && /503/.test(error.message));
    report.errors = report.errors.filter(error => !expected.includes(error)); report.evidence.expectedSyntheticHttpFailures = expected;
    assert.ok(expected.some(error => error.kind === 'response'), 'injected request failure observed');
  } catch (error) { report.errors.push({ kind: 'management-experience', message: error.message }); throw error; } finally { await context.close(); }
};
