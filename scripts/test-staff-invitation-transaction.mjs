#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";

const adminUrl = process.env.DATABASE_ADMIN_URL?.trim();
const workspaceId = process.env.CRM_WORKSPACE_ID?.trim();
if (!adminUrl || !workspaceId || !process.env.SYSTEM_DATABASE_URL) {
  throw new Error("DATABASE_ADMIN_URL, SYSTEM_DATABASE_URL and CRM_WORKSPACE_ID are required");
}
process.env.INVITATION_CREDENTIAL_ENCRYPTION_KEY ||= randomBytes(32).toString("hex");
process.env.APP_URL ||= "http://127.0.0.1:3200";

const { Client, escapeIdentifier, escapeLiteral } = pg;
const admin = new Client({ connectionString:adminUrl,application_name:"lumina-staff-invitation-transaction-test" });
const actorId = randomUUID();
const successfulUserId = randomUUID();
const failedUserId = randomUUID();
const notPendingUserId = randomUUID();
const triggerSuffix = randomUUID().replaceAll("-", "").slice(0, 12);
const functionName = `fail_invitation_outbox_${triggerSuffix}`;
const triggerName = `fail_invitation_outbox_${triggerSuffix}`;
const initialHash = "$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$Y29tcGF0aWJpbGl0eWhhc2g";
const actor = {
  id:actorId,email:"actor@example.test",username:"transaction.actor",
  displayName:"Transaction Actor",displayNameZh:"事务管理员",initials:"TA",
  role:"ADMIN",mfaEnabled:true,emailVerified:true,aal:"aal2",
};

async function insertAccount(userId, username, pending = true) {
  await admin.query(
    `insert into app_auth.accounts(id,email,username,must_change_password)
     values($1,$2,$3,$4)`,
    [userId, `${username}@example.test`, username, pending],
  );
  await admin.query(
    `insert into public.user_profiles(user_id,username,display_name_zh,display_name_en)
     values($1,$2,'邀请测试','Invitation Test')`,
    [userId, username],
  );
  await admin.query(
    `insert into public.workspace_memberships(workspace_id,user_id,role,status,must_change_password)
     values($1,$2,'SALES_SPECIALIST','ACTIVE',$3)`,
    [workspaceId, userId, pending],
  );
  await admin.query(
    `insert into app_auth.password_credentials(user_id,password_hash,parameters)
     values($1,$2,'{}')`,
    [userId, initialHash],
  );
  await admin.query(
    `insert into app_auth.sessions(
       user_id,token_hash,csrf_hash,password_version,created_at,last_seen_at,idle_expires_at,absolute_expires_at
     ) values($1,$2,$3,1,now(),now(),now()+interval '1 hour',now()+interval '2 hours')`,
    [userId, randomBytes(32).toString("hex"), randomBytes(32).toString("hex")],
  );
}

await admin.connect();
try {
  await admin.query(
    `insert into app_auth.accounts(id,email,username,must_change_password)
     values($1,$2,'transaction.actor',false)`,
    [actorId, `actor-${actorId}@example.test`],
  );
  await admin.query(
    `insert into public.user_profiles(user_id,username,display_name_zh,display_name_en)
     values($1,'transaction.actor','事务管理员','Transaction Actor')`,
    [actorId],
  );
  await admin.query(
    `insert into public.workspace_memberships(workspace_id,user_id,role,status,must_change_password)
     values($1,$2,'ADMIN','ACTIVE',false)`,
    [workspaceId, actorId],
  );
  await insertAccount(successfulUserId, `invite-${successfulUserId.slice(0, 8)}`);
  await insertAccount(failedUserId, `invite-${failedUserId.slice(0, 8)}`);
  await insertAccount(notPendingUserId, `invite-${notPendingUserId.slice(0, 8)}`, false);

  const { resendStaffInvitation } = await import("../lib/admin-users-repository.ts");
  const { DatabaseRequestError } = await import("../lib/db/gateway.ts");
  const { closeDatabasePools } = await import("../lib/db/pools.ts");
  try {
    const first = await resendStaffInvitation(successfulUserId, "transaction-success", actor);
    assert.equal(first.invitationDeliveryStatus, "QUEUED");
    const successful = (await admin.query(`
      select a.password_version,a.must_change_password,p.password_hash,
        (select count(*) from app_auth.sessions s where s.user_id=a.id and s.revoked_at is not null) as revoked,
        (select count(*) from public.staff_invitation_deliveries d where d.user_id=a.id and d.status='QUEUED') as deliveries,
        (select count(*) from public.notification_outbox o where o.recipient_id=a.id and o.status='PENDING') as outbox,
        (select count(*) from public.audit_events e where e.entity_id=a.id::text and e.action='INVITATION_QUEUED') as audits
      from app_auth.accounts a join app_auth.password_credentials p on p.user_id=a.id where a.id=$1
    `, [successfulUserId])).rows[0];
    assert.equal(successful.password_version, 2);
    assert.equal(successful.must_change_password, true);
    assert.notEqual(successful.password_hash, initialHash);
    assert.deepEqual([successful.revoked,successful.deliveries,successful.outbox,successful.audits], ["1","1","1","1"]);
    const replay = await resendStaffInvitation(successfulUserId, "transaction-success", actor);
    assert.equal(replay.invitationDeliveryStatus, "QUEUED");
    assert.equal((await admin.query("select password_version from app_auth.accounts where id=$1", [successfulUserId])).rows[0].password_version, 2);
    assert.equal((await admin.query("select count(*) from public.notification_outbox where recipient_id=$1", [successfulUserId])).rows[0].count, "1");

    await admin.query(`create function public.${escapeIdentifier(functionName)}() returns trigger language plpgsql as ${escapeLiteral(`begin if new.recipient_id='${failedUserId}'::uuid then raise exception 'TEST_OUTBOX_FAILURE'; end if; return new; end`)} `);
    await admin.query(`create trigger ${escapeIdentifier(triggerName)} before insert on public.notification_outbox for each row execute function public.${escapeIdentifier(functionName)}()`);
    await assert.rejects(resendStaffInvitation(failedUserId, "transaction-failure", actor), /TEST_OUTBOX_FAILURE/);
    const failed = (await admin.query(`
      select a.password_version,p.password_hash,
        (select count(*) from app_auth.sessions s where s.user_id=a.id and s.revoked_at is not null) as revoked,
        (select count(*) from public.staff_invitation_deliveries d where d.user_id=a.id) as deliveries
      from app_auth.accounts a join app_auth.password_credentials p on p.user_id=a.id where a.id=$1
    `, [failedUserId])).rows[0];
    assert.deepEqual([failed.password_version,failed.password_hash,failed.revoked,failed.deliveries], [1,initialHash,"0","0"]);

    await assert.rejects(
      resendStaffInvitation(notPendingUserId, "transaction-not-pending", actor),
      (error) => error instanceof DatabaseRequestError && error.status === 409 && error.code === "STAFF_INVITATION_NOT_PENDING",
    );
  } finally {
    await closeDatabasePools();
  }
  process.stdout.write("[staff-invitation-transaction] success, replay, rollback and pending-state contracts passed.\n");
} finally {
  await admin.query(`drop trigger if exists ${escapeIdentifier(triggerName)} on public.notification_outbox`).catch(() => undefined);
  await admin.query(`drop function if exists public.${escapeIdentifier(functionName)}()`).catch(() => undefined);
  await admin.query("delete from app_auth.accounts where id=any($1::uuid[])", [[actorId,successfulUserId,failedUserId,notPendingUserId]]).catch(() => undefined);
  await admin.end();
}
