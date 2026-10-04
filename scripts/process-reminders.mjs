import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";
import { boundedWorkerInteger } from "./lib/bounded-concurrency.mjs";
import { workerJson } from "./lib/worker-database.mjs";

const required = ["WORKER_DATABASE_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing reminder-worker variables: ${missing.join(", ")}`);
const heartbeat = createWorkerHeartbeat("REMINDERS");
try {
  const result = await workerJson("/db/rpc/process_due_reminders", {
    method: "POST",
    body: JSON.stringify({ batch_size: boundedWorkerInteger(process.env.REMINDER_BATCH_SIZE, {
      name:"REMINDER_BATCH_SIZE",defaultValue:100,maximum:200,
    }) }),
  });
  const deadlineEvents = await workerJson("/db/rpc/process_cohort_deadline_events", {method:"POST",body:JSON.stringify({batch_size:100})});
  const milestoneDueEvents=await workerJson("/db/rpc/process_milestone_due_events",{method:"POST",body:JSON.stringify({batch_size:100})});
  await heartbeat.success({ milestoneDueEvents:Number(milestoneDueEvents??0),processed: Number(result ?? 0), cohortDeadlineEvents:Number(deadlineEvents??0) });
  process.stdout.write(`Processed ${Number(result ?? 0)} due reminders.\n`);
} catch (error) {
  await heartbeat.failure(error).catch(() => undefined);
  throw error;
}
