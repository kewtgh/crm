import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, useI18n } from "../../components/i18n-provider";
import { AppUserProvider } from "../../components/app-user-context";
import { UserPreferencesProvider } from "../../components/user-preferences-context";
import { ProductsPage } from "../../components/products-page";
import type { ProductRecord } from "../../lib/product-repository";
import { zhCN } from "../../lib/i18n/locales/zh-CN";
const user = {id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const product: ProductRecord = {id:"00000000-0000-4000-8000-000000000001",nameZh:"GAPP 产品",nameEn:"GAPP Product",code:"GAPP",descriptionZhMarkdown:"产品介绍",descriptionEnMarkdown:"Product introduction",price:100,prices:[{currency:"USD",amount:100,effectiveFrom:"2026-01-01"}],metrics:{},purchasers:[],billing:"products.billing.project",billingCode:"PROJECT",duration:"一年",durationEn:"One year",customers:0,revenue:0,active:true,lifecycleStatus:"ACTIVE",isDefault:false,currency:"USD",updatedAt:"2026-10-03T00:00:00Z"};
function Fixture() {
  const {setLocale} = useI18n(); const [readOnly, setReadOnly] = useState(false);
  return <><div><button onClick={() => void setLocale("en")}>QA English</button><button onClick={() => void setLocale("zh-CN")}>QA 中文</button><button onClick={() => setReadOnly(value => !value)}>QA Read only</button></div><AppUserProvider user={{...user, role: readOnly ? "SALES_SPECIALIST" : "ADMIN"}}><ProductsPage key={String(readOnly)} initialProducts={[product]} initialBundles={[]} initialExchangeRates={[]}/></AppUserProvider></>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></I18nProvider>);
