/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
module.exports=async({browser,base,output,report,observe})=>{
 const context=await browser.newContext({bypassCSP:true}),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,empty={items:[],total:0,page:1,pageSize:20};
 try{const page=await context.newPage();observe(page);page.setDefaultTimeout(3000);const health=await page.goto(base+'/api/health');assert.equal((await health.json()).version,report.evidence.appVersion);
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url());let data=empty;
 if(u.pathname==='/api/customer-operations')data={subject:'ORGANIZATION',id:id(1),nameZh:'示例机构',nameEn:'Example Organization',profile:{},level:1,plan:null,entries:[],entryTotal:0,completed:0,contacts:[],contracts:[],opportunities:[],students:[],products:[],limited:false,canManage:true};
 else if(u.pathname.endsWith('/commercial'))data={organization:{id:id(1),status:'HEALTHY'},profile:null,contacts:[],intelligence:[],relationships:[],outcomes:[],opportunities:[],canManage:true,limited:false};
 else if(u.pathname.endsWith('/activation'))data={projection:{leads:[],events:[]},history:[]};
 else if(u.pathname==='/api/enrollments')data={...empty,total:1,items:[{id:id(9),student_id:id(3),student_name_zh:'学生甲',student_name_en:'Student A',status:'ACTIVE'}]};
 else if(u.pathname==='/api/education'&&u.searchParams.get('id'))data={item:{id:id(3),personId:id(4),nameZh:'学生甲',nameEn:'Student A',grade:'G5',academicYear:'2026-2027',status:'ACTIVE',householdId:'',householdZh:'',householdEn:'',studentNumber:'TEST-A',birthDate:'',currentClass:'',personalityMarkdown:'',learningExpectationsMarkdown:'',strengthsMarkdown:'',supportNeedsMarkdown:'',interests:[],preferredLearningStyle:'',academicRecords:[],guardians:[],updatedAt:'2026-10-01T00:00:00Z'}};
 else if(u.pathname.startsWith('/api/crm/'))data={...empty,metrics:{total:0,needsAttention:0,averageCompleteness:0}};
 else if(u.pathname==='/api/catalog')data={bundles:[],exchangeRates:[]};
 await r.fulfill({json:data});});
 const bundle=await build({entryPoints:['tests/fixtures/workflow-experience-qa.tsx'],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'chrome145',alias:{'next/link':path.resolve('tests/fixtures/qa-link.tsx'),'next/navigation':path.resolve('tests/fixtures/qa-navigation.ts')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
 await page.setContent('<html><head><title>Synthetic workflow QA</title></head><body><div id="root"></div></body></html>');
 for(const f of fs.readdirSync('dist/client/_next/static',{recursive:true}).filter(f=>f.endsWith('.css')))await page.addStyleTag({url:`${base}/_next/static/${f.replaceAll('\\','/')}`});await page.addScriptTag({content:bundle.outputFiles[0].text});
 for(const locale of ['zh-CN','en'])for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await page.getByRole('button',{name:locale==='en'?'QA English':'QA 中文',exact:true}).click();
 for(const screen of ['schools','people','organization','students','imports','quality','leads','support','participants']){await page.getByRole('button',{name:'QA '+screen,exact:true}).click();await page.waitForTimeout(120);
 if(screen==='schools')assert.equal(await page.locator('.channel-account-filters').count(),1);
 if(screen==='people')assert.ok(await page.locator('.search-filter-bar').count());
 if(screen==='organization'){
 await page.getByRole('tab',{name:locale==='en'?'Institution contacts':'机构联系人',exact:true}).click();
 await page.getByRole('button',{name:locale==='en'?'Add contact':'添加联系人',exact:true}).click();await page.getByRole('dialog').locator('[name="email"]').waitFor();await page.keyboard.press('Escape');
 await page.getByRole('tab',{name:locale==='en'?'Contracts & products':'合同与产品',exact:true}).click();
 await page.getByRole('button',{name:locale==='en'?'New contract draft':'新建合同草稿',exact:true}).click();await page.getByRole('dialog').locator('[name="number"]').waitFor();await page.keyboard.press('Escape');
 await page.getByRole('tab',{name:locale==='en'?'Commercial':'商业经营',exact:true}).click();await page.locator('.commercial-section-picker').waitFor();assert.equal(await page.locator('.commercial-section-picker button').count(),4);
 await page.getByRole('button',{name:locale==='en'?'Contact collaboration':'联系人协作',exact:true}).click();
 }
 if(screen==='students'){await page.getByText(locale==='en'?'Parent A':'家长甲',{exact:false}).waitFor();await page.getByRole('button',{name:locale==='en'?'Details':'详情',exact:true}).first().click();await page.getByRole('dialog').waitFor();await page.getByRole('tab',{name:locale==='en'?'Family details':'家庭资料',exact:true}).click();await page.keyboard.press('Escape');}
 if(screen==='imports')assert.equal(await page.locator('select').filter({has:page.locator('option[value="LEGACY_UNVERSIONED"]')}).count(),0);
 if(screen==='participants'){await page.getByRole('button',{name:locale==='en'?'Participating students':'参与学生',exact:true}).click();await page.getByRole('link',{name:locale==='en'?'Student A':'学生甲',exact:true}).waitFor();}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${screen} ${locale} ${width} overflow`);
 await page.screenshot({path:path.join(output,`experience-${screen}-${locale}-${width}.png`),fullPage:true});report.pages.push({path:'experience/'+screen,locale,width,status:'PASS'});
 }}
 report.pages.push({path:'experience/boundary',status:'PASS',boundary:'Actual components and production CSS with synthetic mocked business APIs. Real PostgreSQL verifies roles, annual calendar, retry, family search, draft revision and contract history separately.'});
 }finally{await context.close();}
};
