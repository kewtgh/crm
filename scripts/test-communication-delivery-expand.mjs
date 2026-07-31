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
const actorId = "97000000-0000-4000-8000-000000000070";
const contactId = "97000000-0000-4000-8000-000000000071";
const noEmailContactId = "97000000-0000-4000-8000-000000000072";
const threadId = "97000000-0000-4000-8000-000000000073";
const noEmailThreadId = "97000000-0000-4000-8000-000000000074";
let sequence = 100;
const nextId = () => `97000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;

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
const workerA = await connect(urls.worker);
const workerB = await connect(urls.worker);

async function seedMessage({
  id = nextId(),
  targetThread = threadId,
  direction = "OUTBOUND",
  status = direction === "INBOUND" ? "RECEIVED" : "QUEUED",
  due = true,
  body = `phase1-${sequence}`,
} = {}) {
  await migrator.query(
    `insert into public.communication_messages(
       id,workspace_id,thread_id,direction,body,delivery_status,sent_by,
       idempotency_key,attempt_count,last_attempt_at,next_attempt_at
     ) values($1,$2,$3,$4,$5,$6,$7,$8,1,now(),$9)`,
    [
      id,
      workspaceId,
      targetThread,
      direction,
      body,
      status,
      actorId,
      `phase1:${id}`,
      due ? new Date() : null,
    ],
  );
  return id;
}

async function claim(client, workerId, batchSize = 1) {
  return (await client.query(
    `select * from public.claim_communication_deliveries_leased($1,$2,$3,$4)`,
    [workspaceId, batchSize, workerId, 300],
  )).rows;
}

async function row(id) {
  return (await migrator.query(
    `select * from public.communication_messages where id=$1`,
    [id],
  )).rows[0];
}

try {
  await migrator.query(
    `delete from public.audit_events
     where actor_id=$1 or entity_id like '97000000-%'`,
    [actorId],
  );
  await migrator.query(
    `delete from public.communication_threads where id in($1,$2)`,
    [threadId, noEmailThreadId],
  );
  await migrator.query(
    `delete from public.contacts where id in($1,$2)`,
    [contactId, noEmailContactId],
  );
  await migrator.query(
    `delete from public.workspace_memberships where user_id=$1`,
    [actorId],
  );
  await migrator.query(`delete from app_auth.accounts where id=$1`, [actorId]);
  await migrator.query(
    `insert into app_auth.accounts(
       id,email,username,status
     ) values($1,$2,$3,'ACTIVE')
     on conflict(id) do nothing`,
    [
      actorId,
      "phase1-worker@example.test",
      "phase1.worker",
    ],
  );
  await migrator.query(
    `insert into public.workspace_memberships(workspace_id,user_id,role,status)
     values($1,$2,'ADMIN','ACTIVE')
     on conflict(workspace_id,user_id) do update set status='ACTIVE',role='ADMIN'`,
    [workspaceId, actorId],
  );
  await migrator.query(
    `insert into public.contacts(
       id,workspace_id,name_zh,name_en,email,created_by
     ) values
       ($1,$3,'阶段一联系人','Phase One Contact','user@example.test',$4),
       ($2,$3,'无邮箱联系人','No Email Contact',null,$4)
     on conflict(id) do nothing`,
    [contactId, noEmailContactId, workspaceId, actorId],
  );
  await migrator.query(
    `insert into public.contact_consents(
       workspace_id,contact_id,channel,purpose,status,source,
       obtained_at,created_by,updated_by
     ) values($1,$2,'EMAIL','SERVICE','GRANTED','PHASE1_TEST',now(),$3,$3)
     on conflict(workspace_id,contact_id,channel,purpose)
     do update set status='GRANTED',obtained_at=now(),revoked_at=null`,
    [workspaceId, contactId, actorId],
  );
  await migrator.query(
    `insert into public.communication_threads(
       id,workspace_id,contact_id,subject,channel,purpose,status,
       assigned_to,created_by
     ) values
       ($1,$3,$4,'Phase 1 delivery','EMAIL','SERVICE','OPEN',$6,$6),
       ($2,$3,$5,'Phase 1 missing email','EMAIL','SERVICE','OPEN',$6,$6)
     on conflict(id) do nothing`,
    [threadId, noEmailThreadId, workspaceId, contactId, noEmailContactId, actorId],
  );

  const privilege = await migrator.query(
    `select
       has_function_privilege('crm_worker',
         'public.claim_communication_deliveries_leased(uuid,integer,text,integer)',
         'EXECUTE') worker_claim,
       has_function_privilege('crm_system',
         'public.claim_communication_deliveries_leased(uuid,integer,text,integer)',
         'EXECUTE') system_claim,
       has_function_privilege('crm_app',
         'public.requeue_failed_communication_delivery(uuid)',
         'EXECUTE') app_retry,
       has_function_privilege('crm_worker',
         'public.requeue_failed_communication_delivery(uuid)',
         'EXECUTE') worker_retry,
       has_table_privilege('crm_worker','public.communication_messages','INSERT') worker_insert,
       has_table_privilege('crm_worker','public.communication_messages','UPDATE') worker_update,
       has_table_privilege('crm_worker','public.communication_messages','DELETE') worker_delete`,
  );
  assert.deepEqual(privilege.rows[0], {
    worker_claim: true,
    system_claim: false,
    app_retry: true,
    worker_retry: false,
    worker_insert: false,
    worker_update: false,
    worker_delete: false,
  });

  const sameRow = await seedMessage();
  const sameClaims = await Promise.all([
    claim(workerA, "phase1-a"),
    claim(workerB, "phase1-b"),
  ]);
  assert.equal(sameClaims.flat().length, 1);
  assert.equal(sameClaims.flat()[0].message_id, sameRow);

  await migrator.query(
    `update public.communication_messages
     set delivery_status='FAILED',locked_at=null,lease_expires_at=null,
       locked_by=null,lease_token=null,dead_lettered_at=now(),
       delivery_failure_code='PROVIDER_REJECTED',last_error='PROVIDER_REJECTED'
     where id=$1`,
    [sameRow],
  );
  const independentA = await seedMessage();
  const independentB = await seedMessage();
  const independentClaims = await Promise.all([
    claim(workerA, "phase1-independent-a"),
    claim(workerB, "phase1-independent-b"),
  ]);
  assert.deepEqual(
    new Set(independentClaims.flat().map((item) => item.message_id)),
    new Set([independentA, independentB]),
  );

  const safeRecovery = await seedMessage();
  const [safeLease] = await claim(workerA, "phase1-safe");
  assert.equal(safeLease.message_id, safeRecovery);
  await migrator.query(
    `update public.communication_messages
     set locked_at=now()-interval '10 minutes',
       lease_expires_at=now()-interval '1 second'
     where id=$1`,
    [safeRecovery],
  );
  const [recoveredLease] = await claim(workerB, "phase1-recovered");
  assert.equal(recoveredLease.message_id, safeRecovery);
  assert.notEqual(recoveredLease.lease_token, safeLease.lease_token);
  await assert.rejects(
    workerA.query(
      `select public.complete_communication_delivery_leased($1,$2,$3,$4)`,
      [safeRecovery, "phase1-safe", safeLease.lease_token, "provider-stale"],
    ),
    /communication_delivery_lease_lost/,
  );
  await assert.rejects(
    workerA.query(
      `select public.fail_communication_delivery_leased($1,$2,$3,$4,$5)`,
      [
        safeRecovery,
        "phase1-safe",
        safeLease.lease_token,
        "PROVIDER_REJECTED",
        "DEFINITE_PERMANENT",
      ],
    ),
    /communication_delivery_lease_lost/,
  );

  await workerB.query(
    `select public.mark_communication_delivery_attempt_started_leased($1,$2,$3)`,
    [safeRecovery, "phase1-recovered", recoveredLease.lease_token],
  );
  const duplicateStart = await workerB.query(
    `select public.mark_communication_delivery_attempt_started_leased($1,$2,$3) count`,
    [safeRecovery, "phase1-recovered", recoveredLease.lease_token],
  );
  assert.equal(duplicateStart.rows[0].count, 1);
  await migrator.query(
    `update public.communication_messages
     set locked_at=now()-interval '10 minutes',
       lease_expires_at=now()-interval '1 second'
     where id=$1`,
    [safeRecovery],
  );
  assert.deepEqual(await claim(workerA, "phase1-uncertain-recovery"), []);
  assert.equal((await row(safeRecovery)).delivery_status, "UNCERTAIN");

  const completionId = await seedMessage();
  const [completionLease] = await claim(workerA, "phase1-completion");
  await workerA.query(
    `select public.mark_communication_delivery_attempt_started_leased($1,$2,$3)`,
    [completionId, "phase1-completion", completionLease.lease_token],
  );
  for (const invalidProviderId of ["", "bad\rreceipt", "x".repeat(241)]) {
    await assert.rejects(
      workerA.query(
        `select public.complete_communication_delivery_leased($1,$2,$3,$4)`,
        [completionId, "phase1-completion", completionLease.lease_token, invalidProviderId],
      ),
      /communication_delivery_provider_receipt_invalid/,
    );
  }
  await workerA.query(
    `select public.complete_communication_delivery_leased($1,$2,$3,$4)`,
    [completionId, "phase1-completion", completionLease.lease_token, "provider-confirmed"],
  );
  await workerA.query(
    `select public.complete_communication_delivery_leased($1,$2,$3,$4)`,
    [completionId, "phase1-completion", completionLease.lease_token, "provider-confirmed"],
  );
  assert.equal((await row(completionId)).provider_message_id, "provider-confirmed");

  const retryableId = await seedMessage();
  const [retryableLease] = await claim(workerA, "phase1-retryable");
  await workerA.query(
    `select public.mark_communication_delivery_attempt_started_leased($1,$2,$3)`,
    [retryableId, "phase1-retryable", retryableLease.lease_token],
  );
  const retryable = await workerA.query(
    `select public.fail_communication_delivery_leased($1,$2,$3,$4,$5) status`,
    [
      retryableId,
      "phase1-retryable",
      retryableLease.lease_token,
      "PROVIDER_UNAVAILABLE",
      "DEFINITE_RETRYABLE",
    ],
  );
  assert.equal(retryable.rows[0].status, "QUEUED");
  const retryableRow = await row(retryableId);
  assert.ok(new Date(retryableRow.next_attempt_at) > new Date());
  assert.ok(
    new Date(retryableRow.next_attempt_at).getTime() - Date.now()
      <= 360 * 60 * 1_000,
  );

  const permanentId = await seedMessage();
  const [permanentLease] = await claim(workerA, "phase1-permanent");
  await workerA.query(
    `select public.mark_communication_delivery_attempt_started_leased($1,$2,$3)`,
    [permanentId, "phase1-permanent", permanentLease.lease_token],
  );
  const permanent = await workerA.query(
    `select public.fail_communication_delivery_leased($1,$2,$3,$4,$5) status`,
    [
      permanentId,
      "phase1-permanent",
      permanentLease.lease_token,
      "PROVIDER_REJECTED",
      "DEFINITE_PERMANENT",
    ],
  );
  assert.equal(permanent.rows[0].status, "FAILED");
  assert.ok((await row(permanentId)).dead_lettered_at);

  const uncertainId = await seedMessage();
  const [uncertainLease] = await claim(workerA, "phase1-possibly-accepted");
  await workerA.query(
    `select public.mark_communication_delivery_attempt_started_leased($1,$2,$3)`,
    [uncertainId, "phase1-possibly-accepted", uncertainLease.lease_token],
  );
  await migrator.query(
    `update public.communication_messages
     set created_at=now()-interval '25 hours',
       first_provider_attempt_at=now()-interval '24 hours',
       last_provider_attempt_at=now()-interval '24 hours'
     where id=$1`,
    [uncertainId],
  );
  const uncertain = await workerA.query(
    `select public.fail_communication_delivery_leased($1,$2,$3,$4,$5) status`,
    [
      uncertainId,
      "phase1-possibly-accepted",
      uncertainLease.lease_token,
      "PROVIDER_INVALID_RESPONSE",
      "POSSIBLY_ACCEPTED",
    ],
  );
  assert.equal(uncertain.rows[0].status, "UNCERTAIN");
  await app.query("begin");
  await app.query("select set_config('app.user_id',$1,true)", [actorId]);
  await app.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
  await app.query("select set_config('app.role','ADMIN',true)");
  await app.query("select set_config('app.aal','aal2',true)");
  await assert.rejects(
    app.query(`select public.requeue_failed_communication_delivery($1)`, [uncertainId]),
    /communication_delivery_not_retryable/,
  );
  await app.query("rollback");

  await migrator.query(
    `update public.contact_consents
     set status='REVOKED',revoked_at=now(),updated_at=now()
     where workspace_id=$1 and contact_id=$2 and channel='EMAIL' and purpose='SERVICE'`,
    [workspaceId, contactId],
  );
  const revokedId = await seedMessage();
  assert.deepEqual(await claim(workerA, "phase1-revoked"), []);
  assert.equal((await row(revokedId)).delivery_failure_code, "CONSENT_REVOKED");
  await migrator.query(
    `update public.contact_consents
     set status='GRANTED',obtained_at=now(),revoked_at=null,updated_at=now()
     where workspace_id=$1 and contact_id=$2 and channel='EMAIL' and purpose='SERVICE'`,
    [workspaceId, contactId],
  );

  const noEmailId = await seedMessage({ targetThread: noEmailThreadId });
  assert.deepEqual(await claim(workerA, "phase1-no-email"), []);
  assert.equal(
    (await row(noEmailId)).delivery_failure_code,
    "RECIPIENT_EMAIL_UNAVAILABLE",
  );

  const inboundId = await seedMessage({ direction: "INBOUND" });
  assert.deepEqual(await claim(workerA, "phase1-inbound"), []);
  assert.equal((await row(inboundId)).delivery_status, "RECEIVED");

  const maximumId = await seedMessage();
  await migrator.query(
    `update public.communication_messages
     set created_at=now()-interval '2 hours',
       provider_attempt_count=8,
       first_provider_attempt_at=now()-interval '1 hour',
       last_provider_attempt_at=now()-interval '1 minute',
       last_provider_attempt_lease_token=gen_random_uuid()
     where id=$1`,
    [maximumId],
  );
  assert.deepEqual(await claim(workerA, "phase1-maximum"), []);
  assert.equal((await row(maximumId)).delivery_failure_code, "MAX_PROVIDER_ATTEMPTS");

  const auditedRetryId = await seedMessage();
  await migrator.query(
    `update public.communication_messages
     set delivery_status='FAILED',next_attempt_at=null,
       delivery_failure_code='PROVIDER_REJECTED',
       last_error='PROVIDER_REJECTED',dead_lettered_at=now()
     where id=$1`,
    [auditedRetryId],
  );
  await app.query("begin");
  await app.query("select set_config('app.user_id',$1,true)", [actorId]);
  await app.query("select set_config('app.workspace_id',$1,true)", [workspaceId]);
  await app.query("select set_config('app.role','ADMIN',true)");
  await app.query("select set_config('app.aal','aal2',true)");
  await app.query(
    `select public.requeue_failed_communication_delivery($1)`,
    [auditedRetryId],
  );
  await app.query("commit");
  assert.equal((await row(auditedRetryId)).delivery_status, "QUEUED");
  assert.equal(
    Number((await migrator.query(
      `select count(*) count from public.audit_events
       where entity_type='communication_message' and entity_id=$1
         and action='REQUEUE_DELIVERY'`,
      [auditedRetryId],
    )).rows[0].count),
    1,
  );

  const legacyCompleteId = await seedMessage({ due: false });
  await system.query("begin");
  await system.query("select set_config('app.system','true',true)");
  await system.query(
    `select public.service_complete_communication($1,$2)`,
    [legacyCompleteId, "legacy-provider-id"],
  );
  await system.query("commit");
  assert.equal((await row(legacyCompleteId)).delivery_status, "SENT");
  const legacyFailId = await seedMessage({ due: false });
  await system.query("begin");
  await system.query("select set_config('app.system','true',true)");
  await system.query(
    `select public.service_fail_communication($1,$2)`,
    [legacyFailId, "DELIVERY_503"],
  );
  await system.query("commit");
  assert.equal((await row(legacyFailId)).delivery_status, "FAILED");

  process.stdout.write(
    "[communication-delivery-expand] PASS concurrency, fencing, recovery, "
      + "backoff, uncertainty, consent, grants, audit and legacy compatibility.\n",
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
}
