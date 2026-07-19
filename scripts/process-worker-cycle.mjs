import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";

const workers=[
  ["REMINDERS","process-reminders.mjs"],
  ["NOTIFICATION_OUTBOX","process-notification-outbox.mjs"],
  ["CALENDAR_DELIVERIES","process-calendar-deliveries.mjs"],
  ["GENERATED_JOBS","process-generated-jobs.mjs"],
  ["WEBHOOK_INBOX","process-webhook-inbox.mjs"],
  ["INTEGRATION_SYNC","process-integration-sync.mjs"],
];
const baseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,"");
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const failures=[];

function run(script){
  return new Promise((resolve)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{
      env:process.env,
      stdio:"inherit",
    });
    child.once("error",(error)=>resolve({code:1,error}));
    child.once("exit",(code,signal)=>resolve({
      code:code??1,
      error:code===0?null:new Error(`${script} exited with ${code??signal??"UNKNOWN"}`),
    }));
  });
}

for(const [worker,script] of workers){
  process.stdout.write(`\n[worker-cycle] ${worker}\n`);
  const result=await run(script);
  if(result.code===0)continue;
  failures.push({worker,error:result.error});
  if(baseUrl&&serviceKey){
    await createWorkerHeartbeat(baseUrl,serviceKey,worker)
      .failure(result.error,{orchestrated:true})
      .catch(()=>undefined);
  }
}

if(failures.length){
  const summary=failures.map(item=>`${item.worker}: ${item.error?.message??"failed"}`).join("; ");
  throw new Error(`Worker cycle failed (${failures.length}/${workers.length}): ${summary}`);
}
process.stdout.write(`\nWorker cycle completed: ${workers.length}/${workers.length} healthy.\n`);
