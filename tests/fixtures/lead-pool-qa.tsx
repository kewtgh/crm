import {useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {LeadPoolWorkspace} from "../../components/lead-pool-workspace";
import {ChannelActivationPanel} from "../../components/channel-activation-panel";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
function Fixture(){const {setLocale}=useI18n(),[view,setView]=useState("leads");return <main className="page-stack"><div className="page-actions"><button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button><button onClick={()=>setView("leads")}>QA Leads</button><button onClick={()=>setView("activation")}>QA Activation</button></div>{view==="leads"?<LeadPoolWorkspace initial={{items:[],total:0,page:1,pageSize:20}}/>:<ChannelActivationPanel organizationId="00000000-0000-4000-8000-000000000001"/>}</main>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
