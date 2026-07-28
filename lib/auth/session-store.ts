import { createHash, randomBytes } from "node:crypto";
import type { AppRole } from "../roles";
import type { AppUser } from "../user";
import { poolQuery, withPoolClient } from "../db/pools";
import type { AuthorizationContext } from "../db/context";

export const sessionCookieName = "crm_session";
export const csrfCookieName = "crm_csrf";
export const persistentSessionMaxAge = 60 * 60 * 24 * 30;
const transientSessionMaxAge = 60 * 60 * 12;
const sessionTouchIntervalMs = 5 * 60 * 1000;

type SessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  account_status: string;
  email_confirmed_at: string | null;
  account_must_change_password: boolean;
  session_aal: "aal1" | "aal2";
  last_seen_at: string;
  workspace_id: string;
  membership_status: string;
  membership_must_change_password: boolean;
  role: AppRole;
  username: string;
  display_name_zh: string;
  display_name_en: string;
  mfa_enabled: boolean;
};

export type AuthenticatedSession = {
  id: string;
  token: string;
  csrfToken: string;
  maxAge: number;
  user: AppUser;
  authorization: AuthorizationContext;
};

export function hashOpaqueValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function appUserFromRow(row: SessionRow): AppUser | null {
  if (row.account_status !== "ACTIVE" || row.membership_status !== "ACTIVE") return null;
  const displayName = row.display_name_en || row.email;
  return {
    id: row.user_id,
    username: row.username,
    email: row.email,
    displayName,
    displayNameZh: row.display_name_zh,
    role: row.role,
    initials: displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    mustChangePassword: row.account_must_change_password || row.membership_must_change_password,
    mfaEnabled: row.mfa_enabled,
    aal: row.session_aal,
    emailVerified: Boolean(row.email_confirmed_at),
    accountStatus: "ACTIVE",
  };
}

const sessionSelect = `
  select
    session.id as session_id,
    account.id as user_id,
    account.email::text,
    account.status as account_status,
    account.email_confirmed_at,
    account.must_change_password as account_must_change_password,
    session.aal as session_aal,
    session.last_seen_at,
    membership.workspace_id,
    membership.status as membership_status,
    membership.must_change_password as membership_must_change_password,
    membership.role,
    profile.username::text,
    profile.display_name_zh,
    profile.display_name_en,
    exists(
      select 1 from app_auth.totp_factors factor
      where factor.user_id = account.id and factor.status = 'VERIFIED'
    ) as mfa_enabled
  from app_auth.sessions session
  join app_auth.accounts account on account.id = session.user_id
  join public.workspace_memberships membership
    on membership.user_id = account.id and membership.status = 'ACTIVE'
  join public.user_profiles profile on profile.user_id = account.id
  where session.token_hash = $1
    and session.revoked_at is null
    and session.idle_expires_at > now()
    and session.absolute_expires_at > now()
    and session.password_version = account.password_version
  order by membership.created_at
  limit 1
`;

export async function loadSession(token: string | null | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) return null;
  const result = await poolQuery<SessionRow>("system", sessionSelect, [hashOpaqueValue(token)]);
  const row = result.rows[0];
  if (!row) return null;
  const user = appUserFromRow(row);
  if (!user) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() >= sessionTouchIntervalMs) {
    void poolQuery(
      "system",
      `update app_auth.sessions
       set last_seen_at = now(),
           idle_expires_at = least(absolute_expires_at, now() + interval '12 hours')
       where id = $1 and revoked_at is null`,
      [row.session_id],
    ).catch(() => undefined);
  }
  return {
    id: row.session_id,
    token,
    user,
    authorization: {
      userId: row.user_id,
      workspaceId: row.workspace_id,
      role: row.role,
      aal: row.session_aal,
    } satisfies AuthorizationContext,
  };
}

export async function createSession({
  userId,
  passwordVersion,
  aal = "aal1",
  persistent,
  request,
}: {
  userId: string;
  passwordVersion: number;
  aal?: "aal1" | "aal2";
  persistent: boolean;
  request?: Request;
}) {
  const token = randomOpaqueToken();
  const csrfToken = randomOpaqueToken(24);
  const maxAge = persistent ? persistentSessionMaxAge : transientSessionMaxAge;
  const source = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request?.headers.get("x-real-ip")
    ?? "";
  const userAgent = request?.headers.get("user-agent") ?? "";
  const result = await poolQuery<{ id: string }>(
    "system",
    `insert into app_auth.sessions(
      user_id, token_hash, csrf_hash, aal, password_version,
      source_hash, user_agent_hash, idle_expires_at, absolute_expires_at
    ) values(
      $1, $2, $3, $4, $5, $6, $7,
      now() + interval '12 hours',
      now() + ($8::text || ' seconds')::interval
    ) returning id`,
    [
      userId,
      hashOpaqueValue(token),
      hashOpaqueValue(csrfToken),
      aal,
      passwordVersion,
      source ? hashOpaqueValue(source) : null,
      userAgent ? hashOpaqueValue(userAgent) : null,
      maxAge,
    ],
  );
  await poolQuery(
    "system",
    "update app_auth.accounts set last_sign_in_at = now(), updated_at = now() where id = $1",
    [userId],
  );
  return { id: result.rows[0].id, token, csrfToken, maxAge };
}

export async function elevateSession(token: string, aal: "aal2") {
  await poolQuery(
    "system",
    "update app_auth.sessions set aal = $2, last_seen_at = now() where token_hash = $1 and revoked_at is null",
    [hashOpaqueValue(token), aal],
  );
}

export async function revokeSession(token: string, reason = "LOGOUT") {
  await poolQuery(
    "system",
    "update app_auth.sessions set revoked_at = now(), revoked_reason = $2 where token_hash = $1 and revoked_at is null",
    [hashOpaqueValue(token), reason],
  );
}

export async function revokeOtherSessions(userId: string, currentToken: string, reason = "REVOKED_BY_USER") {
  const result = await poolQuery(
    "system",
    `update app_auth.sessions set revoked_at = now(), revoked_reason = $3
     where user_id = $1 and token_hash <> $2 and revoked_at is null`,
    [userId, hashOpaqueValue(currentToken), reason],
  );
  return result.rowCount ?? 0;
}

export async function revokeAllUserSessions(userId: string, reason: string) {
  const result = await poolQuery(
    "system",
    `update app_auth.sessions set revoked_at = now(), revoked_reason = $2
     where user_id = $1 and revoked_at is null`,
    [userId, reason],
  );
  return result.rowCount ?? 0;
}

export async function rotateSessionToken(token: string) {
  const nextToken = randomOpaqueToken();
  const result = await poolQuery<{ id: string }>(
    "system",
    `update app_auth.sessions
     set token_hash = $2, last_seen_at = now(),
         idle_expires_at = least(absolute_expires_at, now() + interval '12 hours')
     where token_hash = $1 and revoked_at is null
       and idle_expires_at > now() and absolute_expires_at > now()
     returning id`,
    [hashOpaqueValue(token), hashOpaqueValue(nextToken)],
  );
  return result.rows[0] ? nextToken : null;
}

export async function sessionAccount(userId: string) {
  const result = await withPoolClient("system", (client) => client.query<{
    id: string;
    email: string;
    username: string | null;
    status: string;
    password_version: number;
  }>(
    "select id, email::text, username::text, status, password_version from app_auth.accounts where id = $1",
    [userId],
  ));
  return result.rows[0] ?? null;
}
