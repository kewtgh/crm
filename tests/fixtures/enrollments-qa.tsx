import {useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {AppUserProvider} from "../../components/app-user-context";
import {UserPreferencesProvider} from "../../components/user-preferences-context";
import {EnrollmentsWorkspace} from "../../components/enrollments-workspace";
import {StudentsWorkspace} from "../../components/v200-workspaces";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import type {StudentDetail} from "../../lib/v200-repository";
const user={id:"00000000-0000-4000-8000-000000000099",username:"qa",email:"qa@example.test",displayName:"QA",displayNameZh:"QA",role:"ADMIN" as const,initials:"QA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
const student:StudentDetail={id:"00000000-0000-4000-8000-000000000001",personId:"00000000-0000-4000-8000-000000000002",nameZh:"张三",nameEn:"Zhang San",householdId:"00000000-0000-4000-8000-000000000003",householdZh:"张家",householdEn:"Zhang Family",studentNumber:"S001",grade:"Grade 11",academicYear:"2026",status:"ACTIVE",updatedAt:"2026-10-03T00:00:00Z",birthDate:"",currentClass:"",personalityMarkdown:"",learningExpectationsMarkdown:"",strengthsMarkdown:"",supportNeedsMarkdown:"",interests:[],preferredLearningStyle:"",academicRecords:[],guardians:[]};
function Fixture(){const {setLocale}=useI18n(),[showStudent,setShowStudent]=useState(false);return <main className="page-stack"><div><button onClick={()=>void setLocale("en")}>QA English</button><button onClick={()=>void setLocale("zh-CN")}>QA 中文</button><button onClick={()=>setShowStudent(current=>!current)}>QA Student detail</button></div>{showStudent?<StudentsWorkspace initial={{items:[student],total:1,page:1,pageSize:20}} initialDetail={student}/>:<EnrollmentsWorkspace initial={{items:[],total:0,page:1,pageSize:20}}/>}</main>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><AppUserProvider user={user}><UserPreferencesProvider initialPreferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}}><Fixture/></UserPreferencesProvider></AppUserProvider></I18nProvider>);
