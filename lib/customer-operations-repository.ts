import { databaseJson, databaseRequest } from "./db/gateway";
import type { CustomerSubject, FollowUpEntry, FollowUpPlan } from "./customer-operations";

type BusinessRecord={id:string;name_zh?:string;name_en?:string;title_zh?:string;title_en?:string;contract_number?:string;status?:string;stage?:string;product_id?:string;owner_id?:string;owner_name?:string;member_role?:string;next_follow_up_at?:string;communication_level?:number};
export type CustomerOperationsSnapshot={subject:CustomerSubject;id:string;nameZh:string;nameEn:string;shortName:string;ownerName:string;
  profile:Record<string,unknown>;level:number;plan:FollowUpPlan|null;entries:FollowUpEntry[];entryTotal:number;completed:number;
  contacts:BusinessRecord[];contracts:BusinessRecord[];opportunities:BusinessRecord[];students:BusinessRecord[];products:Array<{id:string;name_zh:string;name_en:string}>;limited:boolean};
const subjectTable={ORGANIZATION:"organizations",CONTACT:"contacts",HOUSEHOLD:"households"};
export async function loadCustomerOperations(subject:CustomerSubject,id:string,capabilities:{contracts:boolean;opportunities:boolean}):Promise<CustomerOperationsSnapshot>{
  const access=await databaseJson<boolean>("/db/rpc/customer_subject_access",{method:"POST",body:JSON.stringify({subject_kind:subject,subject:id,edit:false})});
  if(!access)throw new Error("CRM_RECORD_NOT_FOUND");
  const [profiles,plans,response]=await Promise.all([
    databaseJson<Array<Record<string,unknown>>>(`/db/table/${subjectTable[subject]}?select=*&id=eq.${id}&limit=1`),
    databaseJson<FollowUpPlan[]>(`/db/table/customer_follow_up_plans?select=*&subject_kind=eq.${subject}&subject_id=eq.${id}&limit=1`),
    databaseRequest(`/db/table/customer_follow_up_history?select=*&subject_kind=eq.${subject}&subject_id=eq.${id}&order=occurred_at.desc`,{headers:{Prefer:"count=exact",Range:"0-49"}}),
  ]);
  const profile=profiles[0];if(!profile)throw new Error("CRM_RECORD_NOT_FOUND");
  const organization=subject==="ORGANIZATION"?id:subject==="CONTACT"?String(profile.organization_id??""):"";
  const query=<T>(url:string,enabled=true)=>enabled?databaseJson<T[]>(url):Promise.resolve([] as T[]);
  const plan=plans[0]??null;
  const [owners,contacts,contracts,opportunities,students,milestones,completion]=await Promise.all([
    query<{display_name_zh:string;display_name_en:string}>(`/db/table/user_profiles?select=display_name_zh,display_name_en&user_id=eq.${profile.owner_id}&limit=1`,!!profile.owner_id),
    subject==="HOUSEHOLD"?query<{member_role:string;contacts:BusinessRecord|null}>(`/db/table/household_members?select=member_role,contacts:contacts!household_members_contact_id_fkey(id,name_zh,name_en,contact_status,communication_level,next_follow_up_at,owner_id)&household_id=eq.${id}&limit=51`).then(rows=>rows.flatMap(row=>row.contacts?[{...row.contacts,member_role:row.member_role}]:[])):
      query<BusinessRecord>(`/db/table/contacts?select=id,name_zh,name_en,contact_status,communication_level,next_follow_up_at&organization_id=eq.${organization}&archived_at=is.null&limit=51`,!!organization),
    !capabilities.contracts?Promise.resolve([] as BusinessRecord[]):subject==="ORGANIZATION"?query<BusinessRecord>(`/db/table/contracts?select=id,contract_number,status,product_id,owner_id&organization_id=eq.${id}&order=updated_at.desc&limit=51`):
      query<{contracts:BusinessRecord|null}>(`/db/table/customer_contract_links?select=contracts:contracts!customer_contract_links_contract_id_fkey(id,contract_number,status,product_id,owner_id)&subject_kind=eq.${subject}&subject_id=eq.${id}&limit=51`).then(rows=>rows.flatMap(row=>row.contracts?[row.contracts]:[])),
    query<BusinessRecord>(`/db/table/opportunities?select=id,title_zh,title_en,stage,owner_id&${subject==="HOUSEHOLD"?"household_id":"organization_id"}=eq.${subject==="HOUSEHOLD"?id:organization}&order=updated_at.desc&limit=51`,capabilities.opportunities&&(subject==="HOUSEHOLD"||!!organization)),
    query<BusinessRecord&{contacts:{name_zh:string;name_en:string}|null}>(`/db/table/students?select=id,contacts:contacts!students_person_id_fkey(name_zh,name_en)&household_id=eq.${id}&status=neq.ARCHIVED&limit=51`,subject==="HOUSEHOLD").then(rows=>rows.map(row=>({...row,name_zh:row.contacts?.name_zh,name_en:row.contacts?.name_en}))),
    query<{milestone_type:string}>(`/db/table/relationship_milestones?select=milestone_type&organization_id=eq.${id}&evidence_status=neq.REJECTED`,subject==="ORGANIZATION"),
    plan?databaseRequest(`/db/table/customer_follow_up_history?select=id&kind=in.(CALL,EMAIL,MEETING,VISIT,MEAL)&subject_kind=eq.${subject}&subject_id=eq.${id}&occurred_at=gte.${plan.start_date}T00:00:00Z&and=(occurred_at.lt.${new Date(Date.parse(plan.due_date)+86400000).toISOString()})`,{headers:{Prefer:"count=exact",Range:"0-0"}}):Promise.resolve(null),
  ]);
  const ids=[...new Set(contracts.map(row=>row.product_id).filter(Boolean))];
  const ownerIds=[...new Set([...contracts,...contacts].map(row=>row.owner_id).filter(Boolean))];
  const [products,businessOwners]=await Promise.all([query<{id:string;name_zh:string;name_en:string}>(`/db/table/products?select=id,name_zh,name_en&id=in.(${ids.join(",")})`,ids.length>0),query<{user_id:string;display_name_zh:string;display_name_en:string}>(`/db/table/user_profiles?select=user_id,display_name_zh,display_name_en&user_id=in.(${ownerIds.join(",")})`,ownerIds.length>0)]);
  for(const row of [...contracts,...contacts]){const owner=businessOwners.find(item=>item.user_id===row.owner_id);row.owner_name=owner?`${owner.display_name_zh} / ${owner.display_name_en}`:"—";}
  const steps=["CONTACT","MEAL","FAMILY_CHAT","ADVOCACY"];
  const level=subject==="CONTACT"?Number(profile.communication_level??1):subject==="ORGANIZATION"?Math.max(1,...milestones.map(row=>steps.indexOf(row.milestone_type)+1)):Math.max(1,...contacts.map(row=>Number(row.communication_level??1)));
  return{subject,id,nameZh:String(profile.name_zh),nameEn:String(profile.name_en),shortName:String(profile.short_name??""),profile,level,ownerName:owners[0]?`${owners[0].display_name_zh} / ${owners[0].display_name_en}`:"—",plan,
    entries:await response.json() as FollowUpEntry[],entryTotal:Number(response.headers.get("content-range")?.split("/")[1]??0),completed:Number(completion?.headers.get("content-range")?.split("/")[1]??0),
    contacts:contacts.slice(0,50),contracts:contracts.slice(0,50),opportunities:opportunities.slice(0,50),students:students.slice(0,50),products,
    limited:[contacts,contracts,opportunities,students].some(rows=>rows.length>50)};
}
export function saveCustomerFollowUp(subject:CustomerSubject,id:string,operation:string,details:Record<string,unknown>){
  return databaseJson("/db/rpc/save_customer_follow_up",{method:"POST",body:JSON.stringify({p_subject_kind:subject,subject:id,operation,details})});
}
