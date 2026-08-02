#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";

const connectionString = process.env.DATABASE_ADMIN_URL?.trim();
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required");
const { Client, escapeIdentifier } = pg;
const client = new Client({ connectionString, application_name:"lumina-staff-invitation-rls-test" });
const ordinaryRole = `lumina_rls_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const workspaceId = randomUUID();
const actorId = randomUUID();
const userId = randomUUID();
const deliveryId = randomUUID();

async function asRole(role, operation) {
  await client.query(`set local role ${escapeIdentifier(role)}`);
  try { return await operation(); } finally { await client.query("reset role"); }
}

async function denied(role, statement, parameters = []) {
  await client.query("savepoint expected_denial");
  try {
    await client.query(`set local role ${escapeIdentifier(role)}`);
    await assert.rejects(
      client.query(statement, parameters),
      (error) => ["42501", "42P01"].includes(error?.code),
    );
  } finally {
    await client.query("rollback to savepoint expected_denial");
  }
}

await client.connect();
try {
  await client.query(`create role ${escapeIdentifier(ordinaryRole)} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
  await client.query("begin");
  await client.query(
    "insert into public.workspaces(id,slug,name) values($1,$2,$3)",
    [workspaceId, `rls-${workspaceId.slice(0, 8)}`, "Invitation RLS Test"],
  );
  await client.query(
    `insert into app_auth.accounts(id,email,username,must_change_password)
     values($1,$2,$3,true),($4,$5,$6,true)`,
    [actorId, `actor-${actorId}@example.test`, `actor-${actorId.slice(0, 8)}`, userId, `user-${userId}@example.test`, `user-${userId.slice(0, 8)}`],
  );
  await client.query(
    `insert into public.workspace_memberships(workspace_id,user_id,role,status,must_change_password)
     values($1,$2,'ADMIN','ACTIVE',true),($1,$3,'SALES_SPECIALIST','ACTIVE',true)`,
    [workspaceId, actorId, userId],
  );

  await asRole("crm_system", async () => {
    await client.query(
      `insert into public.staff_invitation_deliveries(
         id,workspace_id,user_id,requested_by,request_key,outbox_id,status
       ) values($1,$2,$3,$4,$5,$1,'QUEUED')`,
      [deliveryId, workspaceId, userId, actorId, "rls-contract-test"],
    );
    assert.equal((await client.query("select id from public.staff_invitation_deliveries where id=$1", [deliveryId])).rowCount, 1);
    assert.equal((await client.query("update public.staff_invitation_deliveries set updated_at=now() where id=$1", [deliveryId])).rowCount, 1);
  });
  await denied("crm_system", "delete from public.staff_invitation_deliveries where id=$1", [deliveryId]);

  await asRole("crm_worker", async () => {
    await client.query("select public.record_staff_invitation_delivery($1,'SENT',null,202)", [deliveryId]);
  });
  assert.equal((await client.query("select status from public.staff_invitation_deliveries where id=$1", [deliveryId])).rows[0].status, "SENT");
  await denied("crm_worker", `insert into public.staff_invitation_deliveries(
    workspace_id,user_id,requested_by,request_key,status
  ) values($1,$2,$3,'worker-direct','QUEUED')`, [workspaceId,userId,actorId]);
  await denied("crm_worker", "delete from public.staff_invitation_deliveries where id=$1", [deliveryId]);

  await asRole("crm_app", async () => {
    await client.query("select set_config('app.user_id',$1,true),set_config('app.workspace_id',$2,true),set_config('app.role','ADMIN',true)", [actorId, workspaceId]);
    assert.equal((await client.query("select id from public.staff_invitation_deliveries where id=$1", [deliveryId])).rowCount, 1);
  });
  await denied("crm_app", `insert into public.staff_invitation_deliveries(
    workspace_id,user_id,requested_by,request_key,status
  ) values($1,$2,$3,'app-direct','QUEUED')`, [workspaceId,userId,actorId]);
  await denied("crm_app", "update public.staff_invitation_deliveries set updated_at=now() where id=$1", [deliveryId]);
  await denied("crm_app", "delete from public.staff_invitation_deliveries where id=$1", [deliveryId]);
  await denied(ordinaryRole, "select id from public.staff_invitation_deliveries limit 1");
  await denied(ordinaryRole, `insert into public.staff_invitation_deliveries(
    workspace_id,user_id,requested_by,request_key,status
  ) values($1,$2,$3,'ordinary-direct','QUEUED')`, [workspaceId,userId,actorId]);

  const functionContract = (await client.query(`
    select p.prosecdef, r.rolname as owner, p.proconfig
    from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid='public.record_staff_invitation_delivery(uuid,text,text,integer)'::regprocedure
  `)).rows[0];
  assert.equal(functionContract.prosecdef, true);
  assert.equal(functionContract.owner, "crm_migrator");
  assert.deepEqual(functionContract.proconfig, ["search_path=public, app_auth, extensions"]);
  const publicWrites = await client.query(`
    select privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='staff_invitation_deliveries'
      and grantee='PUBLIC' and privilege_type in ('INSERT','UPDATE','DELETE')
  `);
  assert.equal(publicWrites.rowCount, 0);
  await client.query("rollback");
  process.stdout.write("[staff-invitation-rls] crm_system, crm_worker, crm_app, ordinary-role and PUBLIC boundaries passed.\n");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.query(`drop role if exists ${escapeIdentifier(ordinaryRole)}`).catch(() => undefined);
  await client.end();
}
