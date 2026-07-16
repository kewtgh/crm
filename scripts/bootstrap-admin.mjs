import { mkdir, readFile, writeFile } from "node:fs/promises";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required one-shot variables: ${missing.join(", ")}`);
}

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (password.length < 12 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
  throw new Error("ADMIN_PASSWORD must be 12+ characters and include an uppercase letter and a number.");
}

const headers = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  "content-type": "application/json",
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Supabase admin request failed (${response.status}): ${body.msg ?? body.message ?? "unknown error"}`);
  return body;
}

const usersResult = await request("/auth/v1/admin/users?per_page=1000");
const existing = (usersResult.users ?? []).find((user) => String(user.email).toLowerCase() === email);
const metadata = {
  username: (process.env.ADMIN_USERNAME || "lumina.admin").trim().toLowerCase(),
  chinese_name: process.env.ADMIN_CHINESE_NAME || "系统管理员",
  english_name: process.env.ADMIN_ENGLISH_NAME || "System Administrator",
  account_status: "ACTIVE",
  initialized_by: "bootstrap-admin",
};

let synchronizedUser = existing;
if (!existing) {
  synchronizedUser = await request("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata, app_metadata: { role: "SUPER_ADMIN", account_status: "ACTIVE" } }),
  });
  process.stdout.write(`Created and verified Supabase Auth administrator: ${email}\n`);
} else {
  const update = { user_metadata: { ...(existing.user_metadata ?? {}), ...metadata }, app_metadata: { ...(existing.app_metadata ?? {}), role: "SUPER_ADMIN", account_status: "ACTIVE" } };
  if (process.env.ADMIN_ROTATE_PASSWORD === "true") update.password = password;
  await request(`/auth/v1/admin/users/${existing.id}`, { method: "PUT", body: JSON.stringify(update) });
  process.stdout.write(`Synchronized existing Supabase Auth administrator: ${email}\n`);
}

await request("/rest/v1/user_profiles?on_conflict=user_id", {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify({ user_id: synchronizedUser.id, username: metadata.username, display_name_zh: metadata.chinese_name, display_name_en: metadata.english_name }),
});

await mkdir("work", { recursive: true });
await writeFile(
  "work/local-admin-credentials.txt",
  `Lumina CRM local administrator\nEmail: ${email}\nInitial password: ${password}\n\nThis file is ignored by Git. Change the password after the first interactive sign-in.\n`,
  { encoding: "utf8", mode: 0o600 },
);

try {
  const envPath = ".env.local";
  const envFile = await readFile(envPath, "utf8");
  const cleaned = envFile
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("ADMIN_PASSWORD="))
    .map((line) => line.startsWith("ADMIN_ROTATE_PASSWORD=") ? "ADMIN_ROTATE_PASSWORD=false" : line)
    .join("\n");
  await writeFile(envPath, cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`, "utf8");
} catch {
  // Hosted/CI environments may not have a writable local env file.
}

process.stdout.write("Initialization succeeded. The local ADMIN_PASSWORD entry was removed. Remove the one-shot password from any CI or hosted secret store as well.\n");
