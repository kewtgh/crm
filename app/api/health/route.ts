import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ status: "unavailable", version: APP_VERSION }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const upstream = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: controller.signal,
    });
    const status = upstream.ok ? "ok" : "degraded";
    return NextResponse.json(
      { status, version: APP_VERSION, checkedAt: new Date().toISOString() },
      { status: upstream.ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({ status: "degraded", version: APP_VERSION }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
