/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

const executable=process.env.PLAYWRIGHT_CHROMIUM_1228_PATH||"C:/Users/Horolf/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
const playwrightPath=process.env.PLAYWRIGHT_CORE_PATH||"C:/Users/Horolf/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core";
const {chromium}=require(playwrightPath);
const base=(process.env.QA_BASE_URL||process.env.APP_URL||"http://127.0.0.1:3200").replace(/\/$/,"");
const output=path.resolve(process.env.QA_OUTPUT_DIR||"work/browser-qa-chromium-1228");
fs.mkdirSync(output,{recursive:true});

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
const report={runAt:new Date().toISOString(),browser:"ms-playwright/chromium-1228",executable,browserVersion:"",pages:[],errors:[],warnings:[],identity:{created:0,cleaned:0}};

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
      applicationError:/application error|internal server error/i.test(document.body.innerText),
    };
  });
  const item={label,route,status:response?.status()??null,finalUrl:page.url().replace(base,""),...result};
  report.pages.push(item);
  await page.screenshot({path:path.join(output,`${label}.png`),fullPage:true});
  if(!response?.ok()||item.finalUrl!==route||item.applicationError||!item.h1.length||item.overflow||item.unnamed||item.below12||item.headingSkips.length||item.lowContrast){
    report.errors.push({kind:"inspection",url:route,message:JSON.stringify(item)});
  }
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
  if(role==="SALES_MANAGER"){
    const {elevateQaSessionToAal2}=await import("./lib/qa-auth.mjs");
    return{id:created.id,supabase,headers,token:await elevateQaSessionToAal2({supabaseUrl:supabase,anonKey:anon,accessToken:token.access_token,friendlyName:`chromium-1228-${suffix}`})};
  }
  return{id:created.id,supabase,headers,token};
}
async function main(){
  if(!fs.existsSync(executable))throw new Error(`Required ms-playwright/chromium-1228 executable is missing: ${executable}`);
  const browser=await chromium.launch({headless:true,executablePath:executable,args:["--disable-gpu"]});
  report.browserVersion=browser.version();
  const identities=[];
  try{
    const publicContext=await browser.newContext({locale:"zh-CN"});
    const publicPage=await publicContext.newPage();observe(publicPage);
    await inspect(publicPage,"login-1440","/login",{width:1440,height:900});
    await inspect(publicPage,"login-375","/login",{width:375,height:812});
    const locale=publicPage.locator("button.locale-switcher");
    if(await locale.isVisible()){await locale.click();await publicPage.waitForFunction(()=>document.documentElement.lang==="en",null,{timeout:5_000}).catch(()=>null);await publicPage.waitForLoadState("networkidle",{timeout:5_000}).catch(()=>null);if(await publicPage.locator("html").getAttribute("lang")!=="en")report.errors.push({kind:"locale",url:"/login",message:"English locale did not activate"});}
    await publicContext.close();
    const identity=await createIdentity("SALES_MANAGER","manager");identities.push(identity);
    const context=await browser.newContext({locale:"zh-CN"});
    await context.addCookies([{name:"crm_access_token",value:identity.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:identity.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
    const page=await context.newPage();observe(page);
    const routes=["/dashboard","/schools","/people","/tasks","/products","/finance","/imports","/students","/households","/leads","/ai","/privacy-requests"];
    for(const route of routes)await inspect(page,`${route.slice(1).replaceAll("/","-")}-1440`,route,{width:1440,height:900});
    for(const route of ["/dashboard","/finance","/imports","/students"])await inspect(page,`${route.slice(1)}-1024`,route,{width:1024,height:768});
    for(const route of ["/dashboard","/finance","/imports","/students"])await inspect(page,`${route.slice(1)}-375`,route,{width:375,height:812});
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
    const support=await createIdentity("SALES_SUPPORT","support");identities.push(support);
    const supportContext=await browser.newContext({locale:"zh-CN"});
    await supportContext.addCookies([{name:"crm_access_token",value:support.token.access_token,url:base,httpOnly:true,sameSite:"Lax"},{name:"crm_refresh_token",value:support.token.refresh_token,url:base,httpOnly:true,sameSite:"Lax"}]);
    const supportPage=await supportContext.newPage();observe(supportPage);
    await supportPage.goto(`${base}/dashboard`,{waitUntil:"networkidle"});
    const forbiddenLinks=await supportPage.locator('a[href="/imports"],a[href="/duplicates"],a[href="/data-quality"],a[href^="/admin"]').count();
    if(forbiddenLinks)report.errors.push({kind:"permission",url:"/dashboard",message:`Support role exposes ${forbiddenLinks} forbidden navigation link(s)`});
    await supportPage.goto(`${base}/imports`,{waitUntil:"networkidle"});
    if(new URL(supportPage.url()).pathname!=="/dashboard")report.errors.push({kind:"permission",url:"/imports",message:`Support direct route was not redirected (${supportPage.url()})`});
    await inspect(supportPage,"support-leads-1440","/leads",{width:1440,height:900});
    await supportContext.close();
  }finally{
    for(const identity of identities){const response=await fetch(`${identity.supabase}/auth/v1/admin/users/${identity.id}`,{method:"DELETE",headers:identity.headers}).catch(()=>null);if(response?.ok)report.identity.cleaned+=1;}
    await browser.close();
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
  }
  if(report.identity.cleaned!==report.identity.created)report.errors.push({kind:"cleanup",url:"",message:`QA identity cleanup incomplete (${report.identity.cleaned}/${report.identity.created})`});
  if(report.errors.length)throw new Error(`Chromium 1228 QA failed with ${report.errors.length} issue(s); see ${path.join(output,"report.json")}`);
  process.stdout.write(`Chromium 1228 QA passed ${report.pages.length} page/viewport checks with ${report.browserVersion}.\n`);
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
