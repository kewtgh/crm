import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const urls = {
  migrator: process.env.MIGRATION_DATABASE_URL?.trim(),
  app: process.env.DATABASE_URL?.trim(),
  system: process.env.SYSTEM_DATABASE_URL?.trim(),
  worker: process.env.WORKER_DATABASE_URL?.trim(),
};
for (const [name, value] of Object.entries(urls)) {
  if (!value) throw new Error(`${name.toUpperCase()}_DATABASE_URL_REQUIRED`);
}

const workspaceId = "00000000-0000-4000-8000-000000000001";
const actorId = "97200000-0000-4000-8000-000000000070";
const contactId = "97200000-0000-4000-8000-000000000071";
const threadId = "97200000-0000-4000-8000-000000000072";
const idempotencyKey = "phase2-switch-idempotency-key";
const clients = [];

async function connect(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  clients.push(client);
  return client;
}

const migrator = await connect(urls.migrator);
const app = await connect(urls.app);
const system = await connect(urls.system);
const worker = await connect(urls.worker);

async function appTransaction(operation) {
  await app.query("begin");
  try {
    await app.query("select set_config('app.user_id',$1,true)", [actorId]);
    await app.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
    await app.query("select set_config('app.role','ADMIN',true)");
    await app.query("select set_config('app.aal','aal2',true)");
    const result = await operation();
    await app.query("commit");
    return result;
  } catch (error) {
    await app.query("rollback");
    throw error;
  }
}

try {
  await migrator.query(
    `delete from public.audit_events
     where actor_id=$1 or entity_id like '97200000-%'`,
    [actorId],
  );
  await migrator.query(
    `delete from public.communication_threads where id=$1`,
    [threadId],
  );
  await migrator.query(`delete from public.contacts where id=$1`, [contactId]);
  await migrator.query(
    `delete from public.workspace_memberships where user_id=$1`,
    [actorId],
  );
  await migrator.query(`delete from app_auth.accounts where id=$1`, [actorId]);
  const baselineCommunicationMetrics = (await system.query(
    `select public.service_readiness_snapshot_for_workers(
       $1,array['COMMUNICATION_DELIVERY']::text[]
     ) snapshot`,
    [workspaceId],
  )).rows[0].snapshot.communicationDelivery;
  await migrator.query(
    `insert into app_auth.accounts(id,email,username,status)
     values($1,'phase2@example.test','phase2.switch','ACTIVE')`,
    [actorId],
  );
  await migrator.query(
    `insert into public.workspace_memberships(workspace_id,user_id,role,status)
     values($1,$2,'ADMIN','ACTIVE')`,
    [workspaceId, actorId],
  );
  await migrator.query(
    `insert into public.contacts(
       id,workspace_id,name_zh,name_en,email,created_by
     ) values($1,$2,'阶段二联系人','Phase Two Contact','phase2-recipient@example.test',$3)`,
    [contactId, workspaceId, actorId],
  );
  await migrator.query(
    `insert into public.contact_consents(
       workspace_id,contact_id,channel,purpose,status,source,
       obtained_at,created_by,updated_by
     ) values($1,$2,'EMAIL','SERVICE','GRANTED','PHASE2_TEST',now(),$3,$3)`,
    [workspaceId, contactId, actorId],
  );
  await migrator.query(
    `insert into public.communication_threads(
       id,workspace_id,contact_id,subject,channel,purpose,status,
       assigned_to,created_by
     ) values($1,$2,$3,'Phase 2 switch','EMAIL','SERVICE','OPEN',$4,$4)`,
    [threadId, workspaceId, contactId, actorId],
  );
  const baselineOperational = await appTransaction(async () => (
    (await app.query(`select public.operational_snapshot() payload`))
      .rows[0].payload
  ));
  const baselineQueue = baselineOperational.queues.find(
    (candidate) => candidate.key === "COMMUNICATION_DELIVERY",
  );
  assert.ok(baselineQueue);

  const first = await appTransaction(async () => (
    (await app.query(
      `select public.queue_communication_message($1,$2,$3) payload`,
      [threadId, "Durably queued body", idempotencyKey],
    )).rows[0].payload
  ));
  assert.equal(first.shouldDeliver, true);
  assert.equal(first.accepted, true);
  assert.equal(first.message.delivery_status, "QUEUED");
  assert.ok(first.message.next_attempt_at);

  const duplicate = await appTransaction(async () => (
    (await app.query(
      `select public.queue_communication_message($1,$2,$3) payload`,
      [threadId, "Durably queued body", idempotencyKey],
    )).rows[0].payload
  ));
  assert.equal(duplicate.message.id, first.message.id);
  assert.equal(duplicate.shouldDeliver, false);
  await migrator.query(
    `update public.communication_messages
     set next_attempt_at=now()-interval '1 day'
     where id=$1`,
    [first.message.id],
  );
  assert.equal(duplicate.message.attempt_count, first.message.attempt_count);

  const claim = (await worker.query(
    `select * from public.claim_communication_deliveries_leased($1,$2,$3,$4)
     where message_id=$5`,
    [workspaceId, 1, "phase2-db-worker", 300, first.message.id],
  )).rows[0];
  assert.equal(claim.message_id, first.message.id);
  await worker.query(
    `select public.mark_communication_delivery_attempt_started_leased($1,$2,$3)`,
    [first.message.id, "phase2-db-worker", claim.lease_token],
  );
  await worker.query(
    `select public.complete_communication_delivery_leased($1,$2,$3,$4)`,
    [first.message.id, "phase2-db-worker", claim.lease_token, "provider-phase2"],
  );
  const sent = (await migrator.query(
    `select delivery_status,provider_message_id,provider_attempt_count
     from public.communication_messages where id=$1`,
    [first.message.id],
  )).rows[0];
  assert.deepEqual(sent, {
    delivery_status: "SENT",
    provider_message_id: "provider-phase2",
    provider_attempt_count: 1,
  });

  await worker.query(
    `select public.record_worker_heartbeat($1,$2,$3,$4)`,
    ["COMMUNICATION_DELIVERY", true, null, { claimed: 1, sent: 1 }],
  );
  const readiness = (await system.query(
    `select public.service_readiness_snapshot_for_workers(
       $1,array['COMMUNICATION_DELIVERY']::text[]
     ) snapshot`,
    [workspaceId],
  )).rows[0].snapshot;
  assert.equal(readiness.missingWorkers, 0);
  assert.equal(readiness.staleWorkers, 0);
  assert.deepEqual(readiness.communicationDelivery, baselineCommunicationMetrics);

  const snapshot = await appTransaction(async () => (
    (await app.query(`select public.operational_snapshot() payload`))
      .rows[0].payload
  ));
  const queue = snapshot.queues.find(
    (candidate) => candidate.key === "COMMUNICATION_DELIVERY",
  );
  assert.ok(queue);
  assert.equal(queue.pending, baselineQueue.pending);

  const legacy = await migrator.query(
    `select
       has_function_privilege(
         'crm_system','public.service_complete_communication(uuid,text)','EXECUTE'
       ) complete_legacy,
       has_function_privilege(
         'crm_system','public.service_fail_communication(uuid,text)','EXECUTE'
       ) fail_legacy`,
  );
  assert.deepEqual(legacy.rows[0], {
    complete_legacy: true,
    fail_legacy: true,
  });

  process.stdout.write(
    "[communication-delivery-switch] PASS queue-only ownership, duplicate "
      + "idempotency, Worker claim/completion, heartbeat/readiness and rollback grants.\n",
  );
} finally {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
}
