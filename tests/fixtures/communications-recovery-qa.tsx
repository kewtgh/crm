import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {CommunicationsInboxPage} from "../../components/communications-inbox-page";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {qaNavigate} from "./ux-foundation-navigation";
import {communicationInitial,communicationInitialThread,communicationId} from "./communications-recovery-data";
import type {AppRole} from "../../lib/roles";

declare global {interface Window {commsNavigate:(href:string)=>void;commsLocale:(locale:"en"|"zh-CN")=>void;commsRole:(role:AppRole)=>void;commsInitialFailure:(failed:boolean)=>void;}}
function Fixture(){
 const {locale,setLocale}=useI18n(),[role,setRole]=useState<AppRole>("SALES_SPECIALIST"),[failed,setFailed]=useState(false),[generation,setGeneration]=useState(0);
 useEffect(()=>{window.commsNavigate=qaNavigate;window.commsLocale=locale=>void setLocale(locale);window.commsRole=setRole;window.commsInitialFailure=value=>{setFailed(value);setGeneration(value=>value+1);};},[setLocale]);
 const user={id:communicationId(99),username:"fictional-comms",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"示例顾问",role,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 return <AppShell key={role} user={user} relationshipHealth={{hasData:false,score:0,weeklyDelta:0,sampleSize:0,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale={locale}><CommunicationsInboxPage key={generation} initial={failed?null:communicationInitial} initialThread={failed?null:communicationInitialThread}/></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
