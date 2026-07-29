import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import {
  authenticateAccount,
  createAccount,
  updateAccountPassword,
} from "../lib/auth/accounts";
import {
  createSession,
  loadSession,
} from "../lib/auth/session-store";
import {
  deleteTotpFactor,
  enrollTotp,
  verifyTotp,
} from "../lib/auth/totp";
import { withDatabaseContext } from "../lib/db/context";
import {
  closeDatabasePools,
  poolQuery,
} from "../lib/db/pools";

const workspaceId = process.env.CRM_WORKSPACE_ID?.trim();
if (!workspaceId) throw new Error("CRM_WORKSPACE_ID_REQUIRED");
const fixtureId = randomUUID();
const identifier = `db-smoke-${fixtureId}@invalid.local`;
const username = `db.smoke.${fixtureId.replaceAll("-", "").slice(0, 20)}`;
const password = `Sm0ke!${randomBytes(24).toString("base64url")}`;
const expectedMigrationCount = (await readdir(new URL("../db/migrations/", import.meta.url)))
  .filter((name) => name.endsWith(".sql")).length;
let fixtureUserId: string | null = null;
let fixtureAppointmentId: string | null = null;
let fixtureContactId: string | null = null;
let fixtureCommunicationThreadId: string | null = null;
let fixtureCommunicationMessageId: string | null = null;

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(value: string) {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("INVALID_BASE32");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totpCode(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

try {
  const schema = await poolQuery<{
    migrations: string;
    tables: string;
    rls_tables: string;
  }>(
    "system",
    `select
      (select count(*)::text from app_meta.schema_migrations) as migrations,
      (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r') as tables,
      (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r' and c.relrowsecurity) as rls_tables`,
  );
  assert.equal(Number(schema.rows[0]?.migrations), expectedMigrationCount);
  assert.ok(Number(schema.rows[0]?.tables) >= 96);
  assert.ok(Number(schema.rows[0]?.rls_tables) >= 96);

  fixtureUserId = (await createAccount({
    email: identifier,
    username,
    password,
    displayNameZh: "数据库测试",
    displayNameEn: "Database Smoke",
    workspaceId,
    role: "SUPER_ADMIN",
    mustChangePassword: false,
    emailVerified: true,
  })).id;
  const identity = await authenticateAccount(identifier, password);
  assert.ok(identity, "Argon2id authentication failed");
  assert.equal(identity.role, "SUPER_ADMIN");
  const session = await createSession({
    userId: identity.id,
    passwordVersion: identity.passwordVersion,
    persistent: false,
  });
  const loaded = await loadSession(session.token);
  assert.equal(loaded?.user.id, identity.id);
  assert.equal(loaded?.user.aal, "aal1");

  const factor = await enrollTotp(identity.id, "Database integration smoke");
  const code = totpCode(factor.secret);
  assert.equal(await verifyTotp(identity.id, factor.id, code), true);
  assert.equal(await verifyTotp(identity.id, factor.id, code), false, "TOTP replay was accepted");
  assert.equal(await deleteTotpFactor(identity.id, factor.id), true);

  const userContext = {
    kind: "user" as const,
    authorization: {
      userId: identity.id,
      workspaceId: identity.workspaceId,
      role: identity.role,
      aal: "aal2" as const,
    },
  };
  const profile = await withDatabaseContext(
    userContext,
    async (client) => {
      const context = await client.query<{ user_id: string | null; profile_visible: boolean }>(
        `select app_auth.current_user_id() as user_id,
                exists(
                  select 1 from public.user_profiles
                  where user_id=app_auth.current_user_id()
                ) as profile_visible`,
      );
      assert.equal(context.rows[0]?.user_id, identity.id);
      assert.equal(context.rows[0]?.profile_visible, true);
      await client.query(
        "select public.update_own_profile($1,$2,$3,$4)",
        ["资料原子更新", "Atomic Profile", "Dr.", "Committed together"],
      );
      const result = await client.query<{
        role: string;
        workspace_id: string;
        display_name_zh: string;
        bio: string;
      }>(
        `select public.current_crm_role() as role,
                public.current_workspace_id() as workspace_id,
                profile.display_name_zh,
                preferences.bio
         from public.user_profiles profile
         join public.user_preferences preferences on preferences.user_id=profile.user_id
         where profile.user_id=app_auth.current_user_id()`,
      );
      return result.rows[0];
    },
  );
  assert.equal(profile.role, "SUPER_ADMIN");
  assert.equal(profile.workspace_id, identity.workspaceId);
  assert.equal(profile.display_name_zh, "资料原子更新");
  assert.equal(profile.bio, "Committed together");
  await assert.rejects(
    withDatabaseContext(userContext, (client) => client.query(
      "select public.update_own_profile($1,$2,$3,$4)",
      ["不应保留", "Must Roll Back", "Dr.", null],
    )),
  );
  const rolledBackProfile = await withDatabaseContext(userContext, async (client) => (
    await client.query<{ display_name_zh: string }>(
      "select display_name_zh from public.user_profiles where user_id=app_auth.current_user_id()",
    )
  ).rows[0]);
  assert.equal(rolledBackProfile.display_name_zh, "资料原子更新");

  const appointmentRequestKey = `db-smoke:${fixtureId}`;
  const appointmentArguments = [
    "数据库幂等预约",
    "Database idempotent appointment",
    "MEETING",
    null,
    null,
    "Database smoke",
    "2030-01-15T02:00:00.000Z",
    "2030-01-15T03:00:00.000Z",
    "Test",
    [30],
    JSON.stringify([]),
    appointmentRequestKey,
  ];
  const appointmentSql = `select id,creation_request_key,creation_request_fingerprint
    from public.create_appointment_with_delivery(
      $1::text,$2::text,$3::text,$4::text,$5::uuid,$6::text,
      $7::timestamptz,$8::timestamptz,$9::text,$10::integer[],$11::jsonb,$12::text
    )`;
  const appointment = await withDatabaseContext(userContext, async (client) => {
    const first = (await client.query<{
      id: string;
      creation_request_key: string;
      creation_request_fingerprint: string;
    }>(appointmentSql, appointmentArguments)).rows[0];
    const replay = (await client.query<{ id: string }>(
      appointmentSql,
      appointmentArguments,
    )).rows[0];
    assert.equal(replay?.id, first?.id);
    const count = await client.query<{ count: string }>(
      `select count(*)::text from public.appointments
       where created_by=app_auth.current_user_id() and creation_request_key=$1`,
      [appointmentRequestKey],
    );
    assert.equal(Number(count.rows[0]?.count), 1);
    const inbox = (await client.query<{
      snapshot: { items: unknown[]; total: number; page: number; pageSize: number };
    }>(
      "select public.communication_inbox_page($1,$2,$3) as snapshot",
      ["", 1, 20],
    )).rows[0]?.snapshot;
    assert.ok(Array.isArray(inbox?.items));
    assert.equal(typeof inbox?.total, "number");
    assert.equal(inbox?.page, 1);
    assert.equal(inbox?.pageSize, 20);

    const contact = (await client.query<{ id: string }>(
      `insert into public.contacts(name_zh,name_en,email,owner_id,created_by)
       values($1,$2,$3,app_auth.current_user_id(),app_auth.current_user_id())
       returning id`,
      ["沟通分页测试", "Communication Pagination Smoke", `communication-${fixtureId}@invalid.local`],
    )).rows[0];
    assert.ok(contact?.id);
    fixtureContactId = contact.id;
    await client.query(
      "select public.save_contact_consent($1,$2,$3,$4,$5)",
      [contact.id, "EMAIL", "SERVICE", "GRANTED", "DATABASE_SMOKE"],
    );

    const threadRequestKey = `thread-smoke:${fixtureId}`;
    const threadSql = `select id,creation_request_key,creation_request_fingerprint
      from public.create_communication_thread($1::uuid,$2::text,$3::text,$4::text,$5::text)`;
    const threadArguments = [
      contact.id,
      "Database communication pagination",
      "EMAIL",
      "SERVICE",
      threadRequestKey,
    ];
    const createdThread = (await client.query<{
      id: string;
      creation_request_key: string;
      creation_request_fingerprint: string;
    }>(threadSql, threadArguments)).rows[0];
    assert.ok(createdThread?.id);
    fixtureCommunicationThreadId = createdThread.id;
    const replayedThread = (await client.query<{ id: string }>(
      threadSql,
      threadArguments,
    )).rows[0];
    assert.equal(replayedThread?.id, createdThread.id);
    assert.equal(createdThread.creation_request_key, threadRequestKey);
    assert.match(createdThread.creation_request_fingerprint, /^[a-f0-9]{64}$/);
    await client.query("savepoint communication_thread_conflict");
    await assert.rejects(
      client.query(threadSql, [
        contact.id,
        "Different communication payload",
        "EMAIL",
        "SERVICE",
        threadRequestKey,
      ]),
      /communication_thread_idempotency_conflict/,
    );
    await client.query("rollback to savepoint communication_thread_conflict");
    await client.query("release savepoint communication_thread_conflict");

    const messageKey = `message-smoke:${fixtureId}`;
    const queueSql = "select public.queue_communication_message($1,$2,$3) as result";
    const firstQueue = (await client.query<{
      result: { message: { id: string }; shouldDeliver: boolean };
    }>(queueSql, [createdThread.id, "Outbound database smoke", messageKey])).rows[0]?.result;
    assert.equal(firstQueue?.shouldDeliver, true);
    assert.ok(firstQueue?.message.id);
    fixtureCommunicationMessageId = firstQueue.message.id;
    const immediateReplay = (await client.query<{
      result: { message: { id: string }; shouldDeliver: boolean };
    }>(queueSql, [createdThread.id, "Outbound database smoke", messageKey])).rows[0]?.result;
    assert.equal(immediateReplay?.message.id, firstQueue?.message.id);
    assert.equal(immediateReplay?.shouldDeliver, false);

    await client.query(
      "select public.record_inbound_communication($1,$2,$3)",
      [createdThread.id, "Earlier inbound smoke", `inbound-a:${fixtureId}`],
    );
    await client.query(
      "select public.record_inbound_communication($1,$2,$3)",
      [createdThread.id, "Latest inbound smoke", `inbound-b:${fixtureId}`],
    );
    const inboxPage = (await client.query<{
      page: { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number };
    }>(
      "select public.communication_inbox_page($1,$2,$3) as page",
      ["Communication Pagination Smoke", 1, 1],
    )).rows[0]?.page;
    assert.equal(inboxPage?.page, 1);
    assert.equal(inboxPage?.pageSize, 1);
    assert.equal(inboxPage?.items.length, 1);
    assert.equal(inboxPage?.items[0]?.id, createdThread.id);
    assert.equal("messages" in (inboxPage?.items[0] ?? {}), false);
    const threadPage = (await client.query<{
      page: { id: string; messages: unknown[]; messageTotal: number; messagePage: number; messagePageSize: number };
    }>(
      "select public.communication_thread_snapshot($1,$2,$3) as page",
      [createdThread.id, null, 1],
    )).rows[0]?.page;
    assert.equal(threadPage?.id, createdThread.id);
    assert.equal(threadPage?.messageTotal, 3);
    assert.equal(threadPage?.messagePage, 3);
    assert.equal(threadPage?.messagePageSize, 1);
    assert.equal(threadPage?.messages.length, 1);
    return first;
  });
  assert.ok(appointment?.id);
  assert.equal(appointment.creation_request_key, appointmentRequestKey);
  assert.match(appointment.creation_request_fingerprint, /^[a-f0-9]{64}$/);
  fixtureAppointmentId = appointment.id;
  assert.ok(fixtureCommunicationThreadId);
  assert.ok(fixtureCommunicationMessageId);
  await withDatabaseContext({ kind: "system" }, (client) => client.query(
    "select public.service_complete_communication($1,$2)",
    [fixtureCommunicationMessageId, "database-smoke-receipt"],
  ));
  const successfulReplay = await withDatabaseContext(userContext, async (client) => (
    await client.query<{
      result: { message: { id: string; delivery_status: string }; shouldDeliver: boolean };
    }>(
      "select public.queue_communication_message($1,$2,$3) as result",
      [fixtureCommunicationThreadId, "Outbound database smoke", `message-smoke:${fixtureId}`],
    )
  ).rows[0]?.result);
  assert.equal(successfulReplay?.message.id, fixtureCommunicationMessageId);
  assert.equal(successfulReplay?.message.delivery_status, "SENT");
  assert.equal(successfulReplay?.shouldDeliver, false);
  await assert.rejects(
    withDatabaseContext(userContext, (client) => client.query(appointmentSql, [
      "不同负载",
      ...appointmentArguments.slice(1),
    ])),
    /appointment_idempotency_conflict/,
  );

  const changedPassword = `Changed!${randomBytes(24).toString("base64url")}`;
  await updateAccountPassword(identity.id, changedPassword, {
    clearMustChange: true,
    revokeSessions: true,
  });
  assert.equal(await loadSession(session.token), null);
  assert.equal((await authenticateAccount(identifier, changedPassword))?.id, identity.id);
  process.stdout.write(
    `[db:smoke] ${schema.rows[0].migrations} migrations, ${schema.rows[0].tables} tables, `
    + "Argon2id/session/TOTP/RLS/atomic-profile/appointment-idempotency/"
    + "communication-idempotency/pagination context verified.\n",
  );
} finally {
  if (fixtureCommunicationThreadId) {
    await poolQuery("system", "delete from public.communication_threads where id=$1", [fixtureCommunicationThreadId])
      .catch(() => undefined);
  }
  if (fixtureContactId) {
    await poolQuery("system", "delete from public.contacts where id=$1", [fixtureContactId])
      .catch(() => undefined);
  }
  if (fixtureAppointmentId) {
    await poolQuery("system", "delete from public.appointments where id=$1", [fixtureAppointmentId])
      .catch(() => undefined);
  }
  if (fixtureUserId) {
    await poolQuery("system", "delete from app_auth.accounts where id=$1", [fixtureUserId])
      .catch(() => undefined);
  }
  await closeDatabasePools();
}
