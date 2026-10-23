import {useEffect} from "react";
import {createRoot} from "react-dom/client";
import {DataQualityPage} from "../../components/data-quality-page";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {QualityIssue} from "../../lib/phase2-repository";
import {qaNavigate} from "./ux-foundation-navigation";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const items:QualityIssue[]=Array.from({length:10},(_,n)=>({id:id(n+1),revision:1,ruleKey:"CONTACT_METHOD_MISSING",entityType:"TASK",entityId:id(100+n),severity:n%2?"MEDIUM":"HIGH",titleKey:"quality.rule.contactMethodMissing",details:{reference:"Fictional quality reference"},status:n===0?"ASSIGNED":"OPEN",assignedTo:n===0?id(99):null,resolution:"",lastSeenAt:"2026-10-23T00:00:00Z"}));
declare global{interface Window{triageNavigate:(href:string)=>void;triageLocale:(locale:"en"|"zh-CN")=>Promise<void>;}}
function Fixture(){const {setLocale}=useI18n();useEffect(()=>{window.triageNavigate=qaNavigate;window.triageLocale=setLocale;},[setLocale]);return <UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><main style={{padding:16}}><nav className="page-actions"><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button><button onClick={()=>void setLocale("en")}>QA English</button></nav><DataQualityPage initialItems={items} initialTotal={12} initialTrend={[]} initialRules={[{id:id(90),revision:1,ruleKey:"CONTACT_METHOD_MISSING",enabled:true,severity:"HIGH",updatedAt:"2026-10-23T00:00:00Z"}]}/></main></UserPreferencesProvider>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
