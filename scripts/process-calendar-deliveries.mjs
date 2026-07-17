import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";

const required=["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","EMAIL_DELIVERY_WEBHOOK_URL"];
const missing=required.filter(key=>!process.env[key]);if(missing.length)throw new Error(`Missing calendar-delivery variables: ${missing.join(", ")}`);
const baseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,"");const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;const headers={apikey:serviceKey,authorization:`Bearer ${serviceKey}`,"content-type":"application/json"};
const heartbeat=createWorkerHeartbeat(baseUrl,serviceKey,"CALENDAR_DELIVERIES");
const workerId=process.env.WORKER_ID??`calendar-deliveries:${process.pid}:${crypto.randomUUID()}`;
async function rpc(name,body){const response=await fetch(`${baseUrl}/rest/v1/rpc/${name}`,{method:"POST",headers,body:JSON.stringify(body)});const result=await response.json().catch(()=>null);if(!response.ok)throw new Error(`${name} failed (${response.status})`);return result;}
async function row(table,select,id){const response=await fetch(`${baseUrl}/rest/v1/${table}?select=${select}&id=eq.${id}&limit=1`,{headers});const result=await response.json();if(!response.ok||!result[0])throw new Error(`${table} record is unavailable`);return result[0];}
try{
  const jobs=await rpc("claim_calendar_deliveries_leased",{batch_size:Number(process.env.CALENDAR_DELIVERY_BATCH_SIZE??20),worker_id:workerId,lease_seconds:300});let delivered=0;
  for(const job of jobs){try{const[attendee,appointment]=await Promise.all([row("appointment_attendees","email,name,contact_id",job.attendee_id),row("appointments","title_zh,title_en,starts_at,ends_at,channel,related_label,status",job.appointment_id)]);const response=await fetch(process.env.EMAIL_DELIVERY_WEBHOOK_URL,{method:"POST",headers:{"content-type":"application/json",...(process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN?{authorization:`Bearer ${process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN}`}:{})},body:JSON.stringify({id:job.id,idempotencyKey:job.idempotency_key,to:attendee.email,template:`calendar-${job.delivery_type.toLowerCase()}`,payload:{eventVersion:job.event_version,attendeeName:attendee.name,appointment}}),signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new Error(`Delivery webhook returned ${response.status}`);const receipt=await response.json().catch(()=>({}));await rpc("complete_calendar_delivery_leased",{delivery_id:job.id,token:job.lease_token,provider_id:String(receipt.id??receipt.messageId??"")||null});delivered++;}catch(error){await rpc("fail_calendar_delivery_leased",{delivery_id:job.id,token:job.lease_token,failure:error instanceof Error?error.message:"Unknown calendar delivery error"});}}
  await heartbeat.success({claimed:jobs.length,delivered});
  process.stdout.write(`Processed ${jobs.length} calendar deliveries; ${delivered} delivered.\n`);
}catch(error){await heartbeat.failure(error).catch(()=>undefined);throw error;}
