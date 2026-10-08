import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {StaffUsersPage} from "../../components/staff-users-page";
import {StaffBusinessEditor} from "../../components/staff-business-editor";
import {StaffRemovalDialog} from "../../components/staff-removal-dialog";
import {StaffRoleEditor} from "../../components/staff-role-editor";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {StaffUserRecord} from "../../lib/admin-users-repository";

export const fictionalStaff:StaffUserRecord={id:"00000000-0000-4000-8000-000000000401",username:"fictional.staff",displayNameZh:"示例员工",displayNameEn:"Fictional Staff",email:"staff@example.test",role:"SALES_SPECIALIST",status:"ACTIVE",lastSignInAt:null,mfaEnabled:true,onboardingStatus:"ACTIVE",invitationDeliveryStatus:null,teams:[],businessProfile:{revision:1,primaryFunction:"SALES",additionalFunctions:[],salesEligible:false,effectiveFrom:null,configuredEligibility:false,updatedBy:null,updatedAt:null,reason:null}};
declare global {interface Window {staffQaMode:(mode:string)=>void;staffQaRefreshFails:boolean;}}
function Fixture(){
 const [mode,setMode]=useState("list"),{setLocale}=useI18n();useEffect(()=>{window.staffQaMode=setMode;},[]);
 const saved=async()=>{if(window.staffQaRefreshFails)throw new Error("Fictional refresh unavailable");setMode("list");};
 const user={id:"00000000-0000-4000-8000-000000000499",username:"fictional.admin",email:"admin@example.test",displayName:"Fictional Admin",displayNameZh:"示例管理员",role:"SUPER_ADMIN" as const,initials:"FA",mustChangePassword:false,accountStatus:"ACTIVE" as const,mfaEnabled:true,aal:"aal2" as const,emailVerified:true};
 return <AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><main>
 <div className="detail-actions"><button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button></div>
 <StaffUsersPage initialItems={[fictionalStaff]} initialTotal={1}/>
 {mode==="business"&&<StaffBusinessEditor user={fictionalStaff} onClose={()=>setMode("list")} onSaved={saved}/>}
 {mode==="role"&&<StaffRoleEditor user={fictionalStaff} actorRole="ADMIN" onClose={()=>setMode("list")} onSaved={saved}/>}
 {mode==="remove"&&<StaffRemovalDialog user={fictionalStaff} onClose={()=>setMode("list")} onSaved={saved}/>}
 </main></UserPreferencesProvider></AppUserProvider>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
