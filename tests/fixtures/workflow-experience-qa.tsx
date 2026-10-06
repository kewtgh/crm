import {useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {ModulePage} from "../../components/module-page";
import {moduleConfigs} from "../../lib/crm-data";
import {StudentsWorkspace} from "../../components/v200-workspaces";
import {CustomerOperationsPanel} from "../../components/customer-operations-panel";
import {ImportsPage} from "../../components/imports-page";
import {DataQualityPage} from "../../components/data-quality-page";
import {LeadPoolWorkspace} from "../../components/lead-pool-workspace";
import {StudentSuccessWorkspace} from "../../components/student-success-workspace";
import {CohortParticipants} from "../../components/cohort-participants";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const empty={items:[],total:0,page:1,pageSize:20};
const student={id:id(3),personId:id(4),nameZh:"学生甲",nameEn:"Student A",householdZh:"示例家庭",householdEn:"Example Household",studentNumber:"TEST-A",grade:"G5",academicYear:"2026-2027",status:"ACTIVE",updatedAt:"2026-10-01T00:00:00Z",familyMembers:[{contactId:id(5),relationship:"FATHER",nameZh:"家长甲",nameEn:"Parent A"}]};
const user={id:id(99),username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
function Fixture(){const {setLocale}=useI18n(),[screen,setScreen]=useState("schools");return <main className="page-stack"><nav className="page-actions">{["schools","people","organization","students","imports","quality","leads","support","participants"].map(s=><button key={s} onClick={()=>setScreen(s)}>QA {s}</button>)}<button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button></nav><div key={screen}>
{screen==="schools"||screen==="people"?<ModulePage config={{...moduleConfigs[screen],rows:[]}} resource={screen}/>:screen==="organization"?<CustomerOperationsPanel subject="ORGANIZATION" id={id(1)}/>:screen==="students"?<StudentsWorkspace initial={{...empty,items:[student],total:1}}/>:screen==="imports"?<ImportsPage initialItems={[]} initialTotal={0}/>:screen==="quality"?<DataQualityPage initialItems={[]} initialTotal={0} initialTrend={[]} initialRules={[{id:id(8),ruleKey:"CONTACT_METHOD_MISSING",enabled:true,severity:"MEDIUM",updatedAt:"2026-10-01T00:00:00Z"}]}/>:screen==="leads"?<LeadPoolWorkspace initial={empty}/>:screen==="support"?<StudentSuccessWorkspace initial={empty}/>:<CohortParticipants cohortId={id(7)}/>}
</div></main>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
