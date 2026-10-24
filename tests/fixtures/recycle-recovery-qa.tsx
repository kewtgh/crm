import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {RecycleBinPage} from "../../components/recycle-bin-page";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {qaNavigate} from "./ux-foundation-navigation";
import {recoveryInitial,recoveryId} from "./recycle-recovery-data";
import type {AppRole} from "../../lib/roles";

declare global {interface Window {recoveryNavigate:(href:string)=>void;recoveryLocale:(locale:"en"|"zh-CN")=>void;recoveryScope:(personal:boolean)=>void;recoveryInitialFailure:()=>void;}}
function Fixture(){
 const {setLocale}=useI18n(),[personal,setPersonal]=useState(true),[generation,setGeneration]=useState(0),[failedInitial,setFailedInitial]=useState(false);
 useEffect(()=>{window.recoveryNavigate=qaNavigate;window.recoveryLocale=locale=>void setLocale(locale);window.recoveryScope=value=>{setPersonal(value);setFailedInitial(false);setGeneration(value=>value+1);};window.recoveryInitialFailure=()=>{setFailedInitial(true);setGeneration(value=>value+1);};},[setLocale]);
 const role:AppRole=personal?"SALES_SPECIALIST":"SUPER_ADMIN";
 const user={id:recoveryId(99),username:"fictional-recovery",email:"recovery@example.test",displayName:"Advisor A",displayNameZh:"示例顾问",role,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 return <AppShell key={String(personal)} user={user} relationshipHealth={{hasData:false,score:0,weeklyDelta:0,sampleSize:0,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale="zh-CN"><RecycleBinPage key={generation} personal={personal} initial={failedInitial?null:{...recoveryInitial,scope:personal?"personal":"workspace"}}/></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
