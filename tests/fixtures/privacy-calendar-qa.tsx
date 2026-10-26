import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PrivacyRequestsWorkspace} from '../../components/privacy-requests-workspace';
import {CalendarPage} from '../../components/calendar-page';
import {AppUserProvider} from '../../components/app-user-context';
import {I18nProvider,useI18n} from '../../components/i18n-provider';
import {UserPreferencesProvider} from '../../components/user-preferences-context';
import {zhCN} from '../../lib/i18n/locales/zh-CN';
import {dateKeyFor} from '../../lib/timezone';
import {reviewUser,privacyFixture,calendarHistoryFixture} from './privacy-calendar-data';
import {qaNavigate} from './ux-foundation-navigation';
declare global{interface Window{privacyCalendarView:(name:string)=>void;privacyCalendarLocale:(locale:'en'|'zh-CN')=>Promise<void>;}}
function Fixture(){const {setLocale}=useI18n(),[view,setView]=useState({name:'privacy',key:0});useEffect(()=>{window.privacyCalendarView=name=>{qaNavigate(name==='privacy'?'/privacy-requests':'/calendar');setView(value=>({name,key:value.key+1}));};window.privacyCalendarLocale=setLocale;},[setLocale]);return <AppUserProvider user={reviewUser}><UserPreferencesProvider initialPreferences={{timezone:'Asia/Taipei',dateFormat:'yyyy-MM-dd'}}><main style={{padding:16}}>{view.name==='privacy'?<PrivacyRequestsWorkspace key={view.key} initial={privacyFixture}/>:<CalendarPage key={view.key} initialDate={dateKeyFor(new Date(),'Asia/Taipei')} initialCalendarEvents={calendarHistoryFixture(dateKeyFor(new Date(),'Asia/Taipei'))} persistent/>}</main></UserPreferencesProvider></AppUserProvider>;}
createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
