import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { getAccessToken, supabaseJson, supabaseRequest } from "@/lib/supabase-server";
import { loadUserSettings } from "@/lib/settings-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);

function hasImageSignature(type: string, bytes: Uint8Array) {
  if (type === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return png.every((value, index) => bytes[index] === value);
  }
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/webp") {
    return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
      && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

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
  const user = await requireApiUser();
  const form = await request.formData();
  const file = form.get("avatar");
  if (!(file instanceof File) || !allowed.has(file.type) || file.size > 5 * 1024 * 1024) return NextResponse.json({ code: "INVALID_AVATAR" }, { status: 400 });
  const body = await file.arrayBuffer();
  if (!hasImageSignature(file.type, new Uint8Array(body))) {
    return NextResponse.json({ code: "INVALID_AVATAR" }, { status: 400 });
  }
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/avatar.${extension}`;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const token = await getAccessToken();
  if (!url || !key || !token) return NextResponse.json({ code: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  const previous = await loadUserSettings(user);
  const upload = await fetchWithTimeout(`${url}/storage/v1/object/crm-avatars/${path}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": file.type, "x-upsert": "true" }, body, cache: "no-store" })
    .catch(() => null);
  if (!upload) return NextResponse.json({ code: "UPSTREAM_TIMEOUT" }, { status: 504 });
  if (!upload.ok) return NextResponse.json({ code: "AVATAR_UPLOAD_FAILED" }, { status: upload.status });
  await supabaseJson(`/rest/v1/user_preferences?user_id=eq.${user.id}`, { method: "PATCH", body: JSON.stringify({ avatar_path: path, updated_at: new Date().toISOString() }), headers: { Prefer: "return=minimal" } });
  if (previous.avatarPath && previous.avatarPath !== path && previous.avatarPath.startsWith(`${user.id}/`)) {
    await supabaseRequest(`/storage/v1/object/crm-avatars/${previous.avatarPath}`, { method: "DELETE" }, token).catch(() => null);
  }
  return NextResponse.json({ ok: true, url: `/api/settings/avatar?v=${Date.now()}` });
}
export const GET=apiRoute(get,"AVATAR_LOAD_FAILED");
export const POST=apiRoute(post,"AVATAR_UPLOAD_FAILED");
