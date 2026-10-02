import { NextResponse } from "next/server";
import { apiRoute, requireApiCapability } from "@/lib/api";
import { importFieldsByResource } from "@/lib/import-fields";
import { buildImportTemplate,type ImportResource } from "@/lib/import-template";
import { zhCN } from "@/lib/i18n/locales/zh-CN";
import { en } from "@/lib/i18n/locales/en";

async function get(request:Request){
  await requireApiCapability("imports.view");
  const params=new URL(request.url).searchParams,resource=(params.get("resource")??"CONTACTS").toUpperCase(),kind=params.get("kind")??"blank",locale=params.get("locale")==="en"?"en":"zh-CN";
  if(!Object.hasOwn(importFieldsByResource,resource)||!["blank","example","guide"].includes(kind))return NextResponse.json({code:"INVALID_IMPORT_RESOURCE"},{status:400});
  const messages=locale==="en"?en:zhCN;
  const csv=buildImportTemplate(resource as ImportResource,kind as "blank"|"example"|"guide",locale,key=>messages[key]??key);
  return new NextResponse(csv,{headers:{
    "content-type":"text/csv; charset=utf-8",
    "content-disposition":`attachment; filename="crm-${resource.toLowerCase()}-${kind}.csv"`,
    "cache-control":"private, no-store",
    "x-content-type-options":"nosniff",
  }});
}

export const GET=apiRoute(get,"IMPORT_TEMPLATE_FAILED");
