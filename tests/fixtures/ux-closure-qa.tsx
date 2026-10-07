import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {ContractsPage} from "../../components/contracts-page";
import {ProductsPage} from "../../components/products-page";
import {ImportsPage} from "../../components/imports-page";
import {DataQualityPage} from "../../components/data-quality-page";
import {ActionCenterPage} from "../../components/action-center-page";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {ProductRecord} from "../../lib/product-repository";
import type {ActionCenterSnapshot} from "../../lib/action-center-repository";
import type {ImportBatchRecord} from "../../lib/phase2-repository";
import {usePathname,useSearchParams,qaNavigate} from "./ux-foundation-navigation";
import type {AppRole} from "../../lib/roles";
export const closureId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const closureContracts=[{id:closureId(1),customer:"示例国际教育与学生发展机构长名称",english:"Example International Academy for Global Education and Student Development",start:"2026-01-01",end:"2027-01-01",days:86,value:12000,currency:"USD",owner:"Advisor A",status:"ACTIVE" as const,relationLevel:1 as const},{id:closureId(2),customer:"示例家庭甲",english:"Example Household A",start:"2026-01-01",end:"2027-01-01",days:86,value:3000,currency:"CNY",owner:"Advisor A",status:"DRAFT" as const,relationLevel:1 as const}];
export const closureSummary={validCount:1,renewalCount:0,under30Count:0,riskCount:0,renewalByCurrency:{},lifecycle:{draft:1,active:1,preparing:0,negotiating:0,risk:0},renewalAlerts:[]};
export const closureBatch:ImportBatchRecord={id:closureId(50),resourceType:"CONTACTS",filename:"synthetic-contacts.csv",status:"PARTIAL_FAILED",total:1,valid:0,invalid:1,duplicates:0,applied:0,failed:0,createdAt:"2026-10-07T00:00:00Z",templateVersion:"2",executionContract:"CANONICAL_V2"};
const product:ProductRecord={id:closureId(30),nameZh:"示例跨学科学习与国际学生发展课程长名称",nameEn:"Example International Interdisciplinary Learning and Student Development Program",code:"EXAMPLE-PROGRAM",descriptionZhMarkdown:"独立虚构课程",descriptionEnMarkdown:"Independently fictional program",price:100,prices:[{currency:"USD",amount:100,effectiveFrom:"2026-01-01"}],metrics:{},purchasers:[],billing:"products.billing.project",billingCode:"PROJECT",duration:"一年",durationEn:"One year",customers:0,revenue:0,active:true,lifecycleStatus:"ACTIVE",isDefault:false,currency:"USD",updatedAt:"2026-10-07T00:00:00Z"};
const action:ActionCenterSnapshot={role:"ADMIN",generatedAt:"2026-10-07T00:00:00Z",total:3,urgent:1,items:[{id:"tasks",category:"work",priority:"urgent",count:1,titleKey:"actionCenter.item.overdueTasks",detailKey:"actionCenter.item.overdueTasksHelp",href:"/tasks",source:"live_aggregate"},{id:"renewals",category:"sales",priority:"normal",count:2,titleKey:"actionCenter.item.renewals",detailKey:"actionCenter.item.renewalsHelp",href:"/contracts",source:"live_aggregate"}]};
declare global {interface Window {closureNavigate:(href:string)=>void;closureRole:(role:AppRole)=>void;}}
function Fixture(){const pathname=usePathname(),params=useSearchParams(),[role,setRole]=useState<AppRole>("ADMIN"),{setLocale}=useI18n();useEffect(()=>{window.closureNavigate=qaNavigate;window.closureRole=setRole;},[]);
 const user={id:closureId(99),username:"advisor-a",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"顾问甲",role,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 return <AppShell user={user} preferredLocale="zh-CN" preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} relationshipHealth={{hasData:true,score:78,weeklyDelta:3,sampleSize:12,basis:"RELATIONSHIP_MILESTONES"}}><div key={pathname+params.toString()}>
 {pathname==="/contracts"?<ContractsPage initialContracts={closureContracts} initialSummary={closureSummary} initialTotal={2} initialSelectedId={params.get("focus")??""}/>:pathname==="/products"?<ProductsPage initialProducts={[product]} initialBundles={[]} initialExchangeRates={[]}/>:pathname==="/imports"?<ImportsPage initialItems={[closureBatch]} initialTotal={1}/>:pathname==="/data-quality"?<DataQualityPage initialItems={[{id:closureId(60),ruleKey:"CONTACT_METHOD_MISSING",titleKey:"quality.rule.contactMethodMissing",entityType:"CONTACT",entityId:closureId(61),severity:"HIGH",status:"OPEN",assignedTo:null,resolution:"",lastSeenAt:"2026-10-07T00:00:00Z",details:{reference:closureId(61),unsafe:"Synthetic private diagnostic: SELECT * FROM example"}}]} initialTotal={1} initialTrend={[]} initialRules={[{id:closureId(62),ruleKey:"CONTACT_METHOD_MISSING",enabled:true,severity:"HIGH",updatedAt:"2026-10-07T00:00:00Z"}]}/>:<ActionCenterPage snapshot={action}/>}
 <button className="text-button" onClick={()=>void setLocale("en")}>QA English</button></div></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
