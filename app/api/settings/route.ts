import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiUser } from "@/lib/api";
import { SupabaseRequestError, getAccessToken, supabaseJson } from "@/lib/supabase-server";
import { loadUserSettings, updateAccount, updateNotifications, updateProfile } from "@/lib/settings-repository";
import { mutationIsTrusted } from "@/lib/request-security";

const profileSchema = z.object({ section: z.literal("profile"), displayNameZh: z.string().trim().min(1).max(80), displayNameEn: z.string().trim().min(1).max(80), honorific: z.string().trim().max(20), bio: z.string().trim().max(500) });
const accountSchema = z.object({ section: z.literal("account"), email: z.email(), locale: z.enum(["zh-CN", "en"]), timezone: z.string().min(1).max(60), dateFormat: z.enum(["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"]) });
const channelSchema = z.object({ email: z.boolean(), inApp: z.boolean() });
const notificationsSchema = z.object({ section: z.literal("notifications"), notifications: z.record(z.string(), channelSchema), quietHoursStart: z.string().nullable(), quietHoursEnd: z.string().nullable() });
const schema = z.discriminatedUnion("section", [profileSchema, accountSchema, notificationsSchema]);

function failure(error: unknown) {
  if (error instanceof SupabaseRequestError) return NextResponse.json({ code: error.code }, { status: error.status });
  return NextResponse.json({ code: "SETTINGS_FAILED" }, { status: 500 });
}

async function get() {
  const user=await requireApiUser();
  try { return NextResponse.json({ settings: await loadUserSettings(user), email: user.email }); }
  catch (error) { return failure(error); }
}

async function patch(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", field: String(parsed.error.issues[0]?.path[0] ?? "form") }, { status: 400 });
  const user = await requireApiUser();
  try {
    if (parsed.data.section === "profile") await updateProfile(user.id, parsed.data);
    if (parsed.data.section === "account") {
      await updateAccount(user.id, parsed.data);
      if (parsed.data.email.toLowerCase() !== user.email.toLowerCase()) {
        await supabaseJson("/auth/v1/user", { method: "PUT", body: JSON.stringify({ email: parsed.data.email }) }, await getAccessToken());
      }
    }
    if (parsed.data.section === "notifications") await updateNotifications(user.id, parsed.data.notifications, parsed.data.quietHoursStart, parsed.data.quietHoursEnd);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
export const GET=apiRoute(get,"SETTINGS_LOAD_FAILED");
export const PATCH=apiRoute(patch,"SETTINGS_FAILED");
