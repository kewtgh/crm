import {useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {StudentSuccessWorkspace,EnrollmentSuccessSection} from "../../components/student-success-workspace";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {EnrollmentRecord} from "../../lib/enrollment-repository";
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const user={id:uuid(99),username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const enrollment={id:uuid(10),workspace_id:uuid(90),student_id:uuid(1),cohort_id:uuid(4),status:"ACTIVE",owner_id:user.id,revision:1,student_name_zh:"学生甲",student_name_en:"Student A",cohort_name_zh:"秋季 2027",cohort_name_en:"Fall 2027",product_name_zh:"项目",product_name_en:"Program",owner_name_zh:"QA",owner_name_en:"QA",can_edit:true} as EnrollmentRecord;
function Fixture(){const {setLocale}=useI18n(),[screen,setScreen]=useState("enrollment"),[token,setToken]=useState(0),[second,setSecond]=useState(false),[focus,setFocus]=useState<string|undefined>();const record=second?{...enrollment,id:uuid(11),cohort_id:uuid(5),cohort_name_zh:"夏季 2028",cohort_name_en:"Summer 2028"}:enrollment;
 return <main className="page-stack" onClick={event=>{const a=(event.target as HTMLElement).closest("a"),href=a?.getAttribute("href");if(href?.startsWith("/student-success?")){event.preventDefault();setFocus(new URL(href,"http://localhost").searchParams.get("focus")??undefined);setScreen("success");setToken(v=>v+1);}}}>
 <div className="detail-actions" style={{flexWrap:"wrap"}}><button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button><button onClick={()=>{setScreen("enrollment");setSecond(false);setToken(v=>v+1);}}>QA Enrollment A</button><button onClick={()=>{setScreen("enrollment");setSecond(true);setToken(v=>v+1);}}>QA Enrollment B</button><button onClick={()=>{setScreen("list");setToken(v=>v+1);}}>QA List</button></div>
 {screen==="enrollment"?<EnrollmentSuccessSection key={token} record={record}/>:<StudentSuccessWorkspace key={`${token}-${focus??""}`} initial={{items:[],total:0,page:1,pageSize:20}} enrollment={screen==="list"?null:record} create={screen==="success"&&!focus}/>}
 </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
