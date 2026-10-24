import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {TaskWorkspacePanel} from "../../components/task-workspace";
import {DashboardPage} from "../../components/dashboard-page";
import {NotificationCenterPage} from "../../components/notification-center-page";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {frontlineSnapshot,frontlineId} from "./frontline";
import {qualityWorkspace} from "./daily-work-data";
import {qaNavigate,usePathname} from "./ux-foundation-navigation";
import type {AppRole} from "../../lib/roles";

export const dailyNotifications=[1,2].map(n=>({id:frontlineId(70+n),kind:"TASK",titleKey:"nav.notifications",bodyKey:"notifications.description",values:{},sourceType:"TASK",sourceId:frontlineId(n),createdAt:"2026-10-25T02:00:00Z"}));
declare global {interface Window {dailyNavigate:(href:string)=>void;dailyRole:(role:AppRole)=>void;dailyLocale:(locale:"en"|"zh-CN")=>void;}}
function Content(){
 const path=usePathname(),{setLocale}=useI18n(),[refreshKey,setRefreshKey]=useState(0);
 useEffect(()=>{window.dailyLocale=locale=>void setLocale(locale);},[setLocale]);
 return path==="/dashboard"?<DashboardPage initialSnapshot={frontlineSnapshot}/>:path==="/notifications"?<NotificationCenterPage initialItems={dailyNotifications} initialTotal={dailyNotifications.length}/>:<><TaskWorkspacePanel initial={qualityWorkspace} refreshKey={refreshKey} onMutated={()=>setRefreshKey(value=>value+1)}/><section id="record-list">Fictional complete record list</section></>;
}
function Fixture(){
 const [role,setRole]=useState<AppRole>("SALES_SPECIALIST");
 useEffect(()=>{window.dailyNavigate=qaNavigate;window.dailyRole=setRole;},[]);
 const user={id:frontlineId(99),username:"fictional-advisor",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"示例顾问",role,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 return <AppShell key={role} user={user} relationshipHealth={{hasData:false,score:0,weeklyDelta:0,sampleSize:0,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale="zh-CN"><Content/></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
