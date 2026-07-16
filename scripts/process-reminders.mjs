const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing reminder-worker variables: ${missing.join(", ")}`);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const response = await fetch(`${url}/rest/v1/rpc/process_due_reminders`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ batch_size: Number(process.env.REMINDER_BATCH_SIZE ?? 100) }) });
const result = await response.json().catch(() => null);
if (!response.ok) throw new Error(`Reminder processing failed (${response.status})`);
process.stdout.write(`Processed ${Number(result ?? 0)} due reminders.\n`);
