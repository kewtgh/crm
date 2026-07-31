import type { AppRole } from "./roles";
import type { AppUser } from "./user";
import { createAccount } from "./auth/accounts";
import { withPoolClient } from "./db/pools";
import { DatabaseRequestError } from "./db/gateway";
import { applicationOrigin } from "./application-origin.mjs";

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
};

export type StaffInvitationDeliveryStatus = "SENT" | "UNCONFIRMED";

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

export async function listStaffUsers(input: { query?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const query = input.query?.trim() ?? "";
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
        count(*) over() as total_count
      from app_auth.accounts account
      join public.user_profiles profile on profile.user_id = account.id
      join public.workspace_memberships membership
        on membership.user_id = account.id and membership.workspace_id = $1
      where $2 = ''
        or profile.username::text ilike '%' || $2 || '%'
        or profile.display_name_zh ilike '%' || $2 || '%'
        or profile.display_name_en ilike '%' || $2 || '%'
        or account.email::text ilike '%' || $2 || '%'
      order by profile.display_name_en, profile.username
      offset $3 limit $4
    `,
    [configuredWorkspaceId(), query, (page - 1) * pageSize, pageSize],
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
        1 as total_count
      from app_auth.accounts account
      join public.user_profiles profile on profile.user_id = account.id
      join public.workspace_memberships membership
        on membership.user_id = account.id and membership.workspace_id = $2
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
  team: string;
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

async function deliverTemporaryCredentials(
  input: CreateStaffInput,
  username: string,
  temporaryPassword: string,
): Promise<StaffInvitationDeliveryStatus> {
  const endpoint = process.env.EMAIL_DELIVERY_WEBHOOK_URL;
  if (!endpoint) {
    throw new DatabaseRequestError(
      503,
      "ACCOUNT_EMAIL_DELIVERY_NOT_CONFIGURED",
      "Account email delivery is not configured",
    );
  }
  const deliveryId = crypto.randomUUID();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": deliveryId,
      ...(process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      id: deliveryId,
      to: input.email.trim().toLowerCase(),
      template: "staff-account-created",
      payload: {
        username,
        temporaryPassword,
        loginUrl: new URL("/login", applicationOrigin()).toString(),
        displayNameZh: input.displayNameZh,
        displayNameEn: input.displayNameEn,
        mustChangePassword: true,
        mfaRequired: input.role === "ADMIN",
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) {
    return "UNCONFIRMED";
  }
  return "SENT";
}

export async function createStaffUser(input: CreateStaffInput, actor: AppUser) {
  if (actor.role === "ADMIN" && input.role === "ADMIN") {
    throw new DatabaseRequestError(
      403,
      "ROLE_ASSIGNMENT_FORBIDDEN",
      "Only a super administrator can create an administrator",
    );
  }
  if (!process.env.EMAIL_DELIVERY_WEBHOOK_URL) {
    throw new DatabaseRequestError(
      503,
      "ACCOUNT_EMAIL_DELIVERY_NOT_CONFIGURED",
      "Account email delivery is not configured",
    );
  }
  const username = input.username.trim().toLowerCase();
  const workspaceId = configuredWorkspaceId();
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
      team: input.team,
      managerMemberId: input.managerMemberId,
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
      },
    });
  } catch (error) {
    normalizeWriteError(error);
  }

  const emailDeliveryStatus = await deliverTemporaryCredentials(
    input,
    username,
    temporaryPassword,
  );
  await withPoolClient("system", (client) => client.query(
    `insert into public.audit_events(
      workspace_id, actor_id, entity_type, entity_id, action, after_data
    ) values($1, $2, 'staff_user', $3, $4, $5)`,
    [
      workspaceId,
      actor.id,
      created.id,
      emailDeliveryStatus === "SENT"
        ? "INVITATION_EMAIL_SENT"
        : "INVITATION_EMAIL_DELIVERY_UNCONFIRMED",
      { deliveryStatus: emailDeliveryStatus },
    ],
  )).catch(() => undefined);
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
    },
    emailDeliveryStatus,
  };
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
