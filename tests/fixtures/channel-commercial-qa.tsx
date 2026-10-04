import {useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {CustomerOperationsPanel} from "../../components/customer-operations-panel";
import {DataTable} from "../../components/data-table";
import {moduleConfigs} from "../../lib/crm-data";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
function Fixture(){const {setLocale}=useI18n(),[view,setView]=useState("organization");return <main className="page-stack"><div className="page-actions"><button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button><button onClick={()=>setView("organization")}>QA Organization</button><button onClick={()=>setView("contact")}>QA Contact</button><button onClick={()=>setView("schools")}>QA Schools</button></div>{view==="schools"?<DataTable config={moduleConfigs.schools} resource="schools"/>:<CustomerOperationsPanel key={view} subject={view==="organization"?"ORGANIZATION":"CONTACT"} id={view==="organization"?"00000000-0000-4000-8000-000000000001":"00000000-0000-4000-8000-000000000002"}/>}</main>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
