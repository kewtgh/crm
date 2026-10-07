import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {RevenueWorkspaceView} from '../../components/revenue-workspace';
import {ContractRevenueSection} from '../../components/contract-revenue-section';
import {I18nProvider,useI18n} from '../../components/i18n-provider';
import {en} from '../../lib/i18n/locales/en';
import type {RevenueWorkspace} from '../../lib/revenue-workspace';
import fixture from './revenue-workspace-r5f.json';
function Fixture(){const {setLocale}=useI18n();const [contract,setContract]=useState(false);return <main style={{padding:16,maxWidth:1600,margin:'auto'}}><button onClick={()=>void setLocale('zh-CN')}>QA Chinese</button><button onClick={()=>void setLocale('en')}>QA English</button><button onClick={()=>setContract(!contract)}>QA Contract tab</button>{contract?<ContractRevenueSection contractId={fixture.contracts[0].contract_id}/>:<RevenueWorkspaceView initial={fixture as RevenueWorkspace}/>}</main>;}
createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale="en" initialMessages={en}><Fixture/></I18nProvider>);
