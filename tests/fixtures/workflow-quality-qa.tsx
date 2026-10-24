import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {TaskWorkspacePanel} from "../../components/task-workspace";
import {DataTable} from "../../components/data-table";
import {moduleConfigs} from "../../lib/crm-data";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {TaskWorkspace} from "../../lib/task-workspace-repository";
import {qaNavigate,usePathname} from "./ux-foundation-navigation";

export const qualityId=(number:number)=>`00000000-0000-4000-8000-${String(number).padStart(12,"0")}`;
export const qualityWorkspace:TaskWorkspace={canViewTeam:false,capacity:[],items:Array.from({length:25},(_,index)=>({
  id:qualityId(index+1),titleZh:`示例任务 ${index+1}`,titleEn:`Example Task ${index+1}`,
  related:"Fictional Academy",status:"TODO",priority:"NORMAL",ownerId:qualityId(index===24?98:99),ownerName:index===24?"Advisor B":"Advisor A",
  dueAt:new Date().toISOString(),slaDueAt:null,revision:1,
}))};
declare global {interface Window {qualityNavigate:(href:string)=>void;qualityRefresh:()=>void;}}
const user={id:qualityId(99),username:"fictional-advisor",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"示例顾问",role:"SALES_SPECIALIST" as const,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
function Fixture(){
  const {setLocale}=useI18n(),pathname=usePathname(),[refreshKey,setRefreshKey]=useState(0),[viewsOpen,setViewsOpen]=useState(false);
  useEffect(()=>{window.qualityNavigate=qaNavigate;window.qualityRefresh=()=>setRefreshKey(value=>value+1);},[]);
  return <main className="page-stack" style={{padding:16}}><nav className="page-actions"><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button><button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>setViewsOpen(true)}>QA Views</button></nav>
    {pathname==="/schools"?<DataTable config={moduleConfigs.schools} resource="schools" initialTotal={0} savedViewsOpen={viewsOpen} onCloseSavedViews={()=>setViewsOpen(false)}/>:<TaskWorkspacePanel initial={qualityWorkspace} refreshKey={refreshKey} onMutated={()=>setRefreshKey(value=>value+1)}/>}
    <section id="record-list">Fictional complete record list</section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
