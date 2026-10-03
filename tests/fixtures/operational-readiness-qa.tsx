import {createRoot} from "react-dom/client";
import {useState} from "react";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {FinancePage} from "../../components/finance-page";
import {EnrollmentDetail} from "../../components/enrollment-detail";
import {CohortEnrollmentSnapshot} from "../../components/cohort-enrollment-snapshot";
import {ImportsPage} from "../../components/imports-page";
import {DataQualityPage} from "../../components/data-quality-page";
import {AutomationWorkspace} from "../../components/automation-workspace";
import type {FinanceOverview,QualityIssue} from "../../lib/phase2-repository";
import type {EnrollmentRecord} from "../../lib/enrollment-repository";
import {ids,finance,enrollment} from "./commercial-links-data.mjs";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
const user={id:ids.user,username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const issue:QualityIssue={id:ids.enrollment,ruleKey:"ENROLLMENT_ACTIVE_WITHOUT_CONTRACT",entityType:"ENROLLMENT",entityId:ids.enrollment,severity:"MEDIUM",titleKey:"quality.rule.ENROLLMENT_ACTIVE_WITHOUT_CONTRACT",details:{reference:ids.enrollment},status:"OPEN",assignedTo:null,resolution:"",lastSeenAt:"2026-10-04T00:00:00Z"};
function Fixture(){const {setLocale}=useI18n(),[view,setView]=useState("Enrollment");return <main className="page-stack"><div className="page-actions">{["Enrollment","Finance","Cohort","Import","Quality","Automation"].map(name=><button key={name} onClick={()=>setView(name)}>QA {name}</button>)}<button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button></div>
 {view==="Enrollment"?<EnrollmentDetail record={enrollment as EnrollmentRecord} onClose={()=>setView("Finance")} onEdit={()=>{}} onRefresh={async()=>{}}/>:view==="Finance"?<FinancePage initial={finance as FinanceOverview}/>:view==="Cohort"?<section className="surface"><h2>GAPP Fall 2027</h2><CohortEnrollmentSnapshot cohortId={ids.cohort}/></section>:view==="Import"?<ImportsPage initialItems={[]} initialTotal={0}/>:view==="Quality"?<DataQualityPage initialItems={[issue]} initialTotal={1} initialTrend={[]} initialRules={[]}/>:<AutomationWorkspace initial={{rules:[],runs:[]}}/>}
 </main>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
