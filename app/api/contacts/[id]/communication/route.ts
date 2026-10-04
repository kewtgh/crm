import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {databaseJson} from "@/lib/db/gateway";
import {channelApiError} from "@/lib/channel-commercial-api";
import {mutationIsTrusted} from "@/lib/request-security";
const schema=z.object({expectedUpdatedAt:z.iso.datetime({offset:true}),wechatId:z.string().trim().max(100).nullable()}).strict();
export const POST=apiRoute(async(request:Request,context:{params:Promise<{id:string}>})=>{if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("education.manage");const {id}=await context.params,parsed=schema.safeParse(await request.json().catch(()=>({})));if(!z.uuid().safeParse(id).success||!parsed.success)throw new ApiError("CHANNEL_INPUT_INVALID",400);try{return NextResponse.json({item:await databaseJson("/db/rpc/save_contact_communication",{method:"POST",body:JSON.stringify({target_contact:id,expected_updated_at:parsed.data.expectedUpdatedAt,next_wechat_id:parsed.data.wechatId})})});}catch(e){return channelApiError(e);}},"CHANNEL_SAVE_FAILED");
