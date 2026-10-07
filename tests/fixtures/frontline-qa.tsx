import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {LeadPoolWorkspace} from "../../components/lead-pool-workspace";
import {DashboardPage} from "../../components/dashboard-page";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {AppRole} from "../../lib/roles";
import {usePathname,qaNavigate} from "./ux-foundation-navigation";
import {frontlineLeads,frontlineSnapshot,frontlineId} from "./frontline";
declare global {interface Window {frontNavigate:(href:string)=>void;frontScenario:(name:string)=>void;frontAccount:(account:number,role:AppRole)=>void;}}
function English(){const {setLocale}=useI18n();return <button onClick={()=>void setLocale("en")}>QA English</button>;}
function Fixture(){
 const [revision,setRevision]=useState(0),[scenario,setScenario]=useState("normal"),[role,setRole]=useState<AppRole>("ADMIN"),[account,setAccount]=useState(99),pathname=usePathname();
 useEffect(()=>{window.frontNavigate=href=>{qaNavigate(href);setRevision(n=>n+1);};window.frontScenario=name=>{setScenario(name);setRevision(n=>n+1);};window.frontAccount=(account,role)=>{setAccount(account);setRole(role);};},[]);
 const user={id:frontlineId(account),username:"advisor-a",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"顾问甲",role,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 const leads=frontlineLeads.map(l=>({...l,...(scenario==="readonly"?{can_edit:false,can_assign:false}:{}),...(scenario==="long-name"?{subject_name_zh:"示例国际跨学科学习与发展教育机构甲：长双语名称压力测试",subject_name_en:"Example International Academy for Global Education and Student Development with an Independently Fictional Long Name",next_action:"",owner_id:frontlineId(99),is_mine:true,can_edit:true}:{})}));
 const snapshot={...frontlineSnapshot,...(scenario==="empty-today"?{focusTasks:[],todayTasks:0,overdueTasks:0}:{}),...(scenario==="growth-failed"?{growthUnavailable:true}: {})};
 return <AppShell user={user} relationshipHealth={{hasData:true,score:78,weeklyDelta:3,sampleSize:12,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale="zh-CN"><div key={`${pathname}:${revision}:${account}:${role}`}>{pathname==="/leads"?<LeadPoolWorkspace initial={{items:leads,total:leads.length,page:1,pageSize:20}}/>:<DashboardPage initialSnapshot={snapshot}/>}<English/></div></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
