import { createRoot } from "react-dom/client";
import { useState } from "react";
import { I18nProvider } from "../../components/i18n-provider";
import { AppUserProvider } from "../../components/app-user-context";
import { UserPreferencesProvider } from "../../components/user-preferences-context";
import { CustomerOperationsPanel } from "../../components/customer-operations-panel";
import { ProductsPage } from "../../components/products-page";
import { AssistanceWorkspaceHeader } from "../../components/assistance-workspace-header";
import { zhCN } from "../../lib/i18n/locales/zh-CN";
import type { ProductRecord } from "../../lib/product-repository";
import type { CustomerSubject } from "../../lib/customer-operations";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const product: ProductRecord={id:"product",nameZh:"国际教育咨询服务",nameEn:"Education advisory",code:"ADVISORY",descriptionZhMarkdown:"### 持续支持\n根据学校需求制定服务计划。",descriptionEnMarkdown:"Advisory services",price:12345.67,currency:"CNY",prices:[{currency:"CNY",amount:12345.67,effectiveFrom:"2026-10-01"},{currency:"USD",amount:1800.25,effectiveFrom:"2026-10-01"}],metrics:{CNY:{revenue:1000.12,customers:1}},purchasers:[{organizationId:"school",nameZh:"测试学校",nameEn:"Test school",contractId:"contract",contractNumber:"LUM-001",contractStatus:"ACTIVE",relationshipLevel:2,currency:"CNY",contractValue:1000.12,confirmedSpend:1000.12}],billing:"products.billing.project",billingCode:"PROJECT",duration:"三个月",durationEn:"Three months",customers:1,revenue:1000.12,active:true,lifecycleStatus:"ACTIVE",isDefault:false,updatedAt:"2026-10-01T00:00:00Z"};
function Fixture(){
  const [subject,setSubject]=useState<CustomerSubject>("ORGANIZATION");
  return <main className="page-stack" style={{maxWidth:1280,margin:"auto",padding:16}}><div className="page-actions">{(["ORGANIZATION","CONTACT","HOUSEHOLD"] as const).map(value=><button className="secondary-button" key={value} onClick={()=>setSubject(value)}>{value}</button>)}</div><CustomerOperationsPanel key={subject} subject={subject} id="00000000-0000-4000-8000-000000000001" extra={subject==="CONTACT"?<p>通信授权内容</p>:undefined}/><ProductsPage initialProducts={[product]} initialBundles={[]} initialExchangeRates={[]}/><AssistanceWorkspaceHeader active="/ai"/></main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
