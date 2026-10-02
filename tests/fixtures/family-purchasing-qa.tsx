import { createRoot } from "react-dom/client";
import { useState } from "react";
import { I18nProvider } from "../../components/i18n-provider";
import { AppUserProvider } from "../../components/app-user-context";
import { UserPreferencesProvider } from "../../components/user-preferences-context";
import { ContractsPage } from "../../components/contracts-page";
import { FinancePage } from "../../components/finance-page";
import { zhCN } from "../../lib/i18n/locales/zh-CN";
import type { FinanceOverview } from "../../lib/phase2-repository";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const summary={validCount:0,renewalCount:0,under30Count:0,riskCount:0,renewalByCurrency:{},lifecycle:{draft:0,active:0,preparing:0,negotiating:0,risk:0},renewalAlerts:[]};
const initial:FinanceOverview={quotes:[],quoteTotal:0,contracts:[],contractTotal:0,receivables:[],receivableTotal:0,payments:[],paymentTotal:0,refunds:[],refundTotal:0,reconciliations:[],reconciliationTotal:0,pageSize:10,risk:{openReceivables:0,overdueReceivables:0,pendingRefunds:0,reconciliationExceptions:0},products:[{id:"00000000-0000-4000-8000-000000000004",code:"FOUNDATION",nameZh:"大学预科",nameEn:"Foundation"}],bundles:[],exchangeRates:[]};
function Fixture(){const [finance,setFinance]=useState(false);return <main className="page-stack"><button onClick={()=>setFinance(!finance)}>QA switch</button>{finance?<FinancePage initial={initial}/>:<ContractsPage initialSummary={summary}/>}</main>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
