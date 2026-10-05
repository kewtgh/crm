import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {I18nProvider,useI18n} from '../../components/i18n-provider';
import {ContractDocumentsSection} from '../../components/contract-documents-section';
import {zhCN} from '../../lib/i18n/locales/zh-CN';
function Fixture(){const {setLocale}=useI18n(),[kind,setKind]=useState<'CUSTOMER_CONTRACT'|'CHANNEL_AGREEMENT_VERSION'>('CUSTOMER_CONTRACT'),[reset,setReset]=useState(0);return <main className="page-stack" style={{padding:16,minWidth:0}}><div className="page-actions"><button onClick={()=>void setLocale('en')}>QA English</button><button onClick={()=>void setLocale('zh-CN')}>QA 中文</button><button onClick={()=>{setKind('CUSTOMER_CONTRACT');setReset(v=>v+1);}}>QA Student</button><button onClick={()=>{setKind('CHANNEL_AGREEMENT_VERSION');setReset(v=>v+1);}}>QA Channel</button></div><ContractDocumentsSection key={`${kind}:${reset}`} sourceKind={kind} sourceId="00000000-0000-4000-8000-000000000001"/></main>;}
createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
