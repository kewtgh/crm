import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z][a-z0-9._-]+$/) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ available: false, code: "USERNAME_INVALID" }, { status: 400 });
  if (process.env.CRM_DEMO_MODE === "true") {
    return NextResponse.json({ available: !["admin", "olivia.admin", "system", "support"].includes(parsed.data.username) });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ available: false, code: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  try {
    const response = await fetch(`${url}/rest/v1/rpc/username_available`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ candidate: parsed.data.username }), cache: "no-store" });
    if (!response.ok) return NextResponse.json({ available: false, code: "USERNAME_CHECK_UNAVAILABLE" }, { status: 503 });
    return NextResponse.json({ available: (await response.json()) === true });
  } catch {
    return NextResponse.json({ available: false, code: "USERNAME_CHECK_UNAVAILABLE" }, { status: 503 });
  }
}
