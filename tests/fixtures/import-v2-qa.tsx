import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ImportsPage} from '../../components/imports-page';
import {I18nProvider,useI18n} from '../../components/i18n-provider';
import {AppUserProvider} from '../../components/app-user-context';
import {UserPreferencesProvider} from '../../components/user-preferences-context';
import {zhCN} from '../../lib/i18n/locales/zh-CN';
import type {AppUser} from '../../lib/user';
const user:AppUser={id:'00000000-0000-4000-8000-000000000090',role:'ADMIN',username:'qa-import',email:'qa-import@example.test',displayName:'QA',displayNameZh:'测试',initials:'QA',mustChangePassword:false,mfaEnabled:true,aal:'aal2',emailVerified:true,accountStatus:'ACTIVE'};
function Fixture(){const {setLocale}=useI18n(),[reset,setReset]=useState(0);return <main className="app-frame" style={{display:'block',padding:16,minWidth:0}}><div className="page-actions"><button onClick={()=>void setLocale('en')}>QA English</button><button onClick={()=>void setLocale('zh-CN')}>QA 中文</button><button onClick={()=>setReset(v=>v+1)}>QA Reset</button></div><ImportsPage key={reset} initialItems={[]} initialTotal={0}/></main>;}
createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:'Asia/Taipei',dateFormat:'yyyy-MM-dd'}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
