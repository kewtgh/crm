import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {CalendarEditor} from "../../components/calendar-editor";
import {DateInput} from "../../components/structured-inputs";
import {ProductsPage} from "../../components/products-page";
import {ContractsPage} from "../../components/contracts-page";
import {FinancePage} from "../../components/finance-page";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {financeChartFixture,financeId} from "./analytics-finance";
import {qaNavigate} from "./ux-foundation-navigation";
import {discoveryContract,discoveryContractSummary} from "./global-discovery-data";
import type {ProductRecord} from "../../lib/product-repository";
import type {AppRole} from "../../lib/roles";
import type {CalendarRecord} from "../../lib/calendar-repository";

declare global {interface Window{discoveryLocale:(locale:"en"|"zh-CN")=>Promise<void>;discoveryView:(view:string)=>void;discoveryRole:(role:AppRole)=>void;discoveryNavigate:(href:string)=>void;}}
export const discoveryProduct:ProductRecord={id:financeId(60),nameZh:"示例课程",nameEn:"Fictional Program",code:"EX-PROGRAM",descriptionZhMarkdown:"示例课程介绍",descriptionEnMarkdown:"Fictional program overview",price:100,prices:[{currency:"USD",amount:100,effectiveFrom:"2026-01-01"}],metrics:{},purchasers:[],billing:"products.billing.project",billingCode:"PROJECT",duration:"一年",durationEn:"One year",customers:0,revenue:0,active:true,lifecycleStatus:"ACTIVE",isDefault:false,currency:"USD",updatedAt:"2026-10-01T00:00:00Z"};
function CompactInputs(){
 const year=new Date().getFullYear(),[date,setDate]=useState(`${year}-10-01`),[result,setResult]=useState("");
 return <section className="surface"><form id="compact-input-form" onSubmit={event=>{event.preventDefault();setResult(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))));}}>
  <label className="field"><span>Compact date</span><DateInput name="date" value={date} onChange={event=>setDate(event.target.value)} min={`${year}-01-01`} max={`${year}-12-31`} required/></label>
  <label className="field"><span>Compact time</span><DateInput name="time" type="time" defaultValue="10:00" required/></label>
  <label className="field"><span>Month</span><DateInput name="month" type="month" defaultValue={`${year}-10`} required/></label>
  <label className="field"><span>Date and time</span><DateInput name="stamp" type="datetime-local" defaultValue={`${year}-10-05T08:03`} required/></label>
  <button type="submit">Check values</button><output data-form-output>{result}</output>
 </form></section>;
}
function Fixture(){
 const {locale,setLocale}=useI18n(),[role,setRole]=useState<AppRole>("ADMIN"),[view,setView]=useState({name:"search",revision:0}),[saved,setSaved]=useState<CalendarRecord|null>(null);
 useEffect(()=>{window.discoveryLocale=setLocale;window.discoveryView=name=>{setSaved(null);setView(value=>({name,revision:value.revision+1}));};window.discoveryRole=setRole;window.discoveryNavigate=qaNavigate;},[setLocale]);
 const user={id:financeId(99),username:"fictional-discovery",email:"reviewer@example.test",displayName:"Fictional Reviewer",displayNameZh:"示例审阅人",role,initials:"FR",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
 let content:React.ReactNode=<section className="surface"><h1>Fictional discovery workspace</h1><p>Independent search and scheduling fixtures.</p></section>;
 if(view.name==="calendar")content=saved?<output data-calendar-saved>{JSON.stringify(saved)}</output>:<CalendarEditor key={view.revision} date="2030-10-01" persistent onClose={()=>window.discoveryView("search")} onSaved={setSaved} onWriting={()=>{}} onSettled={()=>{}}/>;
 if(view.name==="inputs")content=<CompactInputs key={view.revision}/>;
 if(view.name==="product")content=<ProductsPage key={view.revision} initialProducts={[discoveryProduct]} initialBundles={[]} initialExchangeRates={[]} initialFocus={discoveryProduct.id}/>;
 if(view.name==="contract")content=<ContractsPage key={view.revision} initialContracts={[discoveryContract]} initialTotal={1} initialSummary={discoveryContractSummary} initialFocus={discoveryContract.id} initialSelectedId={discoveryContract.id} persistent/>;
 if(view.name==="quote")content=<FinancePage key={view.revision} initial={financeChartFixture()} initialQuoteId={financeId(1)}/>;
 return <><span hidden data-discovery-role={role}/><AppShell key={role} user={user} relationshipHealth={{hasData:false,score:0,weeklyDelta:0,sampleSize:0,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale={locale}>{content}</AppShell></>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
