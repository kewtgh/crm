const required=["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
const missing=required.filter(key=>!process.env[key]);
if(missing.length)throw new Error(`Missing export-worker variables: ${missing.join(", ")}`);
const base=process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,"");
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers={apikey:key,authorization:`Bearer ${key}`,"content-type":"application/json"};
const workspaceDefault="00000000-0000-4000-8000-000000000001";

async function request(path,options={}){const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...options.headers}});const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(`${path} failed (${response.status}: ${body?.code??body?.message??"unknown"})`);return body;}
const csvCell=value=>{const text=String(value??"");const safe=typeof value==="string"&&/^[=+@-]/.test(text)?`'${text}`:text;return`"${safe.replaceAll('"','""')}"`;};
const csv=rows=>`\uFEFF${rows.map(row=>row.map(csvCell).join(",")).join("\r\n")}\r\n`;

async function contractExport(job){
  const id=String(job.parameters?.objectId??"");
  const rows=await request(`/rest/v1/contracts?select=contract_number,start_date,end_date,currency,contract_value,status,relationship_level,organizations(name_zh,name_en),products(name_zh,name_en)&id=eq.${encodeURIComponent(id)}&workspace_id=eq.${job.workspace_id}&limit=1`);
  if(!rows[0])throw new Error("Contract not found");const item=rows[0];
  return csv([["Contract number","Organization (ZH)","Organization (EN)","Product (ZH)","Product (EN)","Start date","End date","Currency","Value","Status","Relationship level"],[item.contract_number,item.organizations?.name_zh,item.organizations?.name_en,item.products?.name_zh,item.products?.name_en,item.start_date,item.end_date,item.currency,item.contract_value,item.status,item.relationship_level]]);
}
function periodRange(objectId){const match=/^(\d{4}-\d{2}-\d{2})_(month|quarter|year)_/.exec(objectId);if(!match)throw new Error("Invalid performance period");const start=new Date(`${match[1]}T00:00:00Z`);const end=new Date(start);if(match[2]==="month")end.setUTCMonth(end.getUTCMonth()+1);if(match[2]==="quarter")end.setUTCMonth(end.getUTCMonth()+3);if(match[2]==="year")end.setUTCFullYear(end.getUTCFullYear()+1);return{start:match[1],end:end.toISOString().slice(0,10)};}
async function performanceExport(job){
  const range=periodRange(String(job.parameters?.objectId??""));const ws=job.workspace_id??workspaceDefault;
  const [members,targets,payments]=await Promise.all([
    request(`/rest/v1/sales_team_members?select=id,name_zh,name_en,role,team&workspace_id=eq.${ws}&active=eq.true&order=name_en`),
    request(`/rest/v1/performance_targets?select=id,target_amount,currency&workspace_id=eq.${ws}&period_start=lte.${range.end}&period_end=gte.${range.start}`),
    request(`/rest/v1/payments?select=id,amount,currency,paid_at&workspace_id=eq.${ws}&status=eq.CONFIRMED&paid_at=gte.${range.start}T00:00:00Z&paid_at=lt.${range.end}T00:00:00Z`),
  ]);
  const targetIds=targets.map(item=>item.id);const paymentIds=payments.map(item=>item.id);
  const [allocations,contributions]=await Promise.all([
    targetIds.length?request(`/rest/v1/performance_allocations?select=contributor_member_id,allocated_amount&target_id=in.(${targetIds.join(",")})`):[],
    paymentIds.length?request(`/rest/v1/performance_contributions?select=contributor_member_id,amount,payment_id&payment_id=in.(${paymentIds.join(",")})`):[],
  ]);
  const targetBy=new Map();for(const item of allocations)targetBy.set(item.contributor_member_id,(targetBy.get(item.contributor_member_id)??0)+Number(item.allocated_amount));
  const actualBy=new Map();for(const item of contributions)actualBy.set(item.contributor_member_id,(actualBy.get(item.contributor_member_id)??0)+Number(item.amount));
  return csv([["Staff ID","Name (ZH)","Name (EN)","Role","Team","Period start","Period end","Allocated target","Confirmed performance"],...members.map(item=>[item.id,item.name_zh,item.name_en,item.role,item.team,range.start,range.end,targetBy.get(item.id)??0,actualBy.get(item.id)??0])]);
}
async function marketingContactsExport(job){
  const channel=String(job.parameters?.channel??"").toUpperCase();if(!["EMAIL","SMS","PHONE","WECHAT","WHATSAPP"].includes(channel))throw new Error("Invalid marketing channel");
  const rows=await request(`/rest/v1/rpc/marketing_export_rows`,{method:"POST",body:JSON.stringify({target_workspace:job.workspace_id,export_channel:channel})});
  return csv([["Contact ID","Name (ZH)","Name (EN)","Email","Phone","Authorized channel","Consent source","Obtained at","Retention until"],...rows.map(item=>[item.contact_id,item.name_zh,item.name_en,item.email,item.phone,item.channel,item.consent_source,item.obtained_at,item.retention_until])]);
}
async function setJob(id,status,extra={}){return request(`/rest/v1/generated_jobs?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status,updated_at:new Date().toISOString(),...extra})});}
async function expireArtifacts(){const expired=await request(`/rest/v1/generated_jobs?select=id,artifact_path&status=eq.READY&expires_at=lt.${encodeURIComponent(new Date().toISOString())}&limit=50`);for(const job of expired){if(job.artifact_path)await fetch(`${base}/storage/v1/object/crm-exports/${job.artifact_path}`,{method:"DELETE",headers}).catch(()=>undefined);await setJob(job.id,"EXPIRED");}}

await expireArtifacts();
const jobs=await request(`/rest/v1/generated_jobs?select=id,workspace_id,job_type,parameters,created_by&status=eq.QUEUED&order=created_at&limit=${Number(process.env.EXPORT_BATCH_SIZE??10)}`);
let ready=0;
for(const job of jobs){
  const claimed=await request(`/rest/v1/generated_jobs?id=eq.${job.id}&status=eq.QUEUED`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"PROCESSING",updated_at:new Date().toISOString()})});if(!claimed.length)continue;
  try{const content=job.job_type==="CONTRACT_EXPORT"?await contractExport(job):job.job_type==="MARKETING_CONTACT_EXPORT"?await marketingContactsExport(job):await performanceExport(job);const path=`${job.workspace_id}/${job.id}.csv`;const upload=await fetch(`${base}/storage/v1/object/crm-exports/${path}`,{method:"POST",headers:{apikey:key,authorization:`Bearer ${key}`,"content-type":"text/csv","x-upsert":"false"},body:content});if(!upload.ok)throw new Error(`Storage upload failed (${upload.status})`);const expiresAt=new Date(Date.now()+86400000).toISOString();await setJob(job.id,"READY",{artifact_path:path,expires_at:expiresAt,error_message:null});await request("/rest/v1/user_notifications",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:job.workspace_id,user_id:job.created_by,kind:"EXPORT",title_key:"notification.export.title",body_key:"notification.export.body",values:{type:job.job_type},source_type:"EXPORT",source_id:job.id})});ready+=1;}catch(error){await setJob(job.id,"FAILED",{artifact_path:null,expires_at:null,error_message:String(error instanceof Error?error.message:"Unknown export error").slice(0,500)});}
}
process.stdout.write(`Processed ${jobs.length} export jobs; ${ready} ready.\n`);
