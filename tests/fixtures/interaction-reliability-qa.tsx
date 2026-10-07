import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "../../components/app-shell";
import {I18nProvider,useI18n} from "../../components/i18n-provider";
import {ModulePage} from "../../components/module-page";
import {RecordDeleteAction} from "../../components/record-delete-action";
import {LeadPoolWorkspace} from "../../components/lead-pool-workspace";
import {ChannelActivationPanel} from "../../components/channel-activation-panel";
import {OrganizationCommercialPanel} from "../../components/organization-commercial-panel";
import {useCommissionMutation} from "../../components/commission-mutation";
import {EnrollmentRelation} from "../../components/enrollment-relation";
import {MoreActions} from "../../components/more-actions";
import {InlineMessage} from "../../components/ui";
import {moduleConfigs} from "../../lib/crm-data";
import {zhCN} from "../../lib/i18n/locales/zh-CN";
import {organizationRows} from "./ux-organization-rows";
import {frontlineLeads,frontlineId as id} from "./frontline";
import {qaNavigate,usePathname} from "./ux-foundation-navigation";

declare global {interface Window {
  reliabilityView:(view:string)=>void;reliabilityNavigate:(href:string)=>void;
  reliabilityRefreshFail:boolean;reliabilityRefreshes:number;
}}
async function refresh(){window.reliabilityRefreshes++;if(window.reliabilityRefreshFail)throw new Error("Synthetic refresh unavailable");}
function CommissionProbe(){
  const {send,pending,uncertain,error}=useCommissionMutation(refresh),[saved,setSaved]=useState(false);
  return <section><h1>Example commission operation</h1>{error&&<InlineMessage type="error">{error}</InlineMessage>}{saved?<p role="status">Accepted</p>:<button className="primary-button" disabled={pending} onClick={()=>void send("/api/commissions",{requestKey:crypto.randomUUID(),operation:"EXAMPLE"}).then(setSaved)}>{uncertain?"Retry exact request":"Send example operation"}</button>}</section>;
}
function Controls(){const [selected,setSelected]=useState("");return <section className="surface"><h1>Example keyboard controls</h1><EnrollmentRelation type="USER" label="Example owner" value={selected} onChange={setSelected}/><MoreActions label="Example more"><a role="menuitem" href="#context">Example context</a><button role="menuitem" type="button">Example action</button></MoreActions><button type="button" id="context">After menu</button></section>;}
function Fixture(){
  const {setLocale}=useI18n(),[view,setView]=useState("directory"),[revision,setRevision]=useState(0),pathname=usePathname();
  useEffect(()=>{window.reliabilityView=next=>{setView(next);setRevision(n=>n+1);};window.reliabilityNavigate=qaNavigate;window.reliabilityRefreshFail=false;window.reliabilityRefreshes=0;},[]);
  const user={id:id(99),username:"advisor-a",email:"advisor@example.test",displayName:"Advisor A",displayNameZh:"顾问甲",role:"ADMIN" as const,initials:"AA",mustChangePassword:false,mfaEnabled:true,aal:"aal2" as const,emailVerified:true,accountStatus:"ACTIVE" as const};
  return <AppShell user={user} relationshipHealth={{hasData:true,score:78,weeklyDelta:3,sampleSize:12,basis:"RELATIONSHIP_MILESTONES"}} preferences={{timezone:"Asia/Taipei",dateFormat:"yyyy-MM-dd"}} preferredLocale="zh-CN"><div key={`${view}:${revision}`}>
    {view==="delete"?<section className="surface"><h1>Example product cleanup</h1><RecordDeleteAction kind="PRODUCT" id={id(1)} label="Example Product A" onDeleted={refresh}/></section>:view==="commission"?<CommissionProbe/>:view==="lead"?<LeadPoolWorkspace initial={{items:frontlineLeads,total:frontlineLeads.length,page:1,pageSize:20}}/>:view==="activation"?<ChannelActivationPanel organizationId={id(1)}/>:view==="commercial"?<OrganizationCommercialPanel organizationId={id(1)} embedded/>:view==="controls"?<Controls/>:<ModulePage config={{...moduleConfigs[pathname==="/people"?"people":"schools"],rows:organizationRows}} resource={pathname==="/people"?"people":"schools"} initialTotal={6} initialMetrics={{total:6,needsAttention:1,averageCompleteness:80}}/>}
  </div><button type="button" className="text-button" onClick={()=>void setLocale("en")}>QA English</button></AppShell>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="zh-CN" initialMessages={zhCN}><Fixture/></I18nProvider>);
