import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { databaseJson } from "@/lib/db/gateway";
import { loadUserSettings } from "@/lib/settings-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { objectStore } from "@/lib/storage/object-store";

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
  const user = await requireApiUser();
  const settings = await loadUserSettings(user);
  if (!settings.avatarPath || !settings.avatarPath.startsWith(`${user.id}/`)) {
    return new NextResponse(null, { status: 404 });
  }
  const object = await objectStore().get(`avatars/${settings.avatarPath}`).catch(() => null);
  if (!object) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(object.body), {
    headers: {
      "content-type": object.contentType,
      "content-length": String(object.contentLength),
      "cache-control": "private, max-age=300",
    },
  });
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const user = await requireApiUser();
  const form = await request.formData();
  const file = form.get("avatar");
  if (!(file instanceof File) || !allowed.has(file.type) || file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ code: "INVALID_AVATAR" }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasImageSignature(file.type, bytes)) {
    return NextResponse.json({ code: "INVALID_AVATAR" }, { status: 400 });
  }
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const avatarPath = `${user.id}/avatar.${extension}`;
  const previous = await loadUserSettings(user);
  await objectStore().put(`avatars/${avatarPath}`, bytes, {
    contentType: file.type,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  });
  try {
    await databaseJson(`/db/table/user_preferences?user_id=eq.${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ avatar_path: avatarPath, updated_at: new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    });
  } catch (error) {
    await objectStore().delete(`avatars/${avatarPath}`).catch(() => undefined);
    throw error;
  }
  if (
    previous.avatarPath
    && previous.avatarPath !== avatarPath
    && previous.avatarPath.startsWith(`${user.id}/`)
  ) {
    await objectStore().delete(`avatars/${previous.avatarPath}`).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, url: `/api/settings/avatar?v=${Date.now()}` });
}

export const GET = apiRoute(get, "AVATAR_LOAD_FAILED");
export const POST = apiRoute(post, "AVATAR_UPLOAD_FAILED");
