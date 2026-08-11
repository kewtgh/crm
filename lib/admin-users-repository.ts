import type { PoolClient } from "pg";
import type { AppRole } from "./roles";
import type { AppUser } from "./user";
import { createAccount } from "./auth/accounts";
import { hashPassword } from "./auth/password";
import { withPoolClient } from "./db/pools";
import { DatabaseRequestError } from "./db/gateway";
import { applicationOrigin } from "./application-origin.mjs";
import { encryptInvitationCredential } from "./invitation-credential-crypto.mjs";

export type StaffUserRecord = {
  id: string;
  username: string;
  displayNameZh: string;
  displayNameEn: string;
  email: string;
  role: AppRole;
  status: "ACTIVE" | "SUSPENDED";
  lastSignInAt: string | null;
  mfaEnabled: boolean;
  onboardingStatus: "AWAITING_EMAIL_CONFIRMATION" | "ACTIVE";
  invitationDeliveryStatus: StaffInvitationStatus | null;
};

export type StaffInvitationDeliveryStatus = "SENT" | "UNCONFIRMED";
export type StaffInvitationStatus = "QUEUED" | "SENT" | "FAILED" | "UNCERTAIN";
export type StaffDirectoryStatus = "ALL" | "ACTIVE" | "PENDING" | "SUSPENDED";
export type StaffDirectoryRole = "ALL" | AppRole;

type StaffRow = {
  id: string;
  username: string;
  display_name_zh: string;
  display_name_en: string;
  email: string;
  role: AppRole;
  status: "ACTIVE" | "SUSPENDED";
  last_sign_in_at: string | null;
  mfa_enabled: boolean;
  membership_must_change_password: boolean;
  total_count: number | string;
  invitation_delivery_status: StaffInvitationStatus | null;
};

function mapStaff(row: StaffRow): StaffUserRecord {
  return {
    id: row.id,
    username: row.username,
    displayNameZh: row.display_name_zh,
    displayNameEn: row.display_name_en,
    email: row.email,
    role: row.role,
    status: row.status,
    lastSignInAt: row.last_sign_in_at,
    mfaEnabled: row.mfa_enabled,
    onboardingStatus: row.membership_must_change_password
      ? "AWAITING_EMAIL_CONFIRMATION"
      : "ACTIVE",
    invitationDeliveryStatus: row.invitation_delivery_status,
  };
}

function configuredWorkspaceId() {
  const workspaceId = process.env.CRM_WORKSPACE_ID;
  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new DatabaseRequestError(503, "WORKSPACE_NOT_CONFIGURED", "CRM workspace is not configured");
  }
  return workspaceId;
}

function normalizeWriteError(error: unknown): never {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "23505") {
    throw new DatabaseRequestError(409, "STAFF_IDENTITY_TAKEN", "The username or email is already in use");
  }
  throw error;
}

export async function listStaffUsers(input: {
  query?: string;
  page?: number;
  pageSize?: number;
  status?: StaffDirectoryStatus;
  role?: StaffDirectoryRole;
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const query = input.query?.trim() ?? "";
  const status = input.status ?? "ALL";
  const role = input.role ?? "ALL";
  const result = await withPoolClient("system", (client) => client.query<StaffRow>(
    `
      select
        account.id,
        profile.username::text,
        profile.display_name_zh,
        profile.display_name_en,
        account.email::text,
        membership.role,
        membership.status,
        membership.must_change_password as membership_must_change_password,
        account.last_sign_in_at,
        exists(
          select 1 from app_auth.totp_factors factor
          where factor.user_id = account.id and factor.status = 'VERIFIED'
        ) as mfa_enabled,
        count(*) over() as total_count,
        invitation.invitation_delivery_status
      from app_auth.accounts account
      join public.user_profiles profile on profile.user_id = account.id
      join public.workspace_memberships membership
        on membership.user_id = account.id and membership.workspace_id = $1
      left join lateral (
        select delivery.status as invitation_delivery_status
        from public.staff_invitation_deliveries delivery
        where delivery.workspace_id=membership.workspace_id and delivery.user_id=account.id
        order by delivery.created_at desc limit 1
      ) invitation on true
      where (
        $2 = ''
        or profile.username::text ilike '%' || $2 || '%'
        or profile.display_name_zh ilike '%' || $2 || '%'
        or profile.display_name_en ilike '%' || $2 || '%'
        or account.email::text ilike '%' || $2 || '%'
      )
        and (
          $3 = 'ALL'
          or ($3 = 'ACTIVE' and membership.status = 'ACTIVE' and not membership.must_change_password)
          or ($3 = 'PENDING' and membership.status = 'ACTIVE' and membership.must_change_password)
          or ($3 = 'SUSPENDED' and membership.status = 'SUSPENDED')
        )
        and ($4 = 'ALL' or membership.role = $4)
      order by profile.display_name_en, profile.username
      offset $5 limit $6
    `,
    [configuredWorkspaceId(), query, status, role, (page - 1) * pageSize, pageSize],
  ));
  return {
    total: Number(result.rows[0]?.total_count ?? 0),
    items: result.rows.map(mapStaff),
  };
}

export async function getStaffUser(userId: string): Promise<StaffUserRecord> {
  const result = await withPoolClient("system", (client) => client.query<StaffRow>(
    `
      select
        account.id,
        profile.username::text,
        profile.display_name_zh,
        profile.display_name_en,
        account.email::text,
        membership.role,
        membership.status,
        membership.must_change_password as membership_must_change_password,
        account.last_sign_in_at,
        exists(
          select 1 from app_auth.totp_factors factor
          where factor.user_id = account.id and factor.status = 'VERIFIED'
        ) as mfa_enabled,
        1 as total_count,
        invitation.invitation_delivery_status
      from app_auth.accounts account
      join public.user_profiles profile on profile.user_id = account.id
      join public.workspace_memberships membership
        on membership.user_id = account.id and membership.workspace_id = $2
      left join lateral (
        select delivery.status as invitation_delivery_status
        from public.staff_invitation_deliveries delivery
        where delivery.workspace_id=membership.workspace_id and delivery.user_id=account.id
        order by delivery.created_at desc limit 1
      ) invitation on true
      where account.id = $1
      limit 1
    `,
    [userId, configuredWorkspaceId()],
  ));
  if (!result.rows[0]) {
    throw new DatabaseRequestError(404, "STAFF_USER_NOT_FOUND", "Staff user not found");
  }
  return mapStaff(result.rows[0]);
}

export type CreateStaffInput = {
  username: string;
  displayNameZh: string;
  displayNameEn: string;
  email: string;
  role: Exclude<AppRole, "SUPER_ADMIN">;
  teamId?: string | null;
  managerMemberId?: string | null;
};

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const generated = Array.from(bytes, (value) => alphabet[value % alphabet.length]);
  generated[0] = "ABCDEFGHJKLMNPQRSTUVWXYZ"[bytes[0] % 24];
  generated[1] = "abcdefghijkmnopqrstuvwxyz"[bytes[1] % 25];
  generated[2] = "23456789"[bytes[2] % 8];
  generated[3] = "!@#$%"[bytes[3] % 5];
  return generated.join("");
}

async function queueInvitation(
  client: PoolClient,
  input: CreateStaffInput,
  userId: string,
  actorId: string,
  temporaryPassword: string,
  requestKey: string,
) {
  const existing = await client.query<{ id: string; status: StaffInvitationStatus }>(
    `select id,status from public.staff_invitation_deliveries
     where requested_by=$1 and user_id=$2 and request_key=$3`,
    [actorId, userId, requestKey],
  );
  if (existing.rows[0]) return existing.rows[0];
  const deliveryId = crypto.randomUUID();
  const encryptedCredential = encryptInvitationCredential(temporaryPassword);
  await client.query(
    `insert into public.staff_invitation_deliveries(
       id,workspace_id,user_id,requested_by,request_key,outbox_id,status
     ) values($1,$2,$3,$4,$5,$1,'QUEUED')`,
    [deliveryId, configuredWorkspaceId(), userId, actorId, requestKey],
  );
  await client.query(
    `insert into public.notification_outbox(
       id,workspace_id,recipient_id,channel,template_key,payload
     ) values($1,$2,$3,'EMAIL','staff-account-created',$4)`,
    [deliveryId, configuredWorkspaceId(), userId, {
      invitationDeliveryId: deliveryId,
      username: input.username.trim().toLowerCase(),
      encryptedTemporaryPassword: encryptedCredential,
      loginUrl: new URL("/login", applicationOrigin()).toString(),
      displayNameZh: input.displayNameZh.trim(),
      displayNameEn: input.displayNameEn.trim(),
      mustChangePassword: true,
      mfaRequired: input.role === "ADMIN",
    }],
  );
  await client.query(
    `insert into public.audit_events(
       workspace_id,actor_id,entity_type,entity_id,action,after_data
     ) values($1,$2,'staff_user',$3,'INVITATION_QUEUED',$4)`,
    [configuredWorkspaceId(), actorId, userId, { deliveryId, deliveryStatus: "QUEUED" }],
  );
  return { id: deliveryId, status: "QUEUED" as const };
}

export async function createStaffUser(input: CreateStaffInput, actor: AppUser) {
  if (actor.role === "ADMIN" && input.role === "ADMIN") {
    throw new DatabaseRequestError(
      403,
      "ROLE_ASSIGNMENT_FORBIDDEN",
      "Only a super administrator can create an administrator",
    );
  }
  const username = input.username.trim().toLowerCase();
  const workspaceId = configuredWorkspaceId();
  const selectedTeam = input.role.startsWith("SALES_")
    ? (await withPoolClient("system", (client) => client.query<{id:string;name_zh:string;name_en:string;lead_member_id:string|null}>(
        `select id,name_zh,name_en,lead_member_id from public.sales_teams
         where id=$1 and workspace_id=$2 and active limit 1`,
        [input.teamId, workspaceId],
      ))).rows[0]
    : null;
  if (input.role.startsWith("SALES_") && !selectedTeam) {
    throw new DatabaseRequestError(400, "TEAM_NOT_FOUND", "Select an active team");
  }
  const temporaryPassword = generateTemporaryPassword();
  let created: { id: string };
  try {
    created = await createAccount({
      email: input.email,
      username,
      password: temporaryPassword,
      displayNameZh: input.displayNameZh,
      displayNameEn: input.displayNameEn,
      workspaceId,
      role: input.role,
      mustChangePassword: true,
      emailVerified: true,
      team: selectedTeam?.name_zh || selectedTeam?.name_en || "",
      teamId: selectedTeam?.id ?? null,
      managerMemberId: input.managerMemberId ?? selectedTeam?.lead_member_id ?? null,
      afterCreate: async (client, userId) => {
        await client.query(
          `insert into public.audit_events(
            workspace_id, actor_id, entity_type, entity_id, action, after_data
          ) values($1, $2, 'staff_user', $3, 'CREATE', $4)`,
          [
            workspaceId,
            actor.id,
            userId,
            {
              username,
              role: input.role,
              accountStatus: "ACTIVE",
              onboardingStatus: "AWAITING_EMAIL_CONFIRMATION",
            },
          ],
        );
        await queueInvitation(
          client,
          input,
          userId,
          actor.id,
          temporaryPassword,
          `create:${userId}`,
        );
      },
    });
  } catch (error) {
    normalizeWriteError(error);
  }

  return {
    item: {
      id: created.id,
      username,
      displayNameZh: input.displayNameZh.trim(),
      displayNameEn: input.displayNameEn.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      status: "ACTIVE" as const,
      lastSignInAt: null,
      mfaEnabled: false,
      onboardingStatus: "AWAITING_EMAIL_CONFIRMATION" as const,
      invitationDeliveryStatus: "QUEUED" as const,
    },
    emailDeliveryStatus: "UNCONFIRMED" as StaffInvitationDeliveryStatus,
  };
}

export async function resendStaffInvitation(
  userId: string,
  requestKey: string,
  actor: AppUser,
) {
  const workspaceId = configuredWorkspaceId();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const result = await withPoolClient("system", async (client) => {
    await client.query("begin");
    try {
      const targetResult = await client.query<{
        username: string; email: string; display_name_zh: string; display_name_en: string;
        role: Exclude<AppRole, "SUPER_ADMIN">; account_pending: boolean; membership_pending: boolean;
      }>(
        `select profile.username::text,account.email::text,profile.display_name_zh,profile.display_name_en,
                membership.role,account.must_change_password as account_pending,
                membership.must_change_password as membership_pending
         from app_auth.accounts account
         join public.user_profiles profile on profile.user_id=account.id
         join public.workspace_memberships membership on membership.user_id=account.id and membership.workspace_id=$2
         where account.id=$1 and account.status='ACTIVE' and membership.status='ACTIVE' for update`,
        [userId, workspaceId],
      );
      const target = targetResult.rows[0];
      if (!target) throw new DatabaseRequestError(404, "STAFF_USER_NOT_FOUND", "Staff user not found");
      const existing = await client.query<{ id: string; status: StaffInvitationStatus }>(
        `select id,status from public.staff_invitation_deliveries
         where requested_by=$1 and user_id=$2 and request_key=$3`,
        [actor.id, userId, requestKey],
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return existing.rows[0];
      }
      if (!target.account_pending && !target.membership_pending) {
        throw new DatabaseRequestError(409, "STAFF_INVITATION_NOT_PENDING", "Invitation is not pending");
      }
      await client.query(
        `update app_auth.accounts set password_version=password_version+1,
           must_change_password=true,updated_at=now() where id=$1`,
        [userId],
      );
      await client.query(
        `insert into app_auth.password_credentials(user_id,password_hash,parameters)
         values($1,$2,$3) on conflict(user_id) do update set
           password_hash=excluded.password_hash,parameters=excluded.parameters,updated_at=now()`,
        [userId, passwordHash, { algorithm: "argon2id", memoryCost: 65_536, timeCost: 3, parallelism: 1 }],
      );
      await client.query(
        "update public.workspace_memberships set must_change_password=true where workspace_id=$1 and user_id=$2",
        [workspaceId, userId],
      );
      await client.query(
        `update app_auth.sessions set revoked_at=now(),revoked_reason='INVITATION_REISSUED'
         where user_id=$1 and revoked_at is null`,
        [userId],
      );
      const queued = await queueInvitation(client, {
        username: target.username,
        email: target.email,
        displayNameZh: target.display_name_zh,
        displayNameEn: target.display_name_en,
        role: target.role,
      }, userId, actor.id, temporaryPassword, requestKey);
      await client.query("commit");
      return queued;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
  return { item: await getStaffUser(userId), invitationDeliveryStatus: result.status };
}

export async function repairStaffIdentity(repairId: string) {
  await withPoolClient("system", async (client) => {
    await client.query("begin");
    try {
      const result = await client.query<{
        id: string;
        workspace_id: string;
        target_user_id: string;
        target_role: AppRole;
        target_status: "ACTIVE" | "SUSPENDED";
      }>(
        `select id, workspace_id, target_user_id, target_role, target_status
         from public.staff_identity_repair_jobs
         where id = $1 and status in ('PENDING', 'FAILED', 'DEAD')
         for update`,
        [repairId],
      );
      const job = result.rows[0];
      if (!job) {
        throw new DatabaseRequestError(
          404,
          "IDENTITY_REPAIR_NOT_FOUND",
          "Identity repair job was not found",
        );
      }
      await client.query(
        "update app_auth.accounts set status = $2, updated_at = now() where id = $1",
        [job.target_user_id, job.target_status],
      );
      await client.query(
        `update public.workspace_memberships
         set role = $3, status = $4
         where workspace_id = $1 and user_id = $2`,
        [job.workspace_id, job.target_user_id, job.target_role, job.target_status],
      );
      await client.query(
        `update public.sales_team_members
         set role = $3, active = ($4 = 'ACTIVE')
         where workspace_id = $1 and auth_user_id = $2`,
        [job.workspace_id, job.target_user_id, job.target_role, job.target_status],
      );
      await client.query(
        `update app_auth.sessions
         set revoked_at = now(), revoked_reason = 'IDENTITY_REPAIRED'
         where user_id = $1 and revoked_at is null`,
        [job.target_user_id],
      );
      await client.query(
        `update public.staff_identity_repair_jobs
         set status = 'COMPLETED', attempts = attempts + 1, last_error = null, updated_at = now()
         where id = $1`,
        [job.id],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}

export async function updateStaffUser(
  target: StaffUserRecord,
  input: { status?: "ACTIVE" | "SUSPENDED"; role?: Exclude<AppRole, "SUPER_ADMIN"> },
  actor: AppUser,
) {
  if (target.id === actor.id && input.status === "SUSPENDED") {
    throw new DatabaseRequestError(
      400,
      "SELF_SUSPEND_FORBIDDEN",
      "You cannot suspend your own account",
    );
  }
  if (
    (target.role === "SUPER_ADMIN" || target.role === "ADMIN" || input.role === "ADMIN")
    && actor.role !== "SUPER_ADMIN"
  ) {
    throw new DatabaseRequestError(
      403,
      "ROLE_ASSIGNMENT_FORBIDDEN",
      "A super administrator is required",
    );
  }
  if (target.role === "SUPER_ADMIN") {
    throw new DatabaseRequestError(
      403,
      "SUPER_ADMIN_PROTECTED",
      "The bootstrap super administrator is protected",
    );
  }
  const nextRole = input.role ?? target.role;
  const nextStatus = input.status ?? target.status;
  const workspaceId = configuredWorkspaceId();

  await withPoolClient("system", async (client) => {
    await client.query("begin");
    try {
      await client.query(
        "update app_auth.accounts set status = $2, updated_at = now() where id = $1",
        [target.id, nextStatus],
      );
      const membership = await client.query(
        `update public.workspace_memberships
         set role = $3, status = $4
         where workspace_id = $1 and user_id = $2`,
        [workspaceId, target.id, nextRole, nextStatus],
      );
      if (!membership.rowCount) {
        throw new DatabaseRequestError(404, "STAFF_USER_NOT_FOUND", "Staff user not found");
      }
      await client.query(
        `update public.sales_team_members
         set role = case when $3 like 'SALES_%' then $3 else role end,
             active = ($3 like 'SALES_%' and $4 = 'ACTIVE')
         where workspace_id = $1 and auth_user_id = $2`,
        [workspaceId, target.id, nextRole, nextStatus],
      );
      await client.query(
        `update app_auth.sessions
         set revoked_at = now(), revoked_reason = 'STAFF_ACCOUNT_CHANGED'
         where user_id = $1 and revoked_at is null`,
        [target.id],
      );
      await client.query(
        `insert into public.audit_events(
          workspace_id, actor_id, entity_type, entity_id, action, before_data, after_data
        ) values($1, $2, 'staff_user', $3, 'UPDATE', $4, $5)`,
        [
          workspaceId,
          actor.id,
          target.id,
          { role: target.role, status: target.status },
          { role: nextRole, status: nextStatus },
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}
