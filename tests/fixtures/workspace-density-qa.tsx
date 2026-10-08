import {SettingsPage} from "../../components/settings-page";
import {HelpPage} from "../../components/help-page";
import {StudentSuccessAnalytics} from "../../components/student-success-analytics";
import {FinancePage} from "../../components/finance-page";
import {financeChartFixture} from "./analytics-finance";
import {SuccessOutcomeWorkspace} from "../../components/student-success-outcome-workspace";
import {StaffRoleEditor} from "../../components/staff-role-editor";
import {RevenueWorkspaceView} from "../../components/revenue-workspace";
import {SuccessOutcomesPanel} from "../../components/student-success-outcomes-panel";
import {managementDrillData} from "./management-drill-data";
import type {SuccessCase} from "../../lib/student-success-repository";
import {useEffect,useState,useRef} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {Customer360Page} from "../../components/customer-360-page";
import {ContactWorkspace} from "../../components/contact-workspace";
import {StudentsWorkspace,ProgressionWorkspace} from "../../components/v200-workspaces";
import {HouseholdsWorkspace} from "../../components/v200-workspaces";
import {householdRecord} from "./record-workspaces";
import {ExecutiveOverviewPage} from "../../components/executive-overview-page";
import {ChannelAnalyticsPage} from "../../components/channel-analytics-page";
import {ChannelAgreementsPanel} from "../../components/channel-agreements-panel";
import {WorkflowTemplateEditor} from "../../components/workflow-template-editor";
import {OperationsCenterPage} from "../../components/operations-center-page";
import {ProductsPage} from "../../components/products-page";
import {ImportsPage} from "../../components/imports-page";
import {LeadPoolWorkspace} from "../../components/lead-pool-workspace";
import {studentRecord,accountRecord,recordId} from "./record-workspaces";
import {frontlineLeads} from "./frontline";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {AppRole} from "../../lib/roles";
import {usePathname,qaNavigate} from "./ux-foundation-navigation";
import {contactFixture,productFixture,importFixture} from "./workspace-redesign";
declare global {interface Window {workspaceNavigate:(href:string)=>void;workspaceScenario:(name:string)=>void;workspaceRole:(role:AppRole)=>void;}}
function Fixture(){
  const refreshAttempts=useRef(0);
  const pathname=usePathname(),[revision,setRevision]=useState(0),[scenario,setScenario]=useState("normal"),[role,setRole]=useState<AppRole>("ADMIN"),{setLocale}=useI18n();
  useEffect(()=>{window.workspaceNavigate=href=>{qaNavigate(href);setRevision(v=>v+1);};window.workspaceScenario=name=>{refreshAttempts.current=0;setScenario(name);setRevision(v=>v+1);};window.workspaceRole=setRole;},[]);
  const user={id:recordId(99),username:"advisor-a",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"顾问甲",role,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
  const student={...studentRecord,...(scenario==="no-family"?{householdId:"",guardians:[]}:{}),...(scenario==="long"?{nameZh:"学生甲：示例跨学科学习与国际交流发展档案长双语身份测试",nameEn:"Student A — Example International Interdisciplinary Learning and Development Long Identity"}:{})};
  const organization={...accountRecord,...(scenario==="long"?{nameZh:"示例国际跨学科学习与学生发展教育机构长双语身份测试",nameEn:"Example International Academy for Interdisciplinary Learning and Student Development Long Identity"}:{})};
  return <AppShell user={user} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale="zh-CN" relationshipHealth={{hasData:true,score:78,weeklyDelta:3,sampleSize:12,basis:"RELATIONSHIP_MILESTONES"}}><div key={`${pathname}:${revision}:${role}`}>
    {pathname==="/settings/profile"?<SettingsPage section="profile"/>:pathname==="/help"?<HelpPage/>:pathname==="/finance"?<FinancePage initial={{...financeChartFixture(),...(scenario==="empty-finance"?{quotes:[],quoteTotal:0,collectionSeries:[],contracts:[],contractTotal:0,receivables:[],receivableTotal:0,payments:[],paymentTotal:0}: {})}}/>:(pathname==="/support-analytics"||pathname==="/student-success")?<StudentSuccessAnalytics/>:pathname==="/global-outcomes"?<SuccessOutcomeWorkspace filters={{}}/>:pathname==="/staff-role"?<StaffRoleEditor actorRole={role} user={{id:recordId(401),username:"fictional.employee",displayNameZh:"示例员工",displayNameEn:"Fictional Employee",email:"employee@example.test",role:"SALES_SPECIALIST",status:"ACTIVE",lastSignInAt:null,mfaEnabled:true,onboardingStatus:"ACTIVE",invitationDeliveryStatus:null,teams:[]}} onClose={()=>qaNavigate("/products")} onSaved={async()=>{if(scenario==="role-refresh-failure"&&refreshAttempts.current++===0)throw new Error("Synthetic refresh failure");qaNavigate("/products");}}/>:pathname==="/revenue"?<RevenueWorkspaceView initial={scenario==="configured-empty"?{state:"READY",entities:[],queue:[],facts:[],recognized:[],candidate_totals:[]}:{state:scenario==="no-access"?"NO_DESIGNATION":"NO_CONFIGURATION",entities:[]}}/>:pathname==="/outcomes"?<SuccessOutcomesPanel onRefresh={async()=>{}} onEditing={()=>{}} record={{...managementDrillData("atRiskCases").items[0],can_edit:true} as unknown as SuccessCase}/>:pathname==="/workflow-templates"?<WorkflowTemplateEditor onClose={()=>qaNavigate("/products")} onSaved={async()=>{if(scenario==="refresh-failure"&&refreshAttempts.current++===0)throw new Error("Synthetic refresh failure");qaNavigate("/products");}}/>:pathname==="/reports/executive"?<ExecutiveOverviewPage/>:pathname==="/reports/channels"?<ChannelAnalyticsPage/>:pathname==="/commissions"?<ChannelAgreementsPanel organizationId={recordId(1)}/>:pathname==="/admin/operations"?<OperationsCenterPage initialSnapshot={{generatedAt:"2026-10-08T00:00:00Z",queues:[],workers:[]}} initialRetryableJobs={{items:[],total:0,page:1,pageSize:10}} initialIntegrations={[]} initialNextActions={{items:[],total:0,page:1,pageSize:10}} initialInsights={null} initialReadiness={null} initialLoadFailed={false} aiProviderConfigured={false}/>:pathname==="/duplicates"?<ImportsPage duplicatesOnly initialItems={[]} initialTotal={0}/>:pathname==="/households"?<HouseholdsWorkspace initial={{items:[householdRecord],total:1,page:1,pageSize:10}}/>:pathname.startsWith("/schools/")?<Customer360Page initial={organization}/>:pathname.startsWith("/people/")?<ContactWorkspace initial={{...contactFixture,canManageConsent:scenario!=="manager",consentHistory:[],...(scenario==="long"?{nameZh:"示例机构联系人甲：跨学科项目与学生发展国际合作协调负责人",nameEn:"Advisor A — Example International Interdisciplinary Program and Student Development Coordinator"}:{})}}/>:pathname==="/students"?<StudentsWorkspace initial={{items:[student],total:1,page:1,pageSize:10}} />:pathname==="/products"?<ProductsPage initialProducts={[productFixture]} initialBundles={[]} initialExchangeRates={[]}/>:pathname==="/leads"?<LeadPoolWorkspace initial={{items:frontlineLeads,total:frontlineLeads.length,page:1,pageSize:20}}/>:pathname==="/progression"?<ProgressionWorkspace initial={{items:[],total:0,page:1,pageSize:10}}/>:<ImportsPage initialItems={[importFixture]} initialTotal={1}/>}
    <button className="text-button qa-locale" onClick={()=>void setLocale("zh-CN")}>QA 中文</button>
    <button className="text-button qa-locale" onClick={()=>void setLocale("en")}>QA English</button>
  </div></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
