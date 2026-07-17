import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { searchRelatedRecords } from "@/lib/related-search-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

export async function GET(request: Request) {
  try {
    await requireUser();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ items: await searchRelatedRecords(query) });
  } catch (error) {
    if (error instanceof SupabaseRequestError) return NextResponse.json({ code:error.code }, { status:error.status });
    return NextResponse.json({ code:"RELATED_SEARCH_FAILED" }, { status:500 });
  }
}
