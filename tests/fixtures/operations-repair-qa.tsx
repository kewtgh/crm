import {useEffect} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider} from "../../components/i18n-provider";
import {RecordCleanupWorkspace} from "../../components/record-cleanup-workspace";
import {AcademicCorrection} from "../../components/academic-correction";
import {EnrollmentsWorkspace} from "../../components/enrollments-workspace";
import {ApplicationsWorkspace} from "../../components/applications-workspace";
import {repairEnrollment,repairApplication} from "./operations-repair-data";
import {ModulePage} from "../../components/module-page";
import {StudentsWorkspace,HouseholdsWorkspace} from "../../components/v200-workspaces";
import {moduleConfigs} from "../../lib/crm-data";
import {studentRecord,householdRecord} from "./record-workspaces";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {usePathname,qaNavigate} from "./ux-foundation-navigation";
declare global {interface Window{repairNavigate:(href:string)=>void;}}
function Fixture(){
 const pathname=usePathname();
 useEffect(()=>{window.repairNavigate=qaNavigate;},[]);
 const user={id:"00000000-0000-4000-8000-000000000099",username:"advisor-a",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"顾问甲",role:"ADMIN" as const,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 return <AppShell user={user} relationshipHealth={{hasData:true,score:78,weeklyDelta:3,sampleSize:12,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale="zh-CN">
  {pathname==="/enrollments"?<EnrollmentsWorkspace initial={{items:[repairEnrollment],total:1,page:1,pageSize:20}}/>:pathname==="/applications"?<ApplicationsWorkspace initial={{items:[repairApplication],total:1,page:1,pageSize:20}}/>:pathname==="/people"?<ModulePage config={moduleConfigs.people} resource="people"/>:pathname==="/students"?<StudentsWorkspace initial={{items:[studentRecord],total:1,page:1,pageSize:10}}/>:pathname==="/households"?<HouseholdsWorkspace initial={{items:[householdRecord],total:1,page:1,pageSize:10}}/>:pathname==="/progression"?<AcademicCorrection/>:<RecordCleanupWorkspace/>}
 </AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
