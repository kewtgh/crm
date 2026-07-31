import type { PoolClient } from "pg";
import type { AppRole } from "../roles";
import type { AppUser } from "../user";
import { withPoolClient } from "../db/pools";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "./password";
import { revokeAllUserSessions } from "./session-store";

export type AccountIdentity = {
  id: string;
  email: string;
  username: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  passwordVersion: number;
  passwordHash: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  workspaceId: string;
  role: AppRole;
  membershipStatus: "ACTIVE" | "SUSPENDED";
  displayNameZh: string;
  displayNameEn: string;
  mfaEnabled: boolean;
};

export function appUserFromIdentity(identity: AccountIdentity, aal: "aal1" | "aal2" = "aal1"): AppUser {
  const displayName = identity.displayNameEn || identity.email;
  return {
    id: identity.id,
    username: identity.username,
    email: identity.email,
    displayName,
    displayNameZh: identity.displayNameZh,
    role: identity.role,
    initials: displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    mustChangePassword: identity.mustChangePassword,
    mfaEnabled: identity.mfaEnabled,
    aal,
    emailVerified: identity.emailVerified,
    accountStatus: "ACTIVE",
  };
}

const identitySelect = `
  select
    account.id,
    account.email::text,
    profile.username::text,
    account.status,
    account.password_version as "passwordVersion",
    credential.password_hash as "passwordHash",
    account.email_confirmed_at is not null as "emailVerified",
    account.must_change_password or membership.must_change_password as "mustChangePassword",
    membership.workspace_id as "workspaceId",
    membership.role,
    membership.status as "membershipStatus",
    profile.display_name_zh as "displayNameZh",
    profile.display_name_en as "displayNameEn",
    exists(
      select 1 from app_auth.totp_factors factor
      where factor.user_id = account.id and factor.status = 'VERIFIED'
    ) as "mfaEnabled"
  from app_auth.accounts account
  join app_auth.password_credentials credential on credential.user_id = account.id
  join public.user_profiles profile on profile.user_id = account.id
  join public.workspace_memberships membership
    on membership.user_id = account.id
  where %CONDITION%
  order by membership.created_at
  limit 1
`;

export async function findAccountByIdentifier(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return withPoolClient("system", async (client) => {
    const result = await client.query<AccountIdentity>(
      identitySelect.replace(
        "%CONDITION%",
        "account.email = $1 or profile.username = $1",
      ),
      [normalized],
    );
    return result.rows[0] ?? null;
  });
}

export async function findAccountById(userId: string) {
  return withPoolClient("system", async (client) => {
    const result = await client.query<AccountIdentity>(
      identitySelect.replace("%CONDITION%", "account.id = $1"),
      [userId],
    );
    return result.rows[0] ?? null;
  });
}

export async function authenticateAccount(identifier: string, password: string) {
  const identity = await findAccountByIdentifier(identifier);
  if (
    !identity
    || identity.status !== "ACTIVE"
    || identity.membershipStatus !== "ACTIVE"
    || !await verifyPassword(identity.passwordHash, password)
  ) {
    return null;
  }
  if (passwordNeedsRehash(identity.passwordHash)) {
    const nextHash = await hashPassword(password);
    await withPoolClient("system", (client) => client.query(
      "update app_auth.password_credentials set password_hash = $2, updated_at = now() where user_id = $1",
      [identity.id, nextHash],
    ));
    identity.passwordHash = nextHash;
  }
  return identity;
}

export async function updateAccountPassword(
  userId: string,
  password: string,
  options: { clearMustChange?: boolean; revokeSessions?: boolean } = {},
) {
  const passwordHash = await hashPassword(password);
  await withPoolClient("system", async (client) => {
    await client.query("begin");
    try {
      const account = await client.query<{ password_version: number }>(
        `update app_auth.accounts
         set password_version = password_version + 1,
             must_change_password = case when $2 then false else must_change_password end,
             updated_at = now()
         where id = $1
         returning password_version`,
        [userId, options.clearMustChange === true],
      );
      if (!account.rows[0]) throw new Error("ACCOUNT_NOT_FOUND");
      await client.query(
        `insert into app_auth.password_credentials(user_id, password_hash, parameters)
         values($1, $2, $3)
         on conflict(user_id) do update
         set password_hash = excluded.password_hash,
             parameters = excluded.parameters,
             updated_at = now()`,
        [userId, passwordHash, { algorithm: "argon2id", memoryCost: 65_536, timeCost: 3, parallelism: 1 }],
      );
      if (options.clearMustChange) {
        await client.query(
          "update public.workspace_memberships set must_change_password = false where user_id = $1",
          [userId],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
  if (options.revokeSessions !== false) await revokeAllUserSessions(userId, "PASSWORD_CHANGED");
}

export async function createAccount({
  email,
  username,
  password,
  displayNameZh,
  displayNameEn,
  workspaceId,
  role,
  mustChangePassword,
  emailVerified,
  team,
  managerMemberId,
  afterCreate,
}: {
  email: string;
  username: string;
  password: string;
  displayNameZh: string;
  displayNameEn: string;
  workspaceId: string;
  role: AppRole;
  mustChangePassword: boolean;
  emailVerified: boolean;
  team?: string;
  managerMemberId?: string | null;
  afterCreate?: (client: PoolClient, userId: string) => Promise<void>;
}) {
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  return withPoolClient("system", async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `insert into app_auth.accounts(
          id, email, username, status, email_confirmed_at, must_change_password
        ) values($1, $2, $3, 'ACTIVE', case when $4 then now() else null end, $5)`,
        [id, email.trim().toLowerCase(), username.trim().toLowerCase(), emailVerified, mustChangePassword],
      );
      await client.query(
        `insert into app_auth.password_credentials(user_id, password_hash, parameters)
         values($1, $2, $3)`,
        [id, passwordHash, { algorithm: "argon2id", memoryCost: 65_536, timeCost: 3, parallelism: 1 }],
      );
      await client.query(
        `insert into public.user_profiles(user_id, username, display_name_zh, display_name_en)
         values($1, $2, $3, $4)`,
        [id, username.trim().toLowerCase(), displayNameZh.trim(), displayNameEn.trim()],
      );
      await client.query(
        `insert into public.workspace_memberships(
          workspace_id, user_id, role, status, must_change_password
        ) values($1, $2, $3, 'ACTIVE', $4)`,
        [workspaceId, id, role, mustChangePassword],
      );
      if (role.startsWith("SALES_")) {
        await client.query(
          `insert into public.sales_team_members(
            workspace_id, auth_user_id, name_zh, name_en, role, team, manager_member_id, active
          ) values($1, $2, $3, $4, $5, $6, $7, true)`,
          [workspaceId, id, displayNameZh.trim(), displayNameEn.trim(), role, team ?? "", managerMemberId ?? null],
        );
      }
      await afterCreate?.(client, id);
      await client.query("commit");
      return { id };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}

export async function recordLoginEvent({
  userId,
  sessionId,
  outcome,
  reason,
  request,
}: {
  userId?: string | null;
  sessionId?: string | null;
  outcome: string;
  reason?: string;
  request?: Request;
}) {
  const source = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request?.headers.get("x-real-ip")
    ?? "";
  const userAgent = request?.headers.get("user-agent") ?? "";
  await withPoolClient("system", (client: PoolClient) => client.query(
    `insert into app_auth.login_events(
      user_id, session_id, outcome, reason, source_hash, user_agent_hash
    ) values($1, $2, $3, $4, encode(extensions.digest($5, 'sha256'), 'hex'), encode(extensions.digest($6, 'sha256'), 'hex'))`,
    [userId ?? null, sessionId ?? null, outcome, reason ?? null, source, userAgent],
  ));
}
