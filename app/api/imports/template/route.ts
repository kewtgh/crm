import { NextResponse } from "next/server";
import { apiRoute, requireApiCapability } from "@/lib/api";
import { importFieldsByResource } from "@/lib/import-fields";
import { buildImportTemplate,type ImportResource } from "@/lib/import-template";
import { zhCN } from "@/lib/i18n/locales/zh-CN";
import { en } from "@/lib/i18n/locales/en";
import {buildV2Csv,buildV2Xlsx} from "@/lib/import-v2-template";
import {v2Resources,type V2Resource} from "@/lib/import-v2";
import {setResources,type SetResource} from '@/lib/import-set-contract';
import {buildSetTemplate} from '@/lib/import-set-template';

async function get(request:Request){
  await requireApiCapability("imports.view");
  const params=new URL(request.url).searchParams,resource=(params.get("resource")??"CONTACTS").toUpperCase(),kind=params.get("kind")??"blank",locale=params.get("locale")==="en"?"en":"zh-CN";
  if(params.get('templateVersion')==='SET_V1'){
    if(!(setResources as readonly string[]).includes(resource)||!['blank','example','guide'].includes(kind))return NextResponse.json({code:'TEMPLATE_SCHEMA_INVALID'},{status:400});
    const format=params.get('format')??'xlsx';if(!['csv','xlsx'].includes(format))return NextResponse.json({code:'INVALID_IMPORT_FORMAT'},{status:400});
    const csv=format==='csv'||kind==='guide',body=await buildSetTemplate(resource as SetResource,kind as 'blank'|'example'|'guide',format as 'csv'|'xlsx');
    return new NextResponse(typeof body==='string'?body:new Uint8Array(body),{headers:{'content-type':csv?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="crm-${resource.toLowerCase()}-set-v1-${kind}.${csv?'csv':'xlsx'}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  }
  if(!Object.hasOwn(importFieldsByResource,resource)||!["blank","example","guide"].includes(kind))return NextResponse.json({code:"INVALID_IMPORT_RESOURCE"},{status:400});
  if(params.get("templateVersion")==="2"){
    if(!(v2Resources as readonly string[]).includes(resource))return NextResponse.json({code:"TEMPLATE_VERSION_UNSUPPORTED"},{status:400});
    const format=params.get("format")??"xlsx";
    if(!["xlsx","csv"].includes(format))return NextResponse.json({code:"INVALID_IMPORT_FORMAT"},{status:400});
    const asCsv=format==="csv"||kind==="guide";
    const body=asCsv?buildV2Csv(resource as V2Resource,kind as "blank"|"example"|"guide"):new Uint8Array(await buildV2Xlsx(resource as V2Resource,kind as "blank"|"example"));
    return new NextResponse(body,{headers:{"content-type":asCsv?"text/csv; charset=utf-8":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","content-disposition":`attachment; filename="crm-${resource.toLowerCase()}-v2-${kind}.${asCsv?"csv":"xlsx"}"`,"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
  }
  if(params.has("templateVersion")&&params.get("templateVersion")!=="LEGACY_UNVERSIONED")return NextResponse.json({code:"TEMPLATE_VERSION_UNSUPPORTED"},{status:400});
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
