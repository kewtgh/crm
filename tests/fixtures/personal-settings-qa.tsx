import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {SettingsPage} from "../../components/settings-page";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {qaNavigate} from "./ux-foundation-navigation";
import {personalId} from "./personal-settings-data";
import {useUserPreferences} from "../../components/user-preferences-context";
declare global{interface Window{personalView:(section:string)=>void;personalLocale:(locale:"en"|"zh-CN")=>Promise<void>;personalUnavailable:(value:boolean)=>void;personalGuard:()=>boolean;}}
function PreferenceGuardProbe(){const {localDateTimeToIso}=useUserPreferences();useEffect(()=>{window.personalGuard=()=>{try{return Boolean(localDateTimeToIso("2030-01-01T10:30"));}catch{return false;}};},[localDateTimeToIso]);return null;}
function Fixture(){
 const {locale,setLocale}=useI18n(),[view,setView]=useState({section:"notifications",revision:0}),[unavailable,setUnavailable]=useState(false);
 useEffect(()=>{window.personalLocale=setLocale;window.personalUnavailable=setUnavailable;window.personalView=section=>{qaNavigate("/settings/"+section);setView(value=>({section,revision:value.revision+1}));};},[setLocale]);
 const user={id:personalId(99),username:"fictional-reviewer",email:"reviewer@example.test",displayName:"Fictional Reviewer",displayNameZh:"示例用户",role:"ADMIN" as const,initials:"FR",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 return <><span hidden data-personal-section={view.section}/><AppShell key={String(unavailable)} user={user} relationshipHealth={{hasData:false,score:0,weeklyDelta:0,sampleSize:0,basis:"RELATIONSHIP_MILESTONES"}} preferencesUnavailable={unavailable} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale={locale}><PreferenceGuardProbe/><SettingsPage key={view.section+":"+view.revision} section={view.section}/></AppShell></>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
