import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { getAccessToken, supabaseJson, supabaseRequest } from "@/lib/supabase-server";
import { loadUserSettings } from "@/lib/settings-repository";
import { mutationIsTrusted } from "@/lib/request-security";

const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);

async function get() {
  const user=await requireApiUser();
  try {
    const settings = await loadUserSettings(user);
    if (!settings.avatarPath) return new NextResponse(null, { status: 404 });
    const upstream = await supabaseRequest(`/storage/v1/object/authenticated/crm-avatars/${settings.avatarPath}`, {}, await getAccessToken());
    return new NextResponse(await upstream.arrayBuffer(), { headers: { "content-type": upstream.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, max-age=300" } });
  } catch { return new NextResponse(null, { status: 404 }); }
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const user = await requireApiUser(); const form = await request.formData(); const file = form.get("avatar");
  if (!(file instanceof File) || !allowed.has(file.type) || file.size > 5 * 1024 * 1024) return NextResponse.json({ code: "INVALID_AVATAR" }, { status: 400 });
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/avatar.${extension}`;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const token = await getAccessToken();
  if (!url || !key || !token) return NextResponse.json({ code: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  const upload = await fetch(`${url}/storage/v1/object/crm-avatars/${path}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": file.type, "x-upsert": "true" }, body: await file.arrayBuffer(), cache: "no-store" });
  if (!upload.ok) return NextResponse.json({ code: "AVATAR_UPLOAD_FAILED" }, { status: upload.status });
  await supabaseJson(`/rest/v1/user_preferences?user_id=eq.${user.id}`, { method: "PATCH", body: JSON.stringify({ avatar_path: path, updated_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
  return NextResponse.json({ ok: true, url: `/api/settings/avatar?v=${Date.now()}` });
}
export const GET=apiRoute(get,"AVATAR_LOAD_FAILED");
export const POST=apiRoute(post,"AVATAR_UPLOAD_FAILED");
