import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider,useI18n } from "../../components/i18n-provider";
import { AppUserProvider } from "../../components/app-user-context";
import { UserPreferencesProvider } from "../../components/user-preferences-context";
import { CustomerOperationsPanel } from "../../components/customer-operations-panel";
import { CustomerEmailPanel } from "../../components/customer-email-panel";
import { AutomationWorkspace } from "../../components/automation-workspace";
import { zhCN } from "../../lib/i18n/locales/zh-CN";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const rules=["first","second"].map(id=>({id,nameZh:`测试规则 ${id}`,nameEn:`Test rule ${id}`,triggerKey:"MANUAL",conditions:{},actionType:"TASK" as const,actionConfig:{},active:true,version:1,createdAt:"2026-10-01T00:00:00Z"}));
function LocaleButtons(){const {setLocale}=useI18n();return <div><button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button></div>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><main className="page-stack"><LocaleButtons/><CustomerOperationsPanel subject="HOUSEHOLD" id="00000000-0000-4000-8000-000000000001"/><CustomerEmailPanel/><AutomationWorkspace initial={{rules,runs:[]}}/></main></UserPreferencesProvider></AppUserProvider></I18nProvider>);
