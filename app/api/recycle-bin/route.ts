import {NextResponse} from "next/server";
import {ApiError,apiRoute,requireApiAal2,requireApiUser} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {loadRecyclePage,restoreRecycleRecord} from "@/lib/recycle-bin-repository";
import {recycleQuerySchema,recycleScopeSchema,recycleRestoreSchema} from "@/lib/recycle-contract";
import {DatabaseRequestError} from "@/lib/db/gateway";

async function resultFrom<T>(operation:()=>Promise<T>){
  try{return await operation();}
  catch(error){
    if(error instanceof DatabaseRequestError&&error.code==="RECYCLE_ACCESS_DENIED")throw new ApiError(error.code,403);
    if(error instanceof DatabaseRequestError&&["RECYCLE_VERSION_CONFLICT","RECYCLE_REQUEST_CONFLICT"].includes(error.code))throw new ApiError(error.code,409);
    throw error;
  }
}

async function authorize(scope:"personal"|"workspace",write=false){
  const user=await requireApiUser();
  if(scope==="workspace"&&user.role!=="SUPER_ADMIN")throw new ApiError("RECYCLE_ACCESS_DENIED",403);
  if(scope==="workspace"||write&&["ADMIN","SUPER_ADMIN"].includes(user.role))await requireApiAal2();
}
export const GET=apiRoute(async(request:Request)=>{
  const params=new URL(request.url).searchParams;
  const scope=recycleScopeSchema.safeParse(params.get("scope")??"personal");
  const query=recycleQuerySchema.safeParse(Object.fromEntries(["q","kind","retention","page","pageSize"].flatMap(key=>params.has(key)?[[key,params.get(key)]]:[])));
  if(!scope.success||!query.success)throw new ApiError("RECYCLE_INPUT_INVALID",400);
  await authorize(scope.data);return NextResponse.json(await resultFrom(()=>loadRecyclePage(scope.data,query.data)));
},"RECYCLE_LOAD_FAILED");
export const POST=apiRoute(async(request:Request)=>{
  if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
  const parsed=recycleRestoreSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)throw new ApiError("RECYCLE_INPUT_INVALID",400);
  await authorize(parsed.data.scope,true);return NextResponse.json(await resultFrom(()=>restoreRecycleRecord(parsed.data)));
},"RECYCLE_RESTORE_FAILED");
