import { NextResponse } from "next/server";
import { apiRoute, requireApiCapability } from "@/lib/api";

const headers={
  CONTACTS:["nameZh","nameEn","email","phone","title"],
  ORGANIZATIONS:["nameZh","nameEn","city"],
} as const;

async function get(request:Request){
  await requireApiCapability("imports.view");
  const resource=(new URL(request.url).searchParams.get("resource")??"CONTACTS").toUpperCase() as keyof typeof headers;
  if(!(resource in headers))return NextResponse.json({code:"INVALID_IMPORT_RESOURCE"},{status:400});
  const csv=`\uFEFF${headers[resource].join(",")}\r\n`;
  return new NextResponse(csv,{headers:{
    "content-type":"text/csv; charset=utf-8",
    "content-disposition":`attachment; filename="crm-${resource.toLowerCase()}-import-template.csv"`,
    "cache-control":"private, no-store",
    "x-content-type-options":"nosniff",
  }});
}

export const GET=apiRoute(get,"IMPORT_TEMPLATE_FAILED");
