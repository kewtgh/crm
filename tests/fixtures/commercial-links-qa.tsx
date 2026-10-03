import {createRoot} from "react-dom/client";
import {useState} from "react";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {PipelinePage} from "../../components/pipeline-page";
import {EducationBusinessWorkspace} from "../../components/education-business-workspace";
import {FinancePage} from "../../components/finance-page";
import {ContractsPage} from "../../components/contracts-page";
import {EnrollmentDetail} from "../../components/enrollment-detail";
import type {OpportunityRecord} from "../../lib/sales-repository";
import type {ContractRecord} from "../../lib/contract-repository";
import type {FinanceOverview} from "../../lib/phase2-repository";
import type {EnrollmentRecord} from "../../lib/enrollment-repository";
import {ids,opportunity,finance,contracts,summary,enrollment} from "./commercial-links-data.mjs";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
const user={id:ids.user,username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
function Fixture(){const {setLocale}=useI18n(),[view,setView]=useState("Opportunity");return <main className="page-stack"><div className="page-actions">{["Opportunity","Event","Quote","Contract","Enrollment"].map(name=><button key={name} onClick={()=>setView(name)}>QA {name}</button>)}<button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button></div>{view==="Opportunity"?<PipelinePage initialItems={[opportunity as OpportunityRecord]} initialTotal={1} initialFunnel={[]} initialCurrency="CNY" initialCurrencies={["CNY"]}/>:view==="Event"?<EducationBusinessWorkspace initialResource="events"/>:view==="Quote"?<FinancePage initial={finance as FinanceOverview}/>:view==="Contract"?<ContractsPage initialContracts={contracts as ContractRecord[]} initialTotal={2} initialSummary={summary} initialSelectedId={ids.contract}/>:<EnrollmentDetail record={enrollment as EnrollmentRecord} onClose={()=>setView("Contract")} onEdit={()=>{}} onRefresh={async()=>{}}/>}</main>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
