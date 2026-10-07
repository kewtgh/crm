import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../../components/app-shell";
import { I18nProvider, useI18n } from "../../components/i18n-provider";
import { StudentsWorkspace, HouseholdsWorkspace } from "../../components/v200-workspaces";
import { Customer360Page } from "../../components/customer-360-page";
import { ModulePage } from "../../components/module-page";
import { moduleConfigs } from "../../lib/crm-data";
import { zhCN } from "../../lib/i18n/locales/zh-CN";
import { studentRecord, householdRecord, accountRecord } from "./record-workspaces";
import { usePathname, useSearchParams, qaNavigate } from "./ux-foundation-navigation";
import type { AppRole } from "../../lib/roles";
declare global { interface Window { recordNavigate: (href: string) => void; recordScenario: (name: string) => void; recordRole: (role: AppRole) => void; } }
function LocaleControl() { const { setLocale } = useI18n(); return <button className="text-button" onClick={()=>void setLocale("en")}>QA English</button>; }
function Fixture() {
  const [revision,setRevision]=useState(0),[scenario,setScenario]=useState("normal"),[role,setRole]=useState<AppRole>("ADMIN");
  const pathname=usePathname(),params=useSearchParams();
  useEffect(()=>{window.recordNavigate=href=>{qaNavigate(href);setRevision(value=>value+1);};window.recordScenario=name=>{setScenario(name);setRevision(value=>value+1);};window.recordRole=setRole;},[]);
  const user={id:"00000000-0000-4000-8000-000000000099",username:"advisor-a",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"顾问甲",role,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
  const student={...studentRecord,...(scenario==="no-household"?{householdId:"",householdZh:"",householdEn:"",guardians:[]}:{}),...(scenario==="long-name"?{nameZh:"学生甲：示例跨学科学习与发展档案及国际交流探索学习记录",nameEn:"Student A — Example International Interdisciplinary Education and Long Name Development Profile"}:{})};
  return <AppShell user={user} relationshipHealth={{hasData:true,score:78,weeklyDelta:3,sampleSize:12,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale="zh-CN"><div key={`${pathname}:${revision}`}>
    {pathname==="/schools"?<ModulePage config={moduleConfigs.schools} resource="schools"/>:pathname.startsWith("/schools/")?<Customer360Page initial={accountRecord}/>:pathname==="/households"&&params.get("tab")==="families"?<HouseholdsWorkspace initial={{items:[householdRecord],total:1,page:1,pageSize:10}} initialDetail={params.has("focus")?householdRecord:null}/>:<StudentsWorkspace initial={{items:[student],total:1,page:1,pageSize:10}} initialDetail={params.has("focus")?student:null}/>}<LocaleControl/>
  </div></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
