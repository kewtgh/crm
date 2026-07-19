import { NextResponse } from "next/server";
import { z } from "zod";
import {
  loadCrmRecord,
  updateCrmRecord,
  type PersistentResource,
} from "@/lib/crm-repository";
import { apiRoute, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { SupabaseRequestError } from "@/lib/supabase-server";

const resources=new Set<PersistentResource>(["schools","people","tasks"]);
const basePatch=z.object({
  nameZh:z.string().trim().min(1).max(120).optional(),
  nameEn:z.string().trim().min(1).max(160).optional(),
  status:z.string().trim().max(40).optional(),
  archived:z.boolean().optional(),
});
const schemas={
  schools:basePatch.extend({
    city:z.string().trim().min(1).max(80).optional(),
    curriculum:z.string().trim().min(1).max(120).optional(),
  }).strict(),
  people:basePatch.extend({
    email:z.string().email().or(z.literal("")).optional(),
    phone:z.string().trim().max(40).optional(),
    title:z.string().trim().max(120).optional(),
  }).strict(),
  tasks:basePatch.extend({
    priority:z.enum(["LOW","NORMAL","HIGH","URGENT"]).optional(),
    dueAt:z.string().datetime().optional(),
    ownerId:z.string().uuid().optional(),
  }).strict(),
} satisfies Record<PersistentResource,z.ZodType>;
const requestSchema=z.object({
  expectedUpdatedAt:z.string().datetime(),
  patch:z.record(z.string(),z.unknown()),
});

function resourceFrom(value:string){
  return resources.has(value as PersistentResource)?value as PersistentResource:null;
}
function failure(error:unknown){
  if(error instanceof SupabaseRequestError){
    const detail=`${error.code} ${error.message}`.toLowerCase();
    if(detail.includes("version_conflict"))return NextResponse.json({code:"CRM_VERSION_CONFLICT"},{status:409});
    if(detail.includes("forbidden")||detail.includes("not_assignable"))return NextResponse.json({code:"CRM_UPDATE_FORBIDDEN"},{status:403});
    if(detail.includes("not_found"))return NextResponse.json({code:"CRM_RECORD_NOT_FOUND"},{status:404});
    return NextResponse.json({code:error.code,message:error.message},{status:error.status});
  }
  return NextResponse.json({code:"CRM_OPERATION_FAILED"},{status:500});
}

async function get(_:Request,context:{params:Promise<{resource:string;id:string}>}){
  await requireApiUser();
  const {resource:raw,id}=await context.params;
  const resource=resourceFrom(raw);
  if(!resource)return NextResponse.json({code:"UNKNOWN_RESOURCE"},{status:404});
  const parsedId=z.string().uuid().safeParse(id);
  if(!parsedId.success)return NextResponse.json({code:"INVALID_ID"},{status:400});
  try{return NextResponse.json(await loadCrmRecord(resource,parsedId.data),{headers:{"cache-control":"no-store"}});}
  catch(error){return failure(error);}
}

async function patch(request:Request,context:{params:Promise<{resource:string;id:string}>}){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  await requireApiUser();
  const {resource:raw,id}=await context.params;
  const resource=resourceFrom(raw);
  if(!resource)return NextResponse.json({code:"UNKNOWN_RESOURCE"},{status:404});
  const parsedId=z.string().uuid().safeParse(id);
  const parsed=requestSchema.safeParse(await request.json().catch(()=>({})));
  if(!parsedId.success||!parsed.success)return NextResponse.json({code:"INVALID_INPUT"},{status:400});
  const validPatch=schemas[resource].safeParse(parsed.data.patch);
  if(!validPatch.success||!Object.keys(validPatch.data).length){
    return NextResponse.json({code:"INVALID_INPUT",field:String(validPatch.error?.issues[0]?.path[0]??"patch")},{status:400});
  }
  try{
    await updateCrmRecord(resource,parsedId.data,parsed.data.expectedUpdatedAt,validPatch.data);
    return NextResponse.json({item:await loadCrmRecord(resource,parsedId.data)});
  }catch(error){return failure(error);}
}

export const GET=apiRoute(get,"CRM_LOAD_FAILED");
export const PATCH=apiRoute(patch,"CRM_UPDATE_FAILED");
