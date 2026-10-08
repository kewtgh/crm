import test from "node:test";
import assert from "node:assert/strict";
import {renderTemplate,TEMPLATE_KEYS} from "../src/templates.js";
import {validEmailBrand,validBrandedSender,validatedRuntimeConfiguration} from "../src/config.js";
import {designFixtures,applicationUrl} from "./design-fixtures.js";

for (const key of TEMPLATE_KEYS) for (const locale of ["en","zh-CN"]) {
  test(`${key}: ${locale} uses the final table renderer and matching plain text`,()=>{
    const output=renderTemplate(key,{...designFixtures[key],locale},{brandName:"ewaya CRM",applicationUrl});
    assert.match(output.html,/role="presentation"/);
    assert.match(output.html,/max-width:600px/);
    assert.match(output.html,/if mso/);
    assert.match(output.html,/prefers-color-scheme:dark/);
    assert.match(output.html,new RegExp(`lang="${locale}"`));
    assert.ok(!/<(?:main|footer)\b/.test(output.html));
    assert.ok(!/Lumina|Education CRM/.test(output.html+output.text+output.subject));
    const heading=output.html.match(/<h1[^>]*>([^<]*)<\/h1>/)[1];
    assert.ok(output.text.includes(heading));
    if (key==="device-verification") {assert.match(output.text,/000000/);assert.match(output.html,/000000/);assert.match(output.text,locale==="en"?/10 minutes/:/10 分钟/);}
    if (key==="staff-account-created") for(const field of ["username","temporaryPassword"]) {assert.ok(output.text.includes(designFixtures[key][field]));assert.ok(output.html.includes(designFixtures[key][field]));}
  });
}
test("unknown locale falls back to English; injected content is escaped and external links rejected",()=>{
  const output=renderTemplate("communication-message",{subject:"<img src=x>",body:'<script>"&</script>',locale:"xx"},{brandName:"ewaya CRM",applicationUrl});
  assert.match(output.html,/lang="en"/);assert.ok(!output.html.includes("<script>"));assert.match(output.html,/&lt;script&gt;/);assert.ok(output.text.includes('<script>"&</script>'));
  assert.throws(()=>renderTemplate("password-reset",{url:"https://external.example.test/",expiresInSeconds:600},{brandName:"ewaya CRM",applicationUrl}),{code:"TEMPLATE_URL_INVALID"});
});
test("runtime requires both an ewaya brand and an ewaya sender display name",()=>{
  assert.ok(validEmailBrand("ewaya"));assert.ok(validEmailBrand("ewaya CRM"));
  assert.ok(validBrandedSender("ewaya CRM <sender@example.test>"));
  for(const brand of ["Legacy Brand","ewaya Education CRM","ewaya CRM\nInjected"])assert.equal(validEmailBrand(brand),false);
  for(const sender of ["sender@example.test","Legacy Brand <sender@example.test>"])assert.equal(validBrandedSender(sender),false);
  const env={EMAIL_FROM:"ewaya CRM <sender@example.test>",EMAIL_BRAND_NAME:"ewaya CRM",RESEND_API_KEY:"re_fictional",LUMINA_WEBHOOK_TOKEN:"fictional",CRM_APP_URL:applicationUrl,DELIVERY_PATH:"/delivery",HEALTH_PATH:"/health"};
  assert.ok(validatedRuntimeConfiguration(env));assert.equal(validatedRuntimeConfiguration({...env,EMAIL_BRAND_NAME:"Legacy Brand"}),null);assert.equal(validatedRuntimeConfiguration({...env,EMAIL_FROM:"Legacy Brand <sender@example.test>"}),null);
});
