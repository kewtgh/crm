import type { AppRole } from "./roles";
import type { AppUser } from "./user";
import { supabaseAdminJson, supabaseAdminRequest, supabaseJson, SupabaseRequestError } from "./supabase-server";

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
};

type StaffRow = {
  user_id: string; username: string; display_name_zh: string; display_name_en: string;
  email: string; role: AppRole; account_status: "ACTIVE" | "SUSPENDED";
  last_sign_in_at: string | null; mfa_enabled: boolean; total_count: number | string;
};

export async function listStaffUsers(input: { query?: string; page?: number; pageSize?: number }) {
  const rows = await supabaseJson<StaffRow[]>("/rest/v1/rpc/list_staff_users", {
    method: "POST",
    body: JSON.stringify({ search_query: input.query ?? "", page_number: input.page ?? 1, page_size: input.pageSize ?? 20 }),
  });
  return {
    total: Number(rows[0]?.total_count ?? 0),
    items: rows.map((row): StaffUserRecord => ({
      id: row.user_id,
      username: row.username,
      displayNameZh: row.display_name_zh,
      displayNameEn: row.display_name_en,
      email: row.email,
      role: row.role,
      status: row.account_status,
      lastSignInAt: row.last_sign_in_at,
      mfaEnabled: row.mfa_enabled,
    })),
  };
}

export async function getStaffUser(userId: string): Promise<StaffUserRecord> {
  const [identity, profiles, memberships] = await Promise.all([
    supabaseAdminJson<{ id: string; email?: string; last_sign_in_at?: string | null; factors?: Array<{ status?: string }> }>(`/auth/v1/admin/users/${userId}`),
    supabaseAdminJson<Array<{ username: string; display_name_zh: string; display_name_en: string }>>(`/rest/v1/user_profiles?select=username,display_name_zh,display_name_en&user_id=eq.${userId}&limit=1`),
    supabaseAdminJson<Array<{ role: AppRole; status: "ACTIVE" | "SUSPENDED" }>>(`/rest/v1/workspace_memberships?select=role,status&user_id=eq.${userId}&limit=1`),
  ]);
  if (!profiles[0] || !memberships[0]) throw new SupabaseRequestError(404, "STAFF_USER_NOT_FOUND", "Staff user not found");
  return {
    id: identity.id,
    username: profiles[0].username,
    displayNameZh: profiles[0].display_name_zh,
    displayNameEn: profiles[0].display_name_en,
    email: identity.email ?? "",
    role: memberships[0].role,
    status: memberships[0].status,
    lastSignInAt: identity.last_sign_in_at ?? null,
    mfaEnabled: identity.factors?.some((factor) => factor.status === "verified") ?? false,
  };
}

export type CreateStaffInput = {
  username: string; displayNameZh: string; displayNameEn: string; email: string;
  role: Exclude<AppRole, "SUPER_ADMIN">; team: string; managerMemberId?: string | null;
};

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const generated = Array.from(bytes, (value) => alphabet[value % alphabet.length]);
  generated[0] = "ABCDEFGHJKLMNPQRSTUVWXYZ"[bytes[0] % 24];
  generated[1] = "abcdefghijkmnopqrstuvwxyz"[bytes[1] % 25];
  generated[2] = "23456789"[bytes[2] % 8];
  generated[3] = "!@#$%"[bytes[3] % 5];
  return generated.join("");
}

function configuredWorkspaceId() {
  const workspaceId = process.env.CRM_WORKSPACE_ID;
  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new SupabaseRequestError(503, "WORKSPACE_NOT_CONFIGURED", "CRM workspace is not configured");
  }
  return workspaceId;
}

async function deliverTemporaryCredentials(input: CreateStaffInput, username: string, temporaryPassword: string) {
  const endpoint = process.env.EMAIL_DELIVERY_WEBHOOK_URL;
  if (!endpoint) throw new SupabaseRequestError(503, "ACCOUNT_EMAIL_DELIVERY_NOT_CONFIGURED", "Account email delivery is not configured");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      to: input.email.trim().toLowerCase(),
      template: "staff-account-created",
      payload: {
        username,
        temporaryPassword,
        loginUrl: new URL("/login", process.env.APP_URL ?? "http://localhost:3000").toString(),
        displayNameZh: input.displayNameZh,
        displayNameEn: input.displayNameEn,
        mustChangePassword: true,
        mfaRequired: input.role === "ADMIN",
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) throw new SupabaseRequestError(502, "ACCOUNT_EMAIL_DELIVERY_FAILED", "The account email could not be delivered");
}

export async function createStaffUser(input: CreateStaffInput, actor: AppUser) {
  if (actor.role === "ADMIN" && input.role === "ADMIN") throw new SupabaseRequestError(403, "ROLE_ASSIGNMENT_FORBIDDEN", "Only a super administrator can create an administrator");
  if (!process.env.EMAIL_DELIVERY_WEBHOOK_URL) throw new SupabaseRequestError(503, "ACCOUNT_EMAIL_DELIVERY_NOT_CONFIGURED", "Account email delivery is not configured");
  const username = input.username.trim().toLowerCase();
  const workspaceId = configuredWorkspaceId();
  const matches = await supabaseAdminJson<Array<{ user_id: string }>>(`/rest/v1/user_profiles?select=user_id&username=eq.${encodeURIComponent(username)}&limit=1`);
  if (matches.length) throw new SupabaseRequestError(409, "USERNAME_TAKEN", "The username is already in use");

  const temporaryPassword = generateTemporaryPassword();
  const created = await supabaseAdminJson<{ id?: string; user?: { id?: string } }>("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { username, chinese_name: input.displayNameZh, english_name: input.displayNameEn, team: input.team },
      app_metadata: { role: input.role, account_status: "ACTIVE", workspace_id: workspaceId },
    }),
  });
  const userId = created.id ?? created.user?.id;
  if (!userId) throw new SupabaseRequestError(502, "CREATE_USER_MISSING", "The identity service did not return the created user");

  try {
    if (input.role.startsWith("SALES_")) {
      await supabaseAdminRequest("/rest/v1/sales_team_members", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          auth_user_id: userId,
          name_zh: input.displayNameZh,
          name_en: input.displayNameEn,
          role: input.role,
          team: input.team,
          manager_member_id: input.managerMemberId || null,
          active: true,
        }),
      });
    }
    await supabaseAdminRequest("/rest/v1/audit_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_id: actor.id,
        entity_type: "staff_user",
        entity_id: userId,
        action: "CREATE",
        after_data: { username, role: input.role, accountStatus: "ACTIVE" },
      }),
    });
    await deliverTemporaryCredentials(input, username, temporaryPassword);
  } catch (error) {
    await supabaseAdminRequest(`/auth/v1/admin/users/${userId}`, { method: "DELETE" }).catch(() => undefined);
    await supabaseAdminRequest("/rest/v1/audit_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ workspace_id: workspaceId, actor_id: actor.id, entity_type: "staff_user", entity_id: userId, action: "CREATE_ROLLED_BACK", after_data: { username, role: input.role } }),
    }).catch(() => undefined);
    throw error;
  }
  return { id: userId };
}

export async function repairStaffIdentity(repairId: string) {
  const jobs = await supabaseAdminJson<Array<{
    id: string;
    target_user_id: string;
    target_role: AppRole;
    target_status: "ACTIVE" | "SUSPENDED";
    status: string;
  }>>(`/rest/v1/staff_identity_repair_jobs?select=id,target_user_id,target_role,target_status,status&id=eq.${repairId}&status=in.(PENDING,FAILED,DEAD)&limit=1`);
  const job = jobs[0];
  if (!job) throw new SupabaseRequestError(404, "IDENTITY_REPAIR_NOT_FOUND", "Identity repair job was not found");
  await supabaseAdminRequest(`/rest/v1/staff_identity_repair_jobs?id=eq.${job.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "PROCESSING", updated_at: new Date().toISOString() }),
  });
  try {
    await supabaseAdminRequest(`/auth/v1/admin/users/${job.target_user_id}`, {
      method: "PUT",
      body: JSON.stringify({
        app_metadata: {
          role: job.target_role,
          account_status: job.target_status,
          workspace_id: configuredWorkspaceId(),
        },
        ban_duration: job.target_status === "SUSPENDED" ? "876000h" : "none",
      }),
    });
    await supabaseAdminJson("/rest/v1/rpc/complete_identity_repair", {
      method: "POST",
      body: JSON.stringify({ repair_id: job.id, successful: true, failure: null }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "IDENTITY_REPAIR_FAILED";
    await supabaseAdminJson("/rest/v1/rpc/complete_identity_repair", {
      method: "POST",
      body: JSON.stringify({ repair_id: job.id, successful: false, failure: message }),
    }).catch(() => undefined);
    throw error;
  }
}

export async function updateStaffUser(target: StaffUserRecord, input: { status?: "ACTIVE" | "SUSPENDED"; role?: Exclude<AppRole, "SUPER_ADMIN"> }, actor: AppUser) {
  if (target.id === actor.id && input.status === "SUSPENDED") throw new SupabaseRequestError(400, "SELF_SUSPEND_FORBIDDEN", "You cannot suspend your own account");
  if ((target.role === "SUPER_ADMIN" || target.role === "ADMIN" || input.role === "ADMIN") && actor.role !== "SUPER_ADMIN") {
    throw new SupabaseRequestError(403, "ROLE_ASSIGNMENT_FORBIDDEN", "A super administrator is required");
  }
  if (target.role === "SUPER_ADMIN") throw new SupabaseRequestError(403, "SUPER_ADMIN_PROTECTED", "The bootstrap super administrator is protected");
  const nextRole = input.role ?? target.role;
  const nextStatus = input.status ?? target.status;
  const change = await supabaseAdminJson<{ id: string }>("/rest/v1/rpc/prepare_staff_identity_change", {
    method: "POST",
    body: JSON.stringify({
      target_user: target.id,
      new_role: nextRole,
      new_status: nextStatus,
      actor_user: actor.id,
    }),
  });
  try {
    await supabaseAdminRequest(`/auth/v1/admin/users/${target.id}`, {
      method: "PUT",
      body: JSON.stringify({
        app_metadata: { role: nextRole, account_status: nextStatus, workspace_id: configuredWorkspaceId() },
        ban_duration: nextStatus === "SUSPENDED" ? "876000h" : "none",
      }),
    });
    await supabaseAdminJson("/rest/v1/rpc/complete_staff_identity_change", {
      method: "POST",
      body: JSON.stringify({ change_id: change.id }),
    });
  } catch (error) {
    let rollbackFailure = error instanceof Error ? error.message : "IDENTITY_SYNC_FAILED";
    try {
      await supabaseAdminRequest(`/auth/v1/admin/users/${target.id}`, {
        method: "PUT",
        body: JSON.stringify({
          app_metadata: { role: target.role, account_status: target.status, workspace_id: configuredWorkspaceId() },
          ban_duration: target.status === "SUSPENDED" ? "876000h" : "none",
        }),
      });
    } catch (compensationError) {
      rollbackFailure = `AUTH_COMPENSATION_FAILED: ${compensationError instanceof Error ? compensationError.message : "UNKNOWN"}`;
    }
    let databaseRollbackFailed = false;
    try {
      await supabaseAdminJson("/rest/v1/rpc/rollback_staff_identity_change", {
        method: "POST",
        body: JSON.stringify({
          change_id: change.id,
          failure: rollbackFailure,
        }),
      });
    } catch {
      databaseRollbackFailed = true;
    }
    if (rollbackFailure.startsWith("AUTH_COMPENSATION_FAILED") || databaseRollbackFailed) {
      throw new SupabaseRequestError(502, "IDENTITY_COMPENSATION_REQUIRED", rollbackFailure);
    }
    throw error;
  }
}
