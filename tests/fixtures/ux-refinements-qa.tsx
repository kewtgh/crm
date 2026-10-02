import { createRoot } from "react-dom/client";
import { useState } from "react";
import { I18nProvider } from "../../components/i18n-provider";
import { AppUserProvider } from "../../components/app-user-context";
import { UserPreferencesProvider } from "../../components/user-preferences-context";
import { UserAvatar } from "../../components/user-avatar";
import { DataQualityPage } from "../../components/data-quality-page";
import { OperationsCenterPage } from "../../components/operations-center-page";
import { CalendarPage } from "../../components/calendar-page";
import { ImportsPage } from "../../components/imports-page";
import { CustomerEmailPanel } from "../../components/customer-email-panel";
import { CommunicationsInboxPage } from "../../components/communications-inbox-page";
import { PortalWorkspace } from "../../components/portal-workspace";
import { zhCN } from "../../lib/i18n/locales/zh-CN";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const inboxItems=["a","b","c"].map(id=>({id:`thread-${id}`,contactId:id,contactZh:`客户 ${id}`,contactEn:`Customer ${id}`,email:`${id}@example.test`,subject:`会话 ${id}`,channel:"EMAIL",purpose:"SERVICE",status:"OPEN",lastMessageAt:null}));
function Fixture(){
  const [view,setView]=useState("quality");
  const [role,setRole]=useState<"ADMIN"|"SALES_SPECIALIST">("ADMIN");
  return <AppUserProvider user={{...user,role}}><main className="page-stack" style={{maxWidth:1200,margin:"auto",padding:16}}>
    <div className="email-filter-actions"><span className="profile-trigger"><UserAvatar initials="QA" source="/api/settings/avatar?v=qa"/></span>{["quality","workers","calendar","imports","email","inbox","portal"].map(value=><button className="secondary-button" type="button" key={value} onClick={()=>setView(value)}>QA {value}</button>)}</div>
    <button type="button" className="secondary-button" onClick={()=>setRole(role==="ADMIN"?"SALES_SPECIALIST":"ADMIN")}>QA {role==="ADMIN"?"sales":"admin"}</button>
    {view==="quality"&&<DataQualityPage initialItems={[]} initialTotal={0} initialTrend={[]} initialRules={[{id:"rule",ruleKey:"CONTACT_METHOD_MISSING",enabled:true,severity:"HIGH",updatedAt:"2026-10-02"},{id:"rule2",ruleKey:"ORGANIZATION_OWNER_MISSING",enabled:true,severity:"MEDIUM",updatedAt:"2026-10-02"}]}/>}
    {view==="workers"&&<OperationsCenterPage initialSnapshot={{generatedAt:"2026-10-02T00:00:00Z",queues:[],workers:[{key:"communications",lastSeenAt:"2026-10-02T00:00:00Z",lastSuccessAt:"2026-10-02T00:00:00Z",lastFailureAt:null,consecutiveFailures:0,lastError:null,stale:false,metadata:{}},{key:"notification-outbox",lastSeenAt:"2026-10-02T00:00:00Z",lastSuccessAt:null,lastFailureAt:"2026-10-02T00:00:00Z",consecutiveFailures:2,lastError:"Example failure detail to verify wrapping",stale:false,metadata:{}}]}} initialRetryableJobs={{items:[],total:0,page:1,pageSize:10}} initialIntegrations={[]} initialNextActions={{items:[],total:0,page:1,pageSize:10}} initialInsights={null} initialReadiness={null} initialLoadFailed={false} aiProviderConfigured={false}/>}
    {view==="calendar"&&<CalendarPage/>}
    {view==="imports"&&<ImportsPage initialItems={[]} initialTotal={0}/>}
    {view==="email"&&<CustomerEmailPanel/>}
    {view==="inbox"&&<CommunicationsInboxPage initial={{items:inboxItems,total:3,page:1,pageSize:20}} initialThread={{...inboxItems[0],messages:[],messageTotal:0,messagePage:1,messagePageSize:20}}/>}
    {view==="portal"&&<PortalWorkspace initial={{invitations:[],updates:[]}}/>}
  </main></AppUserProvider>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
