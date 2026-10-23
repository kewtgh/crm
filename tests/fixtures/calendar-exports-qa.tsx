import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {CalendarPage} from "../../components/calendar-page";
import {ExportsPage} from "../../components/exports-page";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {dateKeyFor} from "../../lib/timezone";
import type {CalendarRecord} from "../../lib/calendar-repository";
import type {GeneratedJobPage} from "../../lib/generated-jobs-repository";

const today=dateKeyFor(new Date(),"Asia/Taipei"),target=today.slice(0,8)+"10";
export const calendarFixture:CalendarRecord[]=Array.from({length:13},(_,index)=>({id:`00000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,eventVersion:1,date:target,time:`${String(8+Math.floor(index/4)).padStart(2,"0")}:${String(index%4*15).padStart(2,"0")}`,title:`示例预约 ${index+1}`,titleEn:`Example appointment ${index+1}`,related:"Fictional Academy",type:"meeting",channel:"Teams",reminder:"calendar.reminder.day",deliveryStatus:"NONE"}));
const ready={id:"aaaaaaaa-0000-4000-8000-000000000001",type:"CRM_EXPORT" as const,format:"CSV" as const,status:"READY" as const,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),errorMessage:null};
const exportFixture:GeneratedJobPage={items:[ready,{...ready,id:"bbbbbbbb-0000-4000-8000-000000000002",expiresAt:"2020-01-01T00:00:00Z"}],total:2,page:1,pageSize:10};
declare global {interface Window{workflowView:(name:string)=>void;workflowLocale:(locale:"en"|"zh-CN")=>Promise<void>;}}
function Fixture(){const {setLocale}=useI18n(),[view,setView]=useState({name:"calendar",key:0});useEffect(()=>{window.workflowView=name=>setView(previous=>({name,key:previous.key+1}));window.workflowLocale=setLocale;},[setLocale]);return <UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><main style={{padding:16}} data-qa-view={view.name}><nav className="page-actions"><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button><button onClick={()=>void setLocale("en")}>QA English</button></nav>{view.name==="calendar"?<CalendarPage key={view.key} initialCalendarEvents={calendarFixture} persistent/>:<ExportsPage key={view.key} initialPage={view.name==="exports-page2"?{...exportFixture,items:[ready],page:2,total:11}:exportFixture}/>}</main></UserPreferencesProvider>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
