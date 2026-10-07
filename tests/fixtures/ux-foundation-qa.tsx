import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {ModulePage} from "../../components/module-page";
import {StudentsWorkspace,HouseholdsWorkspace} from "../../components/v200-workspaces";
import {WorkspaceNav,governanceTabs} from "../../components/workspace-tabs";
import {RecordHeader} from "../../components/record-header";
import {MetricStrip} from "../../components/metric-strip";
import {AttentionPanel} from "../../components/attention-panel";
import {presentMissing} from "../../lib/ux-presentation";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {moduleConfigs} from "../../lib/crm-data";
import type {AppRole} from "../../lib/roles";
import {usePathname,useSearchParams,qaNavigate} from "./ux-foundation-navigation";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
import {organizationRows} from "./ux-organization-rows";
declare global {interface Window{uxNavigate:(href:string)=>void;uxRole:(role:AppRole)=>void;}}
function Probes(){const {locale,t,enumLabel}=useI18n();const unknown=enumLabel("crm.status.SYNTHETIC_UNKNOWN");return <><RecordHeader nameZh="示例长双语记录名称与任务标题" nameEn="Example International Academy for Global Education and Student Development" primaryAction={<button className="primary-button">Example action</button>}/><div data-testid="presentation-probes"><p>{t("synthetic.missing.translation")}</p><p>{unknown.label}</p><p>{presentMissing(locale,null)}</p><p>{presentMissing(locale,0)}</p><p>{presentMissing(locale,null,"restricted")}</p></div><MetricStrip label="Example metrics" items={[{id:"zero",label:"Example count",value:0,mode:"SNAPSHOT",asOf:"2026-10-07",comparison:"MUST_NOT_RENDER"},{id:"period",label:"Example period",value:"100.01",currency:"CNY",mode:"PERIOD",asOf:"2026-10-01–2026-10-07",comparison:"Supplied period comparison"},{id:"restricted",label:"Restricted metric",value:9,mode:"SNAPSHOT",asOf:"2026-10-07",state:"restricted"}]}/><AttentionPanel title="Example attention" items={[{id:"one",title:"Example item",description:"Supplied canonical attention",href:"/tasks",actionLabel:"Open tasks",priority:"high"}]} emptyLabel="No items"/><WorkspaceNav items={governanceTabs} active="/imports"/></>;}
function Fixture(){const [role,setRole]=useState<AppRole>("ADMIN"),pathname=usePathname(),params=useSearchParams();useEffect(()=>{window.uxNavigate=qaNavigate;window.uxRole=setRole;},[]);const user={id:id(99),username:"advisor-a",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"顾问甲",role,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};return <AppShell user={user} relationshipHealth={{hasData:true,score:78,weeklyDelta:3,sampleSize:12,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale="zh-CN">
  {pathname==="/schools"?<ModulePage config={{...moduleConfigs.schools,rows:organizationRows}} resource="schools" initialTotal={6} initialMetrics={{total:6,needsAttention:1,averageCompleteness:80}}/>:pathname==="/students"||pathname==="/households"&&params.get("tab")!=="families"?<StudentsWorkspace initial={{items:[],total:0,page:1,pageSize:10}}/>:pathname==="/households"?<HouseholdsWorkspace initial={{items:[],total:0,page:1,pageSize:10}}/>:<Probes/>}
  </AppShell>;}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
