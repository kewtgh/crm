import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {chromium} from "playwright-core";
import {renderTemplate} from "../infrastructure/email-delivery-worker/src/templates.js";
import {designFixtures,applicationUrl} from "../infrastructure/email-delivery-worker/test/design-fixtures.js";
const require=createRequire(import.meta.url);
const {chromium1243Path}=require("./lib/chromium-runtime-path.cjs");
const executable=chromium1243Path(),output=path.resolve("work/browser-qa-chromium-1243/email-v336");
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:executable});
const report={browser:"ms-playwright/chromium-1243",executable,browserVersion:browser.version(),boundary:"final Worker renderer; local HTML only, no provider request; Chromium is not Outlook/Gmail validation",checks:[]};
try {
 for(const [template,payload] of Object.entries(designFixtures))for(const locale of ["en","zh-CN"]){
  const rendered=renderTemplate(template,{...payload,locale},{brandName:"ewaya CRM",applicationUrl});
  await writeFile(path.join(output,`${template}-${locale}.html`),rendered.html);
  for(const width of [390,768,1280]){
   const page=await browser.newPage({viewport:{width,height:950}});
   try {
    await page.route("**/*",route=>route.abort());
    await page.setContent(rendered.html);
    assert.equal(await page.locator("h1").count(),1);
    assert.ok(await page.locator(".email-card").evaluate(el=>el.getBoundingClientRect().width)<=600);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${template} overflow ${width}`);
    await page.screenshot({path:path.join(output,`${template}-${locale}-${width}.png`),fullPage:true});
    await page.emulateMedia({colorScheme:"dark"});
    assert.equal(await page.locator(".email-card").evaluate(el=>getComputedStyle(el).backgroundColor),"rgb(33, 52, 62)");
    if(width===390)await page.screenshot({path:path.join(output,`${template}-${locale}-dark.png`),fullPage:true});
    report.checks.push({template,locale,width,result:"PASS"});
   }finally{await page.close();}
  }
  console.log(`PASS email ${template} ${locale}`);
 }
}finally{await browser.close();await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));}
console.log(`PASS ${report.checks.length} final-render email layouts, pinned Chromium; local fictional fixtures only.`);
