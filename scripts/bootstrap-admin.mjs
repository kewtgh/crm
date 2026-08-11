import argon2 from "argon2";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const required = ["SYSTEM_DATABASE_URL", "ADMIN_EMAIL", "ADMIN_PASSWORD", "CRM_WORKSPACE_ID"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error(`Missing required variables: ${missing.join(", ")}`);

const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const username = (process.env.ADMIN_USERNAME || "lumina.admin").trim().toLowerCase();
const displayNameZh = process.env.ADMIN_CHINESE_NAME || "系统管理员";
const displayNameEn = process.env.ADMIN_ENGLISH_NAME || "System Administrator";
const workspaceId = process.env.CRM_WORKSPACE_ID.trim();
const rotatePassword = /^(1|true|yes|on)$/i.test(process.env.ADMIN_ROTATE_PASSWORD ?? "");
const credentialOutputPath = process.env.ADMIN_CREDENTIAL_OUTPUT_PATH?.trim();
if (credentialOutputPath && !path.isAbsolute(credentialOutputPath)) {
  throw new Error("ADMIN_CREDENTIAL_OUTPUT_PATH_MUST_BE_ABSOLUTE");
}
const ssl = /^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL ?? "")
  ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
  : undefined;
const client = new pg.Client({
  connectionString: process.env.SYSTEM_DATABASE_URL,
  ssl,
  application_name: "lumina-crm-bootstrap-admin",
});

await client.connect();
try {
  await client.query("begin");
  const existing = await client.query(
    "select id from app_auth.accounts where email = $1 or username = $2 for update",
    [email, username],
  );
  const id = existing.rows[0]?.id ?? crypto.randomUUID();
  const createPassword = !existing.rows[0] || rotatePassword;
  const passwordHash = createPassword
    ? await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65_536,
        timeCost: 3,
        parallelism: 1,
      })
    : null;

  if (!existing.rows[0]) {
    await client.query(
      `insert into app_auth.accounts(
        id,email,username,status,email_confirmed_at,must_change_password
      ) values($1,$2,$3,'ACTIVE',now(),true)`,
      [id, email, username],
    );
  } else {
    await client.query(
      `update app_auth.accounts set
        email=$2,username=$3,status='ACTIVE',email_confirmed_at=coalesce(email_confirmed_at,now()),
        must_change_password=case when $4 then true else must_change_password end,
        password_version=case when $4 then password_version+1 else password_version end,
        updated_at=now()
       where id=$1`,
      [id, email, username, rotatePassword],
    );
  }

  if (passwordHash) {
    await client.query(
      `insert into app_auth.password_credentials(user_id,password_hash,parameters)
       values($1,$2,$3)
       on conflict(user_id) do update set
         password_hash=excluded.password_hash,parameters=excluded.parameters,updated_at=now()`,
      [id, passwordHash, { algorithm: "argon2id", memoryCost: 65_536, timeCost: 3, parallelism: 1 }],
    );
  }
  await client.query(
    `insert into public.user_profiles(user_id,username,display_name_zh,display_name_en)
     values($1,$2,$3,$4)
     on conflict(user_id) do update set
       username=excluded.username,display_name_zh=excluded.display_name_zh,
       display_name_en=excluded.display_name_en,updated_at=now()`,
    [id, username, displayNameZh, displayNameEn],
  );
  await client.query(
    `insert into public.workspace_memberships(
      workspace_id,user_id,role,status,must_change_password
    ) values($1,$2,'SUPER_ADMIN','ACTIVE',true)
    on conflict(workspace_id,user_id) do update set
      role='SUPER_ADMIN',status='ACTIVE',
      must_change_password=case when $3 then true else workspace_memberships.must_change_password end`,
    [workspaceId, id, createPassword],
  );
  const teamMember = await client.query(
    `update public.sales_team_members set
       name_zh=$3,name_en=$4,role='SUPER_ADMIN',active=true
     where workspace_id=$1 and auth_user_id=$2`,
    [workspaceId, id, displayNameZh, displayNameEn],
  );
  if (!teamMember.rowCount) {
    await client.query(
      `insert into public.sales_team_members(
         workspace_id,auth_user_id,name_zh,name_en,role,team,active
       ) values($1,$2,$3,$4,'SUPER_ADMIN','',true)`,
      [workspaceId, id, displayNameZh, displayNameEn],
    );
  }
  if (rotatePassword) {
    await client.query(
      `update app_auth.sessions set revoked_at=now(),revoked_reason='ADMIN_PASSWORD_ROTATED'
       where user_id=$1 and revoked_at is null`,
      [id],
    );
  }
  await client.query(
    `insert into public.audit_events(
      workspace_id,actor_id,entity_type,entity_id,action,after_data
    ) values($1,$2::uuid,'staff_user',$2::uuid::text,$3,$4)`,
    [
      workspaceId,
      id,
      existing.rows[0] ? "BOOTSTRAP_SYNCHRONIZED" : "BOOTSTRAP_CREATED",
      { username, role: "SUPER_ADMIN", passwordRotated: createPassword },
    ],
  );
  await client.query("commit");
  if (createPassword && credentialOutputPath) {
    await mkdir(path.dirname(credentialOutputPath), { recursive: true, mode: 0o700 });
    await writeFile(
      credentialOutputPath,
      `email=${email}\npassword=${password}\nmust_change_password=true\n`,
      { encoding: "utf8", mode: 0o600, flag: "w" },
    );
  }
  process.stdout.write(
    `${existing.rows[0] ? "Synchronized" : "Created"} self-hosted PostgreSQL administrator ${email}\n`,
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
