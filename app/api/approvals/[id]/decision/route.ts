import { NextResponse } from "next/server";
import { decideApproval } from "@/lib/governance-repository";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { ApiError,apiRoute,parseUuid,requireApiAal2,requireApiRole } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import {approvalDecisionSchema} from "@/lib/approval-contract";

async function post(request:Request,context:{params:Promise<{id:string}>}){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  const parsed=approvalDecisionSchema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return NextResponse.json({code:parsed.error.issues[0]?.message??"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});
  await requireApiRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER");await requireApiAal2();
  const id=parseUuid((await context.params).id);
  try{return NextResponse.json({item:await decideApproval(id,parsed.data)});}
  catch(error){
    if(error instanceof DatabaseRequestError){
      if(["APPROVAL_ACCESS_DENIED","CASH_AUTHORITY_REQUIRED","REVENUE_AUTHORITY_REQUIRED","CASH_INDEPENDENT_REFUND_REVIEW","REVENUE_AAL2_REQUIRED"].includes(error.code))throw new ApiError(error.code,403);
      if(["APPROVAL_SNAPSHOT_CONFLICT","APPROVAL_REQUEST_CONFLICT","APPROVAL_NOT_PENDING","APPROVAL_DOMAIN_REVIEW_REQUIRED"].includes(error.code))throw new ApiError(error.code,409);
      if(error.code==="APPROVAL_INPUT_INVALID")throw new ApiError(error.code,400);
      throw error;
    }
    throw new ApiError("APPROVAL_DECISION_FAILED",500);
  }
}
export const POST=apiRoute(post,"APPROVAL_DECISION_FAILED");
