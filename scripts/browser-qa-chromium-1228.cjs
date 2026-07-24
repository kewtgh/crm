/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");

const executable=process.env.PLAYWRIGHT_CHROMIUM_1228_PATH||"C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
const playwrightPath=process.env.PLAYWRIGHT_CORE_PATH||"playwright-core";
const {chromium}=require(playwrightPath);
const base=(process.env.QA_BASE_URL||process.env.APP_URL||"http://localhost:3200").replace(/\/$/,"");
const output=path.resolve(process.env.QA_OUTPUT_DIR||"work/browser-qa-chromium-1228");
fs.mkdirSync(output,{recursive:true});

function commandValue(command,args){const result=spawnSync(command,args,{encoding:"utf8",timeout:10_000});return result.status===0?result.stdout.trim():"unavailable";}
function buildHash(){const root=[path.resolve("dist"),path.resolve(".next")].find(candidate=>fs.existsSync(candidate));if(!root)return"unavailable";const files=[];const visit=(directory)=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory())visit(target);else if(entry.isFile())files.push(target);}};visit(root);const hash=crypto.createHash("sha256");for(const file of files.sort()){hash.update(path.relative(root,file).replaceAll("\\","/"));hash.update(fs.readFileSync(file));}return hash.digest("hex");}
const migrationHead=fs.readdirSync(path.resolve("supabase/migrations")).filter(name=>name.endsWith(".sql")).sort().at(-1)?.replace(/\.sql$/,'')||"unavailable";
const appVersion=JSON.parse(fs.readFileSync(path.resolve("package.json"),"utf8")).version;

function envFile(){
  const values={};
  const filename=path.resolve(".env.local");
  if(!fs.existsSync(filename))return values;
  for(const raw of fs.readFileSync(filename,"utf8").split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith("#"))continue;
    const at=line.indexOf("=");if(at<1)continue;
    let value=line.slice(at+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    values[line.slice(0,at).trim()]=value;
  }
  return values;
}
const env={...envFile(),...process.env};
const playwrightCoreVersion=require(`${playwrightPath}/package.json`).version;
const actionTimeoutMs=12_000;
const report={runAt:new Date().toISOString(),browser:"ms-playwright/chromium-1228",executable,browserVersion:"",evidence:{baseUrl:base,appVersion,playwrightCoreVersion,actionTimeoutMs,gitSha:commandValue("git",["rev-parse","HEAD"]),migrationHead,buildHash:buildHash()},pages:[],errors:[],warnings:[],identity:{created:0,cleaned:0}};

function observe(page){
  page.on("pageerror",error=>report.errors.push({kind:"pageerror",url:page.url(),message:error.message.slice(0,300)}));
  page.on("console",message=>{
    if(message.type()!=="error")return;
    const text=message.text();
    const location=message.location().url||page.url();
    if(/challenges\.cloudflare\.com|ERR_ABORTED/.test(text)||/\.kaspersky-labs\.com\//.test(location))return;
    report.errors.push({kind:"console",url:location,message:text.slice(0,300)});
  });
  page.on("requestfailed",request=>{
    const url=request.url();
    const failure=request.failure()?.errorText??"failed";
    if(failure.includes("ERR_ABORTED")){
      if(process.env.QA_TRACE_ABORTS==="1")report.warnings.push({kind:"navigation-abort",url,message:failure});
      return;
    }
    if(!url.startsWith(base)||url.includes("/api/health"))return;
    report.errors.push({kind:"request",url,message:failure});
  });
  page.on("response",response=>{
    if(response.url().startsWith(base)&&response.status()>=400&&!response.url().includes("/api/health")){
      report.errors.push({kind:"response",url:response.url(),message:String(response.status())});
    }
  });
}
async function inspect(page,label,route,viewport){
  const startedAt=Date.now();
  process.stdout.write(`[QA] start ${label} ${viewport.width}x${viewport.height}\n`);
  await page.setViewportSize(viewport);
  const response=await page.goto(`${base}${route}`,{waitUntil:"domcontentloaded",timeout:30_000});
  await page.waitForLoadState("networkidle",{timeout:5_000}).catch(()=>null);
  await page.waitForTimeout(150);
  const result=await page.evaluate(()=>{
    const below12Elements=[...document.querySelectorAll("body *")].filter(element=>element.getClientRects().length&&[...element.childNodes].some(node=>node.nodeType===3&&node.textContent.trim())&&parseFloat(getComputedStyle(element).fontSize)<12);
    const headings=[...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(element=>element.getClientRects().length).map(element=>({level:Number(element.tagName.slice(1)),text:element.textContent.trim().slice(0,100)}));
    const headingSkips=headings.flatMap((heading,index)=>index&&heading.level>headings[index-1].level+1?[{from:headings[index-1],to:heading}]:[]);
    const parseColor=(value)=>{
      const match=value.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\)/);
      return match?{r:Number(match[1]),g:Number(match[2]),b:Number(match[3]),a:match[4]===undefined?1:Number(match[4])}:null;
    };
    const composite=(front,back)=>({r:front.r*front.a+back.r*(1-front.a),g:front.g*front.a+back.g*(1-front.a),b:front.b*front.a+back.b*(1-front.a),a:1});
    const luminance=(color)=>{
      const channel=(value)=>{const normalized=value/255;return normalized<=.04045?normalized/12.92:((normalized+.055)/1.055)**2.4;};
      return .2126*channel(color.r)+.7152*channel(color.g)+.0722*channel(color.b);
    };
    const contrast=(first,second)=>{const light=Math.max(luminance(first),luminance(second));const dark=Math.min(luminance(first),luminance(second));return(light+.05)/(dark+.05);};
    const contrastRows=[...document.querySelectorAll("body *")].flatMap(element=>{
      if(!element.getClientRects().length||element.closest("[disabled],[aria-disabled='true']")||![...element.childNodes].some(node=>node.nodeType===3&&node.textContent.trim()))return[];
      const style=getComputedStyle(element);const foreground=parseColor(style.color);if(!foreground)return[];
      let ancestor=element;let background=null;const translucentLayers=[];let uncertain=false;
      while(ancestor){
        const ancestorStyle=getComputedStyle(ancestor);
        const candidate=parseColor(ancestorStyle.backgroundColor);
        if(candidate&&candidate.a>=.99){background=candidate;break;}
        if(candidate&&candidate.a>0)translucentLayers.push(candidate);
        if(ancestorStyle.backgroundImage!=="none"){uncertain=true;break;}
        ancestor=ancestor.parentElement;
      }
      if(!background||uncertain)return[];
      for(const layer of translucentLayers.reverse())background=composite(layer,background);
      const rendered=foreground.a<1?composite(foreground,background):foreground;
      const ratio=contrast(rendered,background);const size=parseFloat(style.fontSize);const weight=Number(style.fontWeight)||400;
      const threshold=size>=24||(size>=18.66&&weight>=700)?3:4.5;
      return ratio+.05<threshold?[{tag:element.tagName.toLowerCase(),className:String(element.className).slice(0,120),text:element.textContent.trim().slice(0,80),ratio:Number(ratio.toFixed(2)),threshold}]:[];
    });
    return{
      title:document.title,
      lang:document.documentElement.lang,
      h1:[...document.querySelectorAll("h1")].filter(element=>element.getClientRects().length).map(element=>element.textContent.trim()),
      overflow:document.documentElement.scrollWidth>innerWidth+2,
      scrollWidth:document.documentElement.scrollWidth,
      overflowSamples:[...document.querySelectorAll("body *")].flatMap(element=>{
        if(!element.getClientRects().length)return[];
        const rect=element.getBoundingClientRect();
        return rect.right>innerWidth+2?[{tag:element.tagName.toLowerCase(),className:String(element.className).slice(0,120),left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width),text:element.textContent.trim().slice(0,80)}]:[];
      }).slice(0,50),
      width:innerWidth,
      unnamed:[...document.querySelectorAll("input,select,textarea,button,a[href]")].filter(element=>{
        if(!element.getClientRects().length)return false;
        const idLabel=element.id&&document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        return!(element.getAttribute("aria-label")||element.getAttribute("aria-labelledby")||element.getAttribute("title")||element.getAttribute("placeholder")||idLabel||element.closest("label")||element.textContent?.trim());
      }).length,
      below12:below12Elements.length,
      below12Samples:below12Elements.slice(0,200).map(element=>({
        tag:element.tagName.toLowerCase(),
        className:element.className,
        text:element.textContent.trim().slice(0,80),
        fontSize:getComputedStyle(element).fontSize,
      })),
      headingSkips,
      lowContrast:contrastRows.length,
      lowContrastSamples:contrastRows.slice(0,100),
      applicationError:/application error|internal server error|暂时无法读取数据|data (?:could not|cannot) be loaded/i.test(document.body.innerText),
    };
  });
  const item={label,route,status:response?.status()??null,finalUrl:page.url().replace(base,""),...result};
  report.pages.push(item);
  await page.screenshot({path:path.join(output,`${label}.png`),fullPage:true});
  if(!response?.ok()||item.finalUrl!==route||item.applicationError||!item.h1.length||item.overflow||item.unnamed||item.below12||item.headingSkips.length||item.lowContrast){
    report.errors.push({kind:"inspection",url:route,message:JSON.stringify(item)});
  }
  process.stdout.write(`[QA] pass ${label} ${Date.now()-startedAt}ms\n`);
}
async function createIdentity(role,label){
  const supabase=env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,"");
  const anon=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!supabase||!anon||!service)throw new Error("Local Supabase QA variables are missing");
  const suffix=Date.now().toString(36);
  const email=`chromium-1228-${label}-${suffix}@example.invalid`;
  const password=`Qa!${crypto.randomBytes(18).toString("base64url")}A1`;
  const headers={apikey:service,authorization:`Bearer ${service}`,"content-type":"application/json"};
  const createdResponse=await fetch(`${supabase}/auth/v1/admin/users`,{method:"POST",headers,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{username:`qa.${label}.${suffix}`,chinese_name:"浏览器验收",english_name:"Browser QA"},app_metadata:{role,account_status:"ACTIVE"}})});
  const created=await createdResponse.json();
  if(!createdResponse.ok||!created.id)throw new Error(`QA user creation failed (${createdResponse.status})`);
  report.identity.created+=1;
  await fetch(`${supabase}/rest/v1/workspace_memberships?user_id=eq.${created.id}`,{method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({must_change_password:false})});
  const tokenResponse=await fetch(`${supabase}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:anon,"content-type":"application/json"},body:JSON.stringify({email,password})});
  const token=await tokenResponse.json();
  if(!tokenResponse.ok||!token.access_token)throw new Error(`QA login failed (${tokenResponse.status})`);
  if(role==="SALES_MANAGER"||role==="SUPER_ADMIN"){
    const {elevateQaSessionToAal2}=await import("./lib/qa-auth.mjs");
    return{id:created.id,supabase,anon,headers,token:await elevateQaSessionToAal2({supabaseUrl:supabase,anonKey:anon,accessToken:token.access_token,friendlyName:`chromium-1228-${suffix}`})};
  }
  return{id:created.id,supabase,anon,headers,token};
}
async function serviceJson(identity,path,{method="GET",body,prefer}={}){
  const response=await fetch(`${identity.supabase}${path}`,{
    method,
    headers:{apikey:identity.anon,authorization:`Bearer ${identity.token.access_token}`,"content-type":"application/json",...(prefer?{Prefer:prefer}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(`QA scenario request failed (${method} ${path}: ${response.status})`);
  return result;
}
async function seedV210Scenario(identity){
  const workspaceId="00000000-0000-4000-8000-000000000001";
  const suffix=Date.now().toString(36);
  const contacts=await serviceJson(identity,"/rest/v1/contacts?select=id,name_zh",{method:"POST",prefer:"return=representation",body:[
    {workspace_id:workspaceId,name_zh:`验收学生${suffix}`,name_en:`QA Student ${suffix}`,contact_type:"STUDENT",status:"ACTIVE",owner_id:identity.id,created_by:identity.id},
    {workspace_id:workspaceId,name_zh:`验收家长${suffix}`,name_en:`QA Parent ${suffix}`,contact_type:"PARENT",status:"ACTIVE",owner_id:identity.id,created_by:identity.id},
  ]});
  const householdRows=await serviceJson(identity,"/rest/v1/households?select=id,name_zh",{method:"POST",prefer:"return=representation",body:{
    workspace_id:workspaceId,name_zh:`验收家庭${suffix}`,name_en:`QA Household ${suffix}`,address:"Taipei",owner_id:identity.id,created_by:identity.id,
  }});
  const household=householdRows[0];
  const studentRows=await serviceJson(identity,"/rest/v1/students?select=id",{method:"POST",prefer:"return=representation",body:{
    workspace_id:workspaceId,person_id:contacts[0].id,household_id:household.id,student_number:`QA-${suffix}`,
    current_grade:"G5",academic_year:"2025-2026",status:"ACTIVE",owner_id:identity.id,created_by:identity.id,
  }});
  const leadRows=await serviceJson(identity,"/rest/v1/leads?select=id",{method:"POST",prefer:"return=representation",body:{
    workspace_id:workspaceId,subject_type:"HOUSEHOLD",household_id:household.id,
    name_zh:`验收家庭线索${suffix}`,name_en:`QA Household Lead ${suffix}`,source:"QA",
    status:"QUALIFIED",qualification_score:90,qualification_note:"Browser acceptance",
    pipeline_key:"HOUSEHOLD_DEFAULT",owner_id:identity.id,created_by:identity.id,
  }});
  return{
    suffix,householdId:household.id,householdName:household.name_zh,
    studentId:studentRows[0].id,studentName:contacts[0].name_zh,
    parentId:contacts[1].id,parentName:contacts[1].name_zh,
    contactIds:contacts.map(item=>item.id),leadId:leadRows[0].id,leadName:`验收家庭线索${suffix}`,
  };
}
async function cleanupV210Scenario(identity,scenario){
  if(!scenario)return;
  const ids=[identity.id,scenario.leadId,scenario.householdId,scenario.studentId,...scenario.contactIds];
  if(ids.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))throw new Error("QA cleanup refused a malformed UUID");
  const sql=`begin;
delete from public.lead_conversions where lead_id='${scenario.leadId}';
delete from public.opportunity_stage_history where opportunity_id in(select id from public.opportunities where household_id='${scenario.householdId}');
delete from public.opportunities where household_id='${scenario.householdId}';
delete from public.leads where id='${scenario.leadId}';
delete from public.progression_batch_items where student_id='${scenario.studentId}';
delete from public.progression_batches where created_by='${identity.id}';
delete from public.student_academic_records where student_id='${scenario.studentId}';
delete from public.student_guardian_relationships where student_id='${scenario.studentId}';
delete from public.students where id='${scenario.studentId}';
delete from public.household_members where household_id='${scenario.householdId}';
delete from public.households where id='${scenario.householdId}';
delete from public.contacts where id in(${scenario.contactIds.map(id=>`'${id}'`).join(",")});
delete from public.automation_events where actor_id='${identity.id}';
delete from public.audit_events where actor_id='${identity.id}';
commit;`;
  const config=fs.readFileSync(path.resolve("supabase/config.toml"),"utf8");
  const projectId=config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
  if(!projectId)throw new Error("QA cleanup could not resolve the local Supabase project ID");
  const cleanup=spawnSync("docker",["exec",`supabase_db_${projectId}`,"psql","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres","-c",sql],{encoding:"utf8",timeout:20_000});
  if(cleanup.status!==0)throw new Error(`QA database cleanup failed: ${(cleanup.stderr||cleanup.stdout).trim().slice(0,300)}`);
}
async function exerciseV210Workflows(page,scenario){
  page.setDefaultTimeout(12_000);
  page.setDefaultNavigationTimeout(30_000);
  process.stdout.write("Chromium v2.1 workflow: global search and household member...\n");
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}/dashboard`,{waitUntil:"networkidle"});
  const globalSearch=page.locator(".global-search input");
  await globalSearch.fill(scenario.householdName);
  const householdResult=page.locator(`.global-results a[href="/households?focus=${scenario.householdId}"]`);
  await householdResult.waitFor({state:"visible",timeout:8_000});
  await householdResult.click();
  const householdDrawer=page.locator("[role='dialog'].record-drawer");
  await householdDrawer.waitFor({state:"visible",timeout:8_000});
  await householdDrawer.getByRole("button",{name:"家庭成员联系人"}).click();
  await householdDrawer.getByRole("combobox",{name:"家庭成员联系人"}).fill(scenario.parentName);
  const memberOption=householdDrawer.getByRole("option").filter({hasText:scenario.parentName});
  await memberOption.waitFor({state:"visible",timeout:8_000});
  await memberOption.click();
  await householdDrawer.getByLabel("主要联系人").check();
  await householdDrawer.getByRole("button",{name:"保存家庭成员"}).click();
  await householdDrawer.getByText(scenario.parentName).waitFor({state:"visible",timeout:8_000});
  await householdDrawer.getByRole("button",{name:"关闭"}).click();

  process.stdout.write("Chromium v2.1 workflow: student guardian...\n");
  await page.goto(`${base}/students?focus=${scenario.studentId}`,{waitUntil:"networkidle"});
  const studentDrawer=page.locator("[role='dialog'].record-drawer");
  await studentDrawer.waitFor({state:"visible",timeout:8_000});
  await studentDrawer.getByRole("button",{name:"监护人联系人"}).click();
  await studentDrawer.getByRole("combobox",{name:"监护人联系人"}).fill(scenario.parentName);
  const guardianOption=studentDrawer.getByRole("option").filter({hasText:scenario.parentName});
  await guardianOption.waitFor({state:"visible",timeout:8_000});
  await guardianOption.click();
  await studentDrawer.getByLabel("主要监护人").check();
  await studentDrawer.getByRole("button",{name:"保存监护关系"}).click();
  await studentDrawer.getByText("主要监护人").waitFor({state:"visible",timeout:8_000});
  await studentDrawer.getByRole("button",{name:"关闭"}).click();

  process.stdout.write("Chromium v2.1 workflow: progression preview and apply...\n");
  await page.goto(`${base}/progression`,{waitUntil:"networkidle"});
  await page.getByLabel("来源学年").fill("2025-2026");
  await page.getByLabel("目标学年").fill("2026-2027");
  await page.getByRole("button",{name:"生成预览"}).click();
  const batch=page.locator(".v200-list article").filter({hasText:"2025-2026"});
  await batch.getByRole("button",{name:"复核明细"}).waitFor({state:"visible",timeout:8_000});
  await batch.getByRole("button",{name:"复核明细"}).click();
  const progressionDrawer=page.locator("[role='dialog'].record-drawer");
  await progressionDrawer.getByText(scenario.studentName).waitFor({state:"visible",timeout:8_000});
  await progressionDrawer.getByRole("button",{name:"确认应用"}).click();
  await progressionDrawer.waitFor({state:"hidden",timeout:8_000});
  await page.getByText("升级批次已应用。").waitFor({state:"visible",timeout:8_000});

  process.stdout.write("Chromium v2.1 workflow: household lead conversion...\n");
  await page.goto(`${base}/leads`,{waitUntil:"networkidle"});
  const lead=page.locator(".v200-list article").filter({hasText:scenario.leadName});
  await lead.getByRole("button",{name:"转为商机"}).click();
  const leadDrawer=page.locator("[role='dialog'].record-drawer");
  await leadDrawer.getByLabel("预计金额").fill("12000");
  await leadDrawer.getByRole("button",{name:"转为商机"}).click();
  await leadDrawer.waitFor({state:"hidden",timeout:8_000});
  await page.getByText("线索已转为商机。").waitFor({state:"visible",timeout:8_000});
  process.stdout.write("Chromium v2.1 workflow interactions passed.\n");
}
async function main(){
  if(!fs.existsSync(executable))throw new Error(`Required ms-playwright/chromium-1228 executable is missing: ${executable}`);
  const browser=await chromium.launch({headless:true,executablePath:executable,args:["--disable-gpu"]});
  report.browserVersion=browser.version();
  const identities=[];
  const scenarios=new Map();
  try{
    if(env.QA_SCOPE==="public"){
      const publicContext=await browser.newContext({locale:"zh-CN"});
      const publicPage=await publicContext.newPage();observe(publicPage);
      publicPage.setDefaultTimeout(actionTimeoutMs);
      const routes=(env.QA_ROUTES||"/login,/forgot-password,/reset-password").split(",").filter(Boolean);
      for(const route of routes){
        const label=route.slice(1).replaceAll("/","-");
        await inspect(publicPage,`${label}-1440`,route,{width:1440,height:900});
        await inspect(publicPage,`${label}-375`,route,{width:375,height:812});
      }
      await publicPage.goto(`${base}/login`,{waitUntil:"domcontentloaded"});
      const locale=publicPage.locator("button.locale-switcher");
      if(await locale.isVisible()){await locale.click();await publicPage.waitForFunction(()=>document.documentElement.lang==="en",null,{timeout:5_000}).catch(()=>null);if(await publicPage.locator("html").getAttribute("lang")!=="en")report.errors.push({kind:"locale",url:"/login",message:"English locale did not activate"});}
      await publicContext.close();
    }else if(env.QA_SCOPE==="routes"){
      const role=env.QA_ROLE||"SALES_MANAGER";
      if(!["SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER","SALES_SPECIALIST","SALES_SUPPORT"].includes(role))throw new Error(`Unsupported QA_ROLE ${role}`);
      const identity=await createIdentity(role,env.QA_LABEL||"routes");identities.push(identity);
      const context=await browser.newContext({locale:"zh-CN"});
      await context.addCookies([{name:"crm_access_token",value:identity.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:identity.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
      const page=await context.newPage();observe(page);page.setDefaultTimeout(actionTimeoutMs);
      const routes=(env.QA_ROUTES||"/dashboard").split(",").filter(Boolean);
      const mobile=new Set((env.QA_MOBILE_ROUTES||"").split(",").filter(Boolean));
      const tablet=new Set((env.QA_TABLET_ROUTES||"").split(",").filter(Boolean));
      for(const route of routes){
        const label=route.slice(1).replaceAll("/","-")||"home";
        await inspect(page,`${label}-1440`,route,{width:1440,height:900});
        if(tablet.has(route))await inspect(page,`${label}-1024`,route,{width:1024,height:768});
        if(mobile.has(route))await inspect(page,`${label}-375`,route,{width:375,height:812});
      }
      await context.close();
    }else if(env.QA_SCOPE==="notification"){
      const identity=await createIdentity("SALES_MANAGER","notification");identities.push(identity);
      const context=await browser.newContext({locale:"zh-CN"});
      await context.addCookies([{name:"crm_access_token",value:identity.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:identity.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
      const page=await context.newPage();observe(page);page.setDefaultTimeout(actionTimeoutMs);
      await page.goto(`${base}/settings/notifications`,{waitUntil:"networkidle"});
      const securityEmail=page.getByRole("checkbox",{name:"系统与安全 · 邮件"});
      const securityInApp=page.getByRole("checkbox",{name:"系统与安全 · 站内"});
      if(!await securityEmail.isVisible()||!await securityInApp.isVisible())report.errors.push({kind:"interaction",url:"/settings/notifications",message:"Security notification channel controls are unavailable"});
      else if(await securityEmail.isChecked()&&await securityInApp.isChecked()){
        await securityEmail.evaluate(element=>element.click());
        await page.waitForFunction(()=>document.querySelector('input[aria-label="系统与安全 · 站内"]')?.disabled);
        if(!await securityInApp.isDisabled())report.errors.push({kind:"interaction",url:"/settings/notifications",message:"The final security notification channel can be disabled"});
      }else{
        const lastChannel=await securityEmail.isChecked()?securityEmail:securityInApp;
        if(!await lastChannel.isDisabled())report.errors.push({kind:"interaction",url:"/settings/notifications",message:"The final security notification channel is not protected"});
      }
      process.stdout.write("[QA] pass security notification invariant\n");
      await context.close();
    }else if(env.QA_SCOPE==="workflows"){
      const identity=await createIdentity("SALES_MANAGER","workflows");identities.push(identity);
      const scenario=await seedV210Scenario(identity);scenarios.set(identity.id,scenario);
      const context=await browser.newContext({locale:"zh-CN"});
      await context.addCookies([{name:"crm_access_token",value:identity.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:identity.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
      const page=await context.newPage();observe(page);page.setDefaultTimeout(actionTimeoutMs);
      await exerciseV210Workflows(page,scenario);
      await page.setViewportSize({width:375,height:812});await page.goto(`${base}/dashboard`,{waitUntil:"networkidle"});const menu=page.locator("button.mobile-menu");
      if(await menu.isVisible()){await menu.focus();await menu.press("Enter");if(await menu.getAttribute("aria-expanded")!=="true")report.errors.push({kind:"keyboard",url:"/dashboard",message:"Mobile menu did not open from keyboard"});await page.keyboard.press("Escape");}
      await page.setViewportSize({width:1440,height:900});await page.goto(`${base}/schools`,{waitUntil:"networkidle"});
      const drawerTrigger=page.locator(".page-actions button.primary-button").first();
      if(!await drawerTrigger.isVisible())report.errors.push({kind:"keyboard",url:"/schools",message:"Expected drawer trigger is not visible"});
      else{
        await drawerTrigger.focus();await drawerTrigger.click();
        const dialog=page.locator("[role='dialog'].record-drawer").first();
        await dialog.waitFor({state:"visible",timeout:5_000});
        if(!await dialog.evaluate(element=>element.contains(document.activeElement)))report.errors.push({kind:"keyboard",url:"/schools",message:"Focus did not enter record drawer"});
        await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden",timeout:5_000});
        if(!await drawerTrigger.evaluate(element=>document.activeElement===element))report.errors.push({kind:"keyboard",url:"/schools",message:"Drawer trigger focus was not restored"});
      }
      process.stdout.write("[QA] pass workflow and keyboard interactions\n");
      await context.close();
    }else if(env.QA_SCOPE==="support"){
      const support=await createIdentity("SALES_SUPPORT","support-targeted");identities.push(support);
      const supportContext=await browser.newContext({locale:"zh-CN"});
      await supportContext.addCookies([{name:"crm_access_token",value:support.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:support.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
      const supportPage=await supportContext.newPage();observe(supportPage);supportPage.setDefaultTimeout(actionTimeoutMs);
      await supportPage.goto(`${base}/dashboard`,{waitUntil:"networkidle"});
      const forbiddenLinks=await supportPage.locator('a[href="/imports"],a[href="/duplicates"],a[href="/data-quality"],a[href^="/admin"]').count();
      if(forbiddenLinks)report.errors.push({kind:"permission",url:"/dashboard",message:`Support role exposes ${forbiddenLinks} forbidden navigation link(s)`});
      await supportPage.goto(`${base}/imports`,{waitUntil:"networkidle"});
      if(new URL(supportPage.url()).pathname!=="/dashboard")report.errors.push({kind:"permission",url:"/imports",message:`Support direct route was not redirected (${supportPage.url()})`});
      await inspect(supportPage,"support-leads-1440","/leads",{width:1440,height:900});
      await supportContext.close();
    }else if(env.QA_SCOPE==="admin-security"){
      const admin=await createIdentity("SUPER_ADMIN","admin-targeted");identities.push(admin);
      const adminContext=await browser.newContext({locale:"zh-CN"});
      await adminContext.addCookies([{name:"crm_access_token",value:admin.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:admin.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
      const adminPage=await adminContext.newPage();observe(adminPage);
      adminPage.setDefaultTimeout(actionTimeoutMs);
      await inspect(adminPage,"admin-security-1440","/admin/security",{width:1440,height:900});
      await inspect(adminPage,"admin-security-375","/admin/security",{width:375,height:812});
      await adminContext.close();
    }else{
    const publicContext=await browser.newContext({locale:"zh-CN"});
    const publicPage=await publicContext.newPage();observe(publicPage);
    publicPage.setDefaultTimeout(actionTimeoutMs);
    await inspect(publicPage,"login-1440","/login",{width:1440,height:900});
    await inspect(publicPage,"login-375","/login",{width:375,height:812});
    await inspect(publicPage,"forgot-password-1440","/forgot-password",{width:1440,height:900});
    await inspect(publicPage,"forgot-password-375","/forgot-password",{width:375,height:812});
    await inspect(publicPage,"reset-password-1440","/reset-password",{width:1440,height:900});
    await inspect(publicPage,"reset-password-375","/reset-password",{width:375,height:812});
    const locale=publicPage.locator("button.locale-switcher");
    if(await locale.isVisible()){await locale.click();await publicPage.waitForFunction(()=>document.documentElement.lang==="en",null,{timeout:5_000}).catch(()=>null);await publicPage.waitForLoadState("networkidle",{timeout:5_000}).catch(()=>null);if(await publicPage.locator("html").getAttribute("lang")!=="en")report.errors.push({kind:"locale",url:"/login",message:"English locale did not activate"});}
    await publicContext.close();
    const identity=await createIdentity("SALES_MANAGER","manager");identities.push(identity);
    const scenario=await seedV210Scenario(identity);scenarios.set(identity.id,scenario);
    const context=await browser.newContext({locale:"zh-CN"});
    await context.addCookies([{name:"crm_access_token",value:identity.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:identity.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
    const page=await context.newPage();observe(page);
    page.setDefaultTimeout(actionTimeoutMs);
    const routes=["/dashboard","/schools","/people","/calendar","/tasks","/messages","/products","/finance","/imports","/duplicates","/data-quality","/students","/households","/guardian-portal","/progression","/leads","/growth","/opportunities","/contracts","/sales/performance","/sales/allocation","/analytics/consumption","/automation","/ai","/privacy-requests","/reports","/reports/exports","/reports/marketing","/help","/settings/profile","/settings/account","/settings/notifications","/settings/security","/settings/privacy"];
    for(const route of routes)await inspect(page,`${route.slice(1).replaceAll("/","-")}-1440`,route,{width:1440,height:900});
    for(const route of ["/dashboard","/finance","/imports","/students"])await inspect(page,`${route.slice(1)}-1024`,route,{width:1024,height:768});
    for(const route of ["/dashboard","/calendar","/messages","/finance","/imports","/duplicates","/data-quality","/students","/households","/leads","/opportunities","/contracts","/guardian-portal","/analytics/consumption","/reports","/reports/exports","/help"])await inspect(page,`${route.slice(1).replaceAll("/","-")}-375`,route,{width:375,height:812});
    for(const route of ["/settings/notifications","/settings/security","/settings/privacy"])await inspect(page,`${route.slice(1).replaceAll("/","-")}-375`,route,{width:375,height:812});
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`${base}/settings/notifications`,{waitUntil:"networkidle"});
    const securityEmail=page.getByRole("checkbox",{name:"系统与安全 · 邮件"});
    const securityInApp=page.getByRole("checkbox",{name:"系统与安全 · 站内"});
    if(!await securityEmail.isVisible()||!await securityInApp.isVisible()){
      report.errors.push({kind:"interaction",url:"/settings/notifications",message:"Security notification channel controls are unavailable"});
    }else{
      const emailChecked=await securityEmail.isChecked();
      const inAppChecked=await securityInApp.isChecked();
      if(!emailChecked&&!inAppChecked){
        report.errors.push({kind:"interaction",url:"/settings/notifications",message:"Both security notification channels are disabled"});
      }else if(emailChecked&&inAppChecked){
        await securityEmail.evaluate(element=>element.click());
        await page.waitForFunction(()=>document.querySelector('input[aria-label="系统与安全 · 站内"]')?.disabled);
        if(!await securityInApp.isDisabled())report.errors.push({kind:"interaction",url:"/settings/notifications",message:"The final security notification channel can be disabled"});
      }else{
        const lastChannel=emailChecked?securityEmail:securityInApp;
        if(!await lastChannel.isDisabled())report.errors.push({kind:"interaction",url:"/settings/notifications",message:"The final security notification channel is not protected"});
      }
    }
    await exerciseV210Workflows(page,scenario);
    await page.setViewportSize({width:375,height:812});await page.goto(`${base}/dashboard`,{waitUntil:"networkidle"});const menu=page.locator("button.mobile-menu");
    if(await menu.isVisible()){await menu.focus();await menu.press("Enter");await page.waitForFunction(()=>document.querySelector("button.mobile-menu")?.getAttribute("aria-expanded")==="true",null,{timeout:3_000}).catch(()=>null);if(await menu.getAttribute("aria-expanded")!=="true")report.errors.push({kind:"keyboard",url:"/dashboard",message:"Mobile menu did not open from keyboard"});await page.keyboard.press("Escape");}
    await page.setViewportSize({width:1440,height:900});await page.goto(`${base}/schools`,{waitUntil:"networkidle"});
    const drawerTrigger=page.locator(".page-actions button.primary-button").first();
    if(!await drawerTrigger.isVisible()){
      report.errors.push({kind:"keyboard",url:"/schools",message:"Expected drawer trigger is not visible"});
    }else{
      await drawerTrigger.focus();await drawerTrigger.click();
      const dialog=page.locator("[role='dialog'].record-drawer").first();
      await dialog.waitFor({state:"visible",timeout:5_000}).catch(()=>null);
      if(!await dialog.isVisible())report.errors.push({kind:"keyboard",url:"/schools",message:"Record drawer did not open"});
      else{
        const focusInside=await dialog.evaluate(element=>element.contains(document.activeElement));
        if(!focusInside)report.errors.push({kind:"keyboard",url:"/schools",message:"Focus did not enter record drawer"});
        await page.keyboard.press("Escape");await dialog.waitFor({state:"hidden",timeout:5_000}).catch(()=>null);
        if(await dialog.isVisible())report.errors.push({kind:"keyboard",url:"/schools",message:"Escape did not close record drawer"});
        if(!await drawerTrigger.evaluate(element=>document.activeElement===element))report.errors.push({kind:"keyboard",url:"/schools",message:"Drawer trigger focus was not restored"});
      }
    }
    await context.close();
    const admin=await createIdentity("SUPER_ADMIN","admin");identities.push(admin);
    const adminContext=await browser.newContext({locale:"zh-CN"});
    await adminContext.addCookies([{name:"crm_access_token",value:admin.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:admin.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
    const adminPage=await adminContext.newPage();observe(adminPage);
    adminPage.setDefaultTimeout(actionTimeoutMs);
    await inspect(adminPage,"admin-operations-1440","/admin/operations",{width:1440,height:900});
    await inspect(adminPage,"admin-operations-375","/admin/operations",{width:375,height:812});
    await inspect(adminPage,"admin-dashboard-1440","/admin",{width:1440,height:900});
    await inspect(adminPage,"admin-dashboard-375","/admin",{width:375,height:812});
    await inspect(adminPage,"admin-approvals-1440","/admin/approvals",{width:1440,height:900});
    await inspect(adminPage,"admin-approvals-375","/admin/approvals",{width:375,height:812});
    await inspect(adminPage,"admin-users-1440","/admin/users",{width:1440,height:900});
    await inspect(adminPage,"admin-users-375","/admin/users",{width:375,height:812});
    await inspect(adminPage,"admin-security-1440","/admin/security",{width:1440,height:900});
    await inspect(adminPage,"admin-security-375","/admin/security",{width:375,height:812});
    await adminContext.close();
    const support=await createIdentity("SALES_SUPPORT","support");identities.push(support);
    const supportContext=await browser.newContext({locale:"zh-CN"});
    await supportContext.addCookies([{name:"crm_access_token",value:support.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:support.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
    const supportPage=await supportContext.newPage();observe(supportPage);
    supportPage.setDefaultTimeout(actionTimeoutMs);
    await supportPage.goto(`${base}/dashboard`,{waitUntil:"networkidle"});
    const forbiddenLinks=await supportPage.locator('a[href="/imports"],a[href="/duplicates"],a[href="/data-quality"],a[href^="/admin"]').count();
    if(forbiddenLinks)report.errors.push({kind:"permission",url:"/dashboard",message:`Support role exposes ${forbiddenLinks} forbidden navigation link(s)`});
    await supportPage.goto(`${base}/imports`,{waitUntil:"networkidle"});
    if(new URL(supportPage.url()).pathname!=="/dashboard")report.errors.push({kind:"permission",url:"/imports",message:`Support direct route was not redirected (${supportPage.url()})`});
    await inspect(supportPage,"support-leads-1440","/leads",{width:1440,height:900});
    await supportContext.close();
    }
  }finally{
    for(const identity of identities){
      try{
        await cleanupV210Scenario(identity,scenarios.get(identity.id));
        const response=await fetch(`${identity.supabase}/auth/v1/admin/users/${identity.id}`,{method:"DELETE",headers:identity.headers}).catch(()=>null);
        if(response?.ok)report.identity.cleaned+=1;
        else report.errors.push({kind:"cleanup",url:"",message:`QA identity deletion failed (${response?.status??"network"})`});
      }catch(error){
        report.errors.push({kind:"cleanup",url:"",message:String(error instanceof Error?error.message:error).slice(0,300)});
      }
    }
    if(report.identity.cleaned!==report.identity.created)report.errors.push({kind:"cleanup",url:"",message:`QA identity cleanup incomplete (${report.identity.cleaned}/${report.identity.created})`});
    await browser.close();
    report.durationMs=Date.now()-Date.parse(report.runAt);
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
  }
  if(report.errors.length)throw new Error(`Chromium 1228 QA failed with ${report.errors.length} issue(s); see ${path.join(output,"report.json")}`);
  process.stdout.write(`Chromium 1228 QA passed ${report.pages.length} page/viewport checks with ${report.browserVersion}.\n`);
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
