import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { searchRelatedRecords } from "@/lib/related-search-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

async function get(request: Request) {
  await requireApiUser();
  try {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ items: await searchRelatedRecords(query) });
  } catch (error) {
    if (error instanceof SupabaseRequestError) return NextResponse.json({ code:error.code }, { status:error.status });
    return NextResponse.json({ code:"RELATED_SEARCH_FAILED" }, { status:500 });
  }
}
export const GET=apiRoute(get,"RELATED_SEARCH_FAILED");
