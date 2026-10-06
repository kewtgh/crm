import {useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {WorkflowLaunchpad} from "../../components/workflow-launchpad";
import {ActionCenterPage} from "../../components/action-center-page";
import {AccessibleDrawer} from "../../components/ui";
import {EnrollmentEditor} from "../../components/enrollment-editor";
import {StudentEnrollmentsSection} from "../../components/student-enrollments-section";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const user={id:id(99),username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
function Nested({onClose}:{onClose:()=>void}){const [child,setChild]=useState(true);return <AccessibleDrawer title="QA Parent" onClose={onClose}><button onClick={()=>setChild(true)}>QA Child</button>{child&&<AccessibleDrawer guardChanges title="QA Child" onClose={()=>setChild(false)}><form><label>QA Input<input name="qaInput"/></label><button type="button" data-drawer-dismiss>QA Cancel</button></form></AccessibleDrawer>}</AccessibleDrawer>;}
function Fixture(){const {setLocale}=useI18n(),[nested,setNested]=useState(false),[editor,setEditor]=useState(false);return <main className="page-stack"><nav className="page-actions"><button onClick={()=>void setLocale('en')}>QA English</button><button onClick={()=>void setLocale('zh-CN')}>QA 中文</button><button onClick={()=>setNested(true)}>QA Open nested</button><button onClick={()=>setEditor(true)}>QA Save refresh failure</button></nav><WorkflowLaunchpad/><ActionCenterPage snapshot={{role:'ADMIN',generatedAt:'2026-10-07T00:00:00Z',items:[],total:0,urgent:0}}/><StudentEnrollmentsSection studentId={id(1)} studentLabel="Student A"/>{nested&&<Nested onClose={()=>setNested(false)}/>} {editor&&<EnrollmentEditor studentId={id(1)} studentLabel="Student A" cohortId={id(2)} cohortLabel="Example Cohort" onClose={()=>setEditor(false)} onSaved={async()=>{throw new Error('synthetic-refresh-failure');}}/>}</main>;}
createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:'Asia/Taipei',dateFormat:'yyyy-MM-dd'}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
