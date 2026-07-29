import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";
import { closeWorkerDatabase, withWorkerAdvisoryLock } from "./lib/worker-database.mjs";

const allWorkers=[
  ["REMINDERS","process-reminders.mjs"],
  ["NOTIFICATION_OUTBOX","process-notification-outbox.mjs"],
  ["CALENDAR_DELIVERIES","process-calendar-deliveries.mjs"],
  ["GENERATED_JOBS","process-generated-jobs.mjs"],
  ["WEBHOOK_INBOX","process-webhook-inbox.mjs"],
  ["INTEGRATION_SYNC","process-integration-sync.mjs"],
];
const featureEnabled=(value)=>/^(1|true|yes|on)$/i.test(String(value??"").trim());
const workers=allWorkers.filter(([worker])=>{
  if(worker==="WEBHOOK_INBOX")return featureEnabled(process.env.WEBHOOKS_ENABLED);
  if(worker==="INTEGRATION_SYNC")return featureEnabled(process.env.INTEGRATION_SYNC_ENABLED);
  return true;
});
const skipped=allWorkers.filter(([worker])=>!workers.some(([enabled])=>enabled===worker)).map(([worker])=>worker);
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

try {
  const locked=await withWorkerAdvisoryLock("lumina-crm-worker-cycle",async()=>{
    const results=await Promise.all(workers.map(async([worker,script])=>{
      process.stdout.write(`\n[worker-cycle] ${worker}\n`);
      const result=await run(script);
      if(result.code!==0&&process.env.WORKER_DATABASE_URL){
        await createWorkerHeartbeat(worker)
          .failure(result.error,{orchestrated:true})
          .catch(()=>undefined);
      }
      return{worker,...result};
    }));
    for(const result of results){
      if(result.code!==0)failures.push({worker:result.worker,error:result.error});
    }

    if(failures.length){
      const summary=failures.map(item=>`${item.worker}: ${item.error?.message??"failed"}`).join("; ");
      throw new Error(`Worker cycle failed (${failures.length}/${workers.length}): ${summary}`);
    }
    process.stdout.write(`\nWorker cycle completed: ${workers.length}/${workers.length} enabled workers healthy${skipped.length?`; disabled: ${skipped.join(", ")}`:""}.\n`);
  });
  if(!locked.acquired)throw new Error("WORKER_CYCLE_ALREADY_RUNNING");
} finally {
  await closeWorkerDatabase().catch(()=>undefined);
}
