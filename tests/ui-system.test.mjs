import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { customerDetailTabs } from "../lib/customer-detail-tabs.ts";
import { zhV3130, enV3130 } from "../lib/i18n/locales/v3130.ts";
const source = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("customer tabs distinguish institution contacts from households and omit peer contacts for a person", () => {
  assert.equal(customerDetailTabs("ORGANIZATION").find(tab => tab.key === "people").label, "detail.organizationContacts");
  assert.equal(customerDetailTabs("HOUSEHOLD").find(tab => tab.key === "people").label, "detail.familyMembers");
  assert.ok(!customerDetailTabs("CONTACT", true).some(tab => tab.key === "people"));
  assert.ok(customerDetailTabs("CONTACT", true).some(tab => tab.key === "privacy"));
  assert.ok(customerDetailTabs("ORGANIZATION", false, true).some(tab => tab.key === "history"));
});
test("contact projections preserve correct subject boundary and show assigned owner", async () => {
  const repo = await source("lib/customer-operations-repository.ts");
  assert.match(repo, /next_follow_up_at,owner_id&organization_id/);
  assert.match(repo, /limit=51`,subject==="ORGANIZATION"\)/);
  const panel = await source("components/customer-operations-panel.tsx");
  assert.match(panel, /subject==="HOUSEHOLD"&&<section className="detail-section"><h3>\{t\("nav.students"\)/);
  assert.doesNotMatch(panel, /customerOps.tab.people/);
  assert.match(panel, /count:data.entries.length/);
});
test("product deletion stays behind a disclosure and retains guarded confirmation", async () => {
  const page = await source("components/products-page.tsx"), detail = await source("components/product-detail-panel.tsx");
  assert.match(page, /canDeleteProduct&&<ActionDisclosure/);
  assert.match(page, /SUPER_ADMIN.*ADMIN/);
  assert.match(page, /deleteProduct&&<ConfirmDialog/);
  assert.match(detail, /canDelete&&<ActionDisclosure/);
  assert.match(detail, /product.prices.map/);
  assert.match(detail, /maximumFractionDigits:2/);
  assert.doesNotMatch(page, /product-action-button delete/);
  const disclosure = await source("components/action-disclosure.tsx");
  assert.match(disclosure, /pointerdown/); assert.match(disclosure, /event.key === "Escape"/);
});
test("suggestion review and automation have separate governance destinations and canonical guards", async () => {
  const {navigationDestinations,visibleDestinations}=await import('../lib/navigation-destinations.ts');
  for(const [id,capability] of [['ai','ai.review'],['automation','automation.manage']]){
    const entry=navigationDestinations.find(item=>item.id===id);
    assert.equal(entry.space,'governance');assert.equal(entry.capability,capability);
    assert.ok(visibleDestinations('ADMIN').some(item=>item.id===id));
  }
  assert.ok(!visibleDestinations('SALES_SUPPORT').some(item=>item.id==='automation'));
  assert.match(await source("app/(crm)/ai/page.tsx"), /requireCapability\("ai.review"\)/);
  assert.match(await source("app/(crm)/automation/page.tsx"), /requireCapability\("automation.manage"\)/);
  const header = await source("components/assistance-workspace-header.tsx");
  assert.match(header, /capability:"ai.review"/); assert.match(header, /capability:"automation.manage"/);
});
test("shared detail tabs support roving focus, arrows, Home/End and bilingual labels", async () => {
  const tabs = await source("components/detail-tabs.tsx");
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) assert.ok(tabs.includes(key));
  assert.match(tabs, /tabIndex=\{active === item.key \? 0 : -1\}/);
  assert.match(tabs, /aria-labelledby/); assert.match(tabs, /useId/);
  assert.deepEqual(Object.keys(zhV3130).sort(), Object.keys(enV3130).sort());
  for (const key of Object.keys(zhV3130)) { assert.ok(zhV3130[key]); assert.ok(enV3130[key]); }
});
test("global primary palette is calm teal, readable, and removes legacy purple gradients", async () => {
  const css = await source("app/ui-system.css");
  assert.match(css, /--brand: #176b79/); assert.match(css, /flex-wrap: nowrap/);
  assert.match(css, /prefers-reduced-motion/); assert.match(await source("app/layout.tsx"), /ui-system.css/);
  for (const file of ["app/globals.css", "app/v270.css"]) assert.doesNotMatch(await source(file), /#(?:322078|5b3bb2|7250c8|28165f|422889|30206e)/i);
  const luminance = hex => { const channels = hex.match(/../g).map(c => parseInt(c,16)/255).map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4); return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722; };
  for (const [foreground, background] of [["ffffff","176b79"],["586d76","ffffff"],["a1bbc5","193e4b"]]) {
    const values = [luminance(foreground),luminance(background)].sort((a,b)=>b-a);
    assert.ok((values[0]+.05)/(values[1]+.05)>=4.5, `${foreground} on ${background} meets normal-text contrast`);
  }
});
