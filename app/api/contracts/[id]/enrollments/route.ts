import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {databaseJson} from "@/lib/db/gateway";
import {mutationIsTrusted} from "@/lib/request-security";
import {contractEnrollmentMutationSchema} from "@/lib/contract-enrollment-input";
import {listContractEnrollmentLinks,mutateContractEnrollment} from "@/lib/contract-enrollment-repository";
type Context={params:Promise<{id:string}>};
async function contractId(context:Context){const id=z.uuid().safeParse((await context.params).id);if(!id.success)throw new ApiError("COMMERCIAL_INPUT_INVALID",400);return id.data;}
async function get(request:Request,context:Context){await requireApiCapability("contracts.view");const id=await contractId(context);const params=new URL(request.url).searchParams,pageInput=z.coerce.number().int().min(1).max(100000).safeParse(params.get("page")??1);if(!pageInput.success)throw new ApiError("COMMERCIAL_INPUT_INVALID",400);const page=pageInput.data;const rows=await databaseJson<Array<{id:string}>>(`/db/table/contracts?select=id&id=eq.${id}&limit=1`);if(!rows.length)throw new ApiError("COMMERCIAL_LINK_FORBIDDEN",403);
  if(params.get("resource")==="options"){const query=(params.get("q")??"").replace(/[*,()%_]/g," ").trim().slice(0,80),filter=new URLSearchParams({contract_id:`eq.${id}`,limit:"20",order:"enrollment_id"});if(query)filter.set("or",`(student_name_zh.ilike.*${query}*,student_name_en.ilike.*${query}*)`);return NextResponse.json({items:await databaseJson(`/db/table/contract_enrollment_candidates?${filter}`)});}
  return NextResponse.json({items:await listContractEnrollmentLinks({contractId:id,page})});}
async function post(request:Request,context:Context){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("contracts.manage");const id=await contractId(context),parsed=contractEnrollmentMutationSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ApiError("COMMERCIAL_INPUT_INVALID",400);
  // An unlink must belong to the route contract, not merely any accessible contract.
  if(parsed.data.operation==="unlink"){const rows=await databaseJson<Array<{id:string}>>(`/db/table/contract_enrollment_links?select=id&id=eq.${parsed.data.id}&contract_id=eq.${id}&limit=1`);if(!rows.length)throw new ApiError("COMMERCIAL_LINK_FORBIDDEN",403);}
  return NextResponse.json({item:await mutateContractEnrollment(id,parsed.data)});
}
export const GET=apiRoute(get,"COMMERCIAL_LOAD_FAILED");export const POST=apiRoute(post,"COMMERCIAL_SAVE_FAILED");
