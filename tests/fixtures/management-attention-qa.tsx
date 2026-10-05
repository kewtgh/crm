import {useState} from "react";import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {ExecutiveOverviewPage} from "../../components/executive-overview-page";
import {ManagementAttentionWorkspace} from "../../components/management-attention-workspace";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
function Fixture(){const {setLocale}=useI18n(),[queue,setQueue]=useState(false),[reset,setReset]=useState(0);return <main onClick={e=>{const a=(e.target as Element).closest('a');if(a?.getAttribute('href')?.startsWith('/reports/executive/attention')){e.preventDefault();setQueue(true);}}}><div className="page-actions"><button onClick={()=>void setLocale('en')}>QA English</button><button onClick={()=>void setLocale('zh-CN')}>QA 中文</button><button onClick={()=>{setQueue(false);setReset(n=>n+1);}}>QA Reset</button></div>{queue?<ManagementAttentionWorkspace key={reset}/>:<ExecutiveOverviewPage key={reset}/>}</main>;}
createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:'Asia/Taipei',dateFormat:'yyyy-MM-dd'}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
