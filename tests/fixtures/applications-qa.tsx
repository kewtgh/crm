import {useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {ApplicationsWorkspace} from "../../components/applications-workspace";
import {EnrollmentDetail} from "../../components/enrollment-detail";
import {EducationBusinessWorkspace} from "../../components/education-business-workspace";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {EnrollmentRecord} from "../../lib/enrollment-repository";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const enrollment:EnrollmentRecord={id:"00000000-0000-4000-8000-000000000010",workspace_id:"00000000-0000-4000-8000-000000000090",student_id:"00000000-0000-4000-8000-000000000001",cohort_id:"00000000-0000-4000-8000-000000000004",household_id:null,opportunity_id:null,status:"INTERESTED",owner_id:user.id,sales_owner_id:null,enrolled_at:null,completed_at:null,withdrawn_at:null,withdrawal_reason:"",revision:1,created_by:user.id,created_at:"2026-10-04T00:00:00Z",updated_at:"2026-10-04T00:00:00Z",student_name_zh:"张三",student_name_en:"Zhang San",student_number:"S001",cohort_name_zh:"GAPP 秋季 2027",cohort_name_en:"GAPP Fall 2027",product_name_zh:"GAPP 产品",product_name_en:"GAPP Product",household_name_zh:null,household_name_en:null,owner_name_zh:"QA",owner_name_en:"QA",can_edit:true,has_primary_attribution:false};
function Fixture(){const {setLocale}=useI18n(),[screen,setScreen]=useState("applications"),[create,setCreate]=useState(false),[scope,setScope]=useState(""),[token,setToken]=useState(0);
 return <main className="page-stack" onClick={event=>{const link=(event.target as HTMLElement).closest("a");if(link?.getAttribute("href")?.startsWith("/applications?enrollmentId=")){event.preventDefault();setScreen("applications");setScope(enrollment.id);setCreate(link.getAttribute("href")!.includes("create=1"));setToken(value=>value+1);}}}>
 <div className="detail-actions" style={{flexWrap:"wrap"}}><button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button><button onClick={()=>setScreen("enrollment")}>QA Enrollment</button><button onClick={()=>{setScreen("applications");setCreate(false);setScope("");setToken(value=>value+1);}}>QA Applications</button><button onClick={()=>setScreen("tasks")}>QA Legacy tasks</button></div>
 {screen==="enrollment"?<EnrollmentDetail record={enrollment} onClose={()=>setScreen("applications")} onEdit={()=>{}} onRefresh={async()=>{}}/>:screen==="tasks"?<EducationBusinessWorkspace context={{type:"STUDENT",id:enrollment.student_id}} initialResource="applications"/>:<ApplicationsWorkspace key={token} initial={null} enrollment={scope?enrollment:null} initialEnrollmentId={scope} create={create}/>}
 </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
