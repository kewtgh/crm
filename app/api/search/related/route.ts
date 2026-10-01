import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { searchRelatedRecords } from "@/lib/related-search-repository";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { hasCapability,type Capability } from "@/lib/capabilities";
const typeCapabilities:Record<string,Capability|null>={ORGANIZATION:null,CONTACT:null,USER:null,PRODUCT:null,OPPORTUNITY:"opportunities.view",TASK:"tasks.view",CONTRACT:"contracts.view",QUOTE:"finance.view",STUDENT:"education.view",HOUSEHOLD:"education.view",LEAD:"leads.view"};

async function get(request: Request) {
  const user=await requireApiUser();
  try {
    const params = new URL(request.url).searchParams;
    const query = params.get("q") ?? "";
    const types=(params.get("types")?.split(",")??Object.keys(typeCapabilities)).filter(type=>type in typeCapabilities&&(!typeCapabilities[type]||hasCapability(user.role,typeCapabilities[type]!)));
    return NextResponse.json({ items:types.length?await searchRelatedRecords(query,types):[] }, {headers:{"cache-control":"private, no-store"}});
  } catch (error) {
    if (error instanceof DatabaseRequestError) return NextResponse.json({ code:error.code }, { status:error.status });
    return NextResponse.json({ code:"RELATED_SEARCH_FAILED" }, { status:500 });
  }
}
export const GET=apiRoute(get,"RELATED_SEARCH_FAILED");
