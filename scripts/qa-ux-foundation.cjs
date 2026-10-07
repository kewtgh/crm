/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report,observe})=>{
  const context=await browser.newContext({locale:'zh-CN',bypassCSP:true});
  try{
    const page=await context.newPage();observe(page);page.setDefaultTimeout(5000);
    const health=await page.goto(`${base}/api/health`);assert.ok(health?.ok());assert.equal((await health.json()).version,report.evidence.appVersion);
    require('tsx/cjs');const {organizationRows}=require('../tests/fixtures/ux-organization-rows.ts');
    const requests=[];
    await page.route(`${base}/api/**`,route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/crm/schools'){
        requests.push(Object.fromEntries(url.searchParams));
        return route.fulfill({json:{items:organizationRows,total:organizationRows.length,metrics:{total:6,needsAttention:1,averageCompleteness:80}}});
      }
      if(url.pathname==='/api/search/related')return route.fulfill({json:{items:url.searchParams.get('types')==='USER'?[{value:'USER:00000000-0000-4000-8000-000000000099',labelZh:'顾问甲',labelEn:'Advisor A'}]:[]}});
      if(url.pathname==='/api/notifications')return route.fulfill({json:{items:[],total:0,unread:0,page:1,pageSize:20}});
      if(url.pathname==='/api/views')return route.fulfill({json:route.request().method()==='POST'?{item:{id:'00000000-0000-4000-8000-000000000080'}}:{items:[]}});
      return route.fulfill({json:{items:[],total:0,page:1,pageSize:10}});
    });
    const bundle=await build({entryPoints:['tests/fixtures/ux-foundation-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/navigation':path.resolve('tests/fixtures/ux-foundation-navigation.ts'),'next/link':path.resolve('tests/fixtures/ux-foundation-link.tsx'),'next/image':path.resolve('tests/fixtures/ux-foundation-image.tsx')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
    await page.setContent('<html lang="zh-CN"><head><title>UX foundation synthetic QA</title></head><body><div id="root"></div></body></html>');
    for(const file of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(file=>file.endsWith('.css')))await page.addStyleTag({url:`${base}/_next/static/${file.replaceAll('\\','/')}`});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const nav=href=>page.evaluate(href=>window.uxNavigate(href),href);
    const screenshot=async(label,viewport,checks)=>{
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${label}: document overflow`);
      await page.screenshot({path:path.join(output,`${label}.png`),fullPage:false});
      report.pages.push({label,route:new URL(page.url()).pathname,viewport,checks,boundary:'Actual AppShell/components and production CSS; synthetic mocked business APIs and QA routing transport. No DB/RLS claim.'});
      process.stdout.write(`[QA ux-foundation] ${label} passed\n`);
    };
    if(process.env.QA_CORE_ONLY==='1'){
      for(const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:375,height:812}]){
        await page.setViewportSize(viewport);await nav('/schools');await page.waitForFunction(()=>document.querySelector('#record-list')?.getAttribute('aria-busy')==='false');
        const first=viewport.width===375?await page.locator('.ux-organization-row').first().boundingBox():null;if(viewport.width===375)assert.ok(first&&first.y<812);
        await screenshot(`core-organizations-${viewport.width}`,viewport,{firstRecordTop:first?.y,desktopTable:viewport.width!==375});
      }
      const trigger=page.getByRole('button',{name:'筛选 · 0',exact:true});await trigger.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();
      const first=dialog.locator('button:not([disabled])').first(),last=dialog.getByRole('button',{name:'应用筛选',exact:true});await last.focus();await page.keyboard.press('Tab');assert.ok(await first.evaluate(e=>e===document.activeElement));await first.focus();await page.keyboard.press('Shift+Tab');assert.ok(await last.evaluate(e=>e===document.activeElement));
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.ok(await trigger.evaluate(e=>e===document.activeElement));
      await page.keyboard.press('Control+k');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
      assert.equal(await page.locator('a[aria-current=page]').filter({hasText:'学校与机构'}).count(),1);
      const mobile=page.locator('.mobile-menu');await mobile.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.sidebar')?.contains(document.activeElement));
      const current=page.locator('.sidebar a[aria-current=page]');await current.focus();assert.ok(await current.evaluate(e=>e===document.activeElement));await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('.mobile-menu')===document.activeElement);
      await page.emulateMedia({reducedMotion:'reduce'});assert.ok(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
      const record=page.locator('.ux-organization-row a').first();await record.focus();await page.keyboard.press('Enter');await page.getByTestId('presentation-probes').waitFor();await page.goBack();await page.locator('.ux-organization-row').first().waitFor();
      return;
    }
    for(const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:375,height:812}]){
      await page.setViewportSize(viewport);await nav('/schools');
      await page.locator('.ux-filter-bar').waitFor();await page.waitForFunction(()=>document.querySelector('#record-list')?.getAttribute('aria-busy')==='false');
      const first=page.locator('.ux-organization-row').first();
      if(viewport.width===375){const box=await first.boundingBox();assert.ok(box&&box.y>=0&&box.y<812,`first record begins within viewport: ${JSON.stringify(box)}`);report.evidence.firstOrganizationRecordTop=box.y;}
      await screenshot(`ux-organizations-${viewport.width}`,viewport,['primary-filters','locale-identity','first-record','no-overflow']);
      await page.getByRole('button',{name:'筛选 · 0',exact:true}).click();const dialog=page.getByRole('dialog');
      await page.waitForFunction(()=>document.querySelector('[role=dialog]')?.contains(document.activeElement));
      const firstFocusable=dialog.locator('button:not([disabled])').first(),lastFocusable=dialog.getByRole('button',{name:'应用筛选',exact:true});
      await lastFocusable.focus();await page.keyboard.press('Tab');assert.ok(await firstFocusable.evaluate(e=>e===document.activeElement),'drawer Tab wraps');
      await firstFocusable.focus();await page.keyboard.press('Shift+Tab');assert.ok(await lastFocusable.evaluate(e=>e===document.activeElement),'drawer Shift+Tab wraps');
      await dialog.getByLabel(/^商业等级/).selectOption('A');await dialog.getByLabel(/^关键联系人评估/).selectOption('KEY');await dialog.locator('input[type=number]').fill('80');
      const before=requests.length;await page.waitForTimeout(100);assert.equal(requests.length,before,'draft cannot issue filtering request');
      await screenshot(`ux-filter-draft-${viewport.width}`,viewport,['draft-isolation','modal-engine']);
      await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(requests.length,before);assert.ok(await page.getByRole('button',{name:'筛选 · 0',exact:true}).evaluate(e=>e===document.activeElement),'cancel restores trigger focus');
      await page.getByRole('button',{name:'筛选 · 0',exact:true}).click();assert.equal(await page.getByRole('dialog').getByLabel(/^商业等级/).inputValue(),'','cancel discards draft');
      await page.getByRole('dialog').getByLabel(/^商业等级/).selectOption('A');await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/crm/schools'&&new URL(response.url()).searchParams.get('commercialTier')==='A'),page.getByRole('dialog').getByRole('button',{name:'应用筛选',exact:true}).click()]);
      await page.waitForFunction(()=>document.querySelector('#record-list')?.getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'筛选 · 1',exact:true}).waitFor();assert.equal(requests.at(-1).commercialTier,'A');
      await screenshot(`ux-filter-applied-${viewport.width}`,viewport,['applied-query','badge-count']);
      await page.getByRole('button',{name:'筛选 · 1',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'重置待应用条件',exact:true}).click();assert.equal(await page.getByRole('dialog').getByLabel(/^商业等级/).inputValue(),'');assert.equal(requests.at(-1).commercialTier,'A','draft reset preserves applied query');
      await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok(await page.getByRole('button',{name:'筛选 · 1',exact:true}).evaluate(e=>e===document.activeElement));await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/crm/schools'&&!new URL(response.url()).searchParams.has('commercialTier')),page.getByRole('button',{name:'清除筛选',exact:true}).click()]);await page.getByRole('button',{name:'筛选 · 0',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#record-list')?.getAttribute('aria-busy')==='false');assert.equal(requests.at(-1).commercialTier,undefined);
      await screenshot(`ux-filter-reset-${viewport.width}`,viewport,['reset-applied','Escape','focus-restore']);
      if(viewport.width===375){
        await Promise.all([page.waitForResponse(response=>new URL(response.url()).searchParams.get('sort')==='status'),page.getByRole('combobox',{name:'排序',exact:true}).selectOption('status')]);assert.equal(requests.at(-1).sort,'status');
        await page.locator('.ux-organization-row a').first().click();await page.getByTestId('presentation-probes').waitFor();await page.goBack();await page.getByRole('combobox',{name:'排序',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'排序',exact:true}).inputValue(),'status','Back restores existing URL sort');
      }
      if(viewport.width===1920){
        await page.getByRole('button',{name:'管理保存视图',exact:true}).click();const saved=page.getByRole('dialog');
        await saved.locator('input[name=name]').fill('Example personal view');await saved.getByRole('button',{name:'保存当前视图',exact:true}).click();await saved.getByRole('button',{name:/^Example personal view/}).waitFor();
        await saved.locator('input[name=name]').fill('Example team view');await saved.locator('select[name=visibility]').selectOption('TEAM');await saved.getByRole('button',{name:'保存当前视图',exact:true}).click();await saved.getByRole('button',{name:/^Example team view/}).waitFor();await page.keyboard.press('Escape');
      }
      for(const [href,label] of [['/students','学生'],['/households?tab=families','家庭']]){
        await nav(href);await page.locator('.sidebar a[aria-current=page]').waitFor({state:'attached'});assert.equal(await page.locator('.sidebar a[aria-current=page]').getAttribute('aria-label'),label);
        if(viewport.width===375){await page.locator('.mobile-menu').click();await page.waitForFunction(()=>document.querySelector('.sidebar')?.contains(document.activeElement));await page.locator('.sidebar a[aria-current=page]').scrollIntoViewIfNeeded();await page.keyboard.press('Shift+Tab');assert.ok(await page.locator('.sidebar').evaluate(e=>e.contains(document.activeElement)));if(await page.getByRole('button',{name:'运营治理',exact:true}).getAttribute('aria-expanded')==='false')await page.getByRole('button',{name:'运营治理',exact:true}).click();await page.locator('.sidebar a[href="/workflow-templates"]').waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('.mobile-menu')===document.activeElement);}
        await screenshot(`ux-${label==='学生'?'student':'family'}-${viewport.width}`,viewport,['correct-global-location','no-family-workspace-strip','mobile-nav']);
      }
      await nav('/help');await screenshot(`ux-primitives-${viewport.width}`,viewport,['long-bilingual-header','MetricStrip','AttentionPanel']);
      const probe=await page.getByTestId('presentation-probes').innerText();assert.match(probe,/未知状态/);assert.match(probe,/未记录/);assert.match(probe,/暂不可用/);assert.doesNotMatch(probe,/undefined|null|\[object Object\]|synthetic\.missing/);assert.equal(await page.getByText('MUST_NOT_RENDER',{exact:true}).count(),0);
      assert.equal(await page.locator('nav.page-tabs [role=tab]').count(),0);assert.equal(await page.locator('nav.page-tabs a[aria-current=page]').getAttribute('href'),'/imports');
      if(viewport.width===375){await page.keyboard.press('Control+k');await page.getByRole('dialog').waitFor();await page.getByRole('dialog').locator('input').fill('学生');await page.getByRole('dialog').locator('a[href="/students"]').waitFor();await page.keyboard.press('Escape');}
      else {for(const [term,href] of [['学生','/students'],['家庭','/households?tab=families'],['渠道协议','/commissions'],['经营','/reports/executive'],['流程模板','/workflow-templates']]){await page.keyboard.press('Control+k');await page.locator('.global-search input').fill(term);await page.locator(`.global-results a[href="${href}"]`).waitFor();await page.keyboard.press('Escape');}}
    }
    await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>window.uxRole('SALES_SUPPORT'));await nav('/students');
    for(const href of ['/approvals','/progression','/imports','/data-quality','/admin'])assert.equal(await page.locator(`.sidebar a[href="${href}"]`).count(),0);
    await page.locator('.global-search input').fill('导入');await page.waitForTimeout(250);assert.equal(await page.locator('.global-results a[href="/imports"]').count(),0);await page.keyboard.press('Escape');
    await screenshot('ux-restricted-navigation',{width:1920,height:1080},['capability-visibility','permitted-finance-view','no-admin','no-inaccessible-page-commands']);
    await page.locator('.sidebar-collapse').click();assert.ok(await page.locator('.app-frame').evaluate(e=>e.classList.contains('sidebar-collapsed')));await page.locator('.sidebar-collapse').click();
    await page.locator('.locale-switcher').first().click();
    await nav('/help');await page.getByText('Unknown status',{exact:true}).waitFor();await screenshot('ux-english-primitives',{width:1920,height:1080},['English-fallback','locale-identity']);
  }catch(error){report.errors.push({kind:'ux-foundation',message:error.message});throw error;}finally{await context.close();}
};
