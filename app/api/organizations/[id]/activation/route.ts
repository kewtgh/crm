import {NextResponse} from "next/server";
import {ApiError,apiRoute,parseUuid,requireApiCapability} from "@/lib/api";
import {getChannelActivation,updatePartnershipStage} from "@/lib/channel-activation-repository";
import {stageInputSchema} from "@/lib/lead-pool-input";
import {mutationIsTrusted} from "@/lib/request-security";
export const GET=apiRoute(async(_request:Request,context:{params:Promise<{id:string}>})=>{await requireApiCapability("education.view");return NextResponse.json(await getChannelActivation(parseUuid((await context.params).id)));},"CHANNEL_LOAD_FAILED");
export const POST=apiRoute(async(request:Request,context:{params:Promise<{id:string}>})=>{if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("education.manage");const parsed=stageInputSchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)throw new ApiError("CHANNEL_INPUT_INVALID",400);return NextResponse.json({item:await updatePartnershipStage(parseUuid((await context.params).id),parsed.data)});},"CHANNEL_SAVE_FAILED");
