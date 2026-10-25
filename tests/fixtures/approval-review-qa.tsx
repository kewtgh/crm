import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {ApprovalCenterPage} from "../../components/approval-center-page";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {qaNavigate} from "./ux-foundation-navigation";
import {approvalId,approvalInitial} from "./approval-review-data";
import type {AppRole} from "../../lib/roles";
declare global {interface Window {approvalNavigate:(href:string)=>void;approvalLocale:(locale:"en"|"zh-CN")=>void;approvalRole:(role:AppRole)=>void;approvalInitialFailure:(failed:boolean)=>void;}}
function Fixture(){
 const {locale,setLocale}=useI18n(),[role,setRole]=useState<AppRole>("ADMIN"),[failed,setFailed]=useState(false),[generation,setGeneration]=useState(0);
 useEffect(()=>{window.approvalNavigate=qaNavigate;window.approvalLocale=locale=>void setLocale(locale);window.approvalRole=setRole;window.approvalInitialFailure=value=>{setFailed(value);setGeneration(value=>value+1);};},[setLocale]);
 const user={id:approvalId(99),username:"fictional-approval",email:"reviewer@example.test",displayName:"Reviewer A",displayNameZh:"示例审批人",role,initials:"RA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 const initial=role==="ADMIN"?approvalInitial:{...approvalInitial,items:approvalInitial.items.map(row=>({...row,canDecide:false}))};
 return <AppShell key={role} user={user} relationshipHealth={{hasData:false,score:0,weeklyDelta:0,sampleSize:0,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale={locale}><ApprovalCenterPage key={generation} initialPage={failed?null:initial}/></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
