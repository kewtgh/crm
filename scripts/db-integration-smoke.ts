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
  const changedPassword = `Changed!${randomBytes(24).toString("base64url")}`;
  await updateAccountPassword(identity.id, changedPassword, {
    clearMustChange: true,
    revokeSessions: true,
  });
  assert.equal(await loadSession(session.token), null);
  assert.equal((await authenticateAccount(identifier, changedPassword))?.id, identity.id);
  process.stdout.write(
    `[db:smoke] ${schema.rows[0].migrations} migrations, ${schema.rows[0].tables} tables, `
    + "Argon2id/session/TOTP/RLS/atomic-profile context verified.\n",
  );
} finally {
  if (fixtureUserId) {
    await poolQuery("system", "delete from app_auth.accounts where id=$1", [fixtureUserId])
      .catch(() => undefined);
  }
  await closeDatabasePools();
}
