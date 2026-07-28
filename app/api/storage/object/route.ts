import { NextResponse } from "next/server";
import { objectStore, verifyLocalObjectToken } from "@/lib/storage/object-store";

export async function GET(request: Request) {
  if ((process.env.OBJECT_STORAGE_PROVIDER ?? "local").toLowerCase() !== "local") {
    return new NextResponse(null, { status: 404 });
  }
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const key = verifyLocalObjectToken(token);
  if (!key) return new NextResponse(null, { status: 404 });
  const object = await objectStore().get(key);
  if (!object) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(object.body), {
    headers: {
      "content-type": object.contentType,
      "content-length": String(object.contentLength),
      "cache-control": "private, no-store",
      "content-disposition": "attachment",
    },
  });
}
