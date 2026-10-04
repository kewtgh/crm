import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,ApiError,requireApiCapability} from "@/lib/api";
import {databaseJson} from "@/lib/db/gateway";
import {channelApiError,contactIntelligenceMutation} from "@/lib/channel-commercial-api";
import type {ContactIntelligence} from "@/lib/channel-commercial-input";
export const GET=apiRoute(async(_:Request,context:{params:Promise<{id:string}>})=>{await requireApiCapability("education.view");const {id}=await context.params;if(!z.uuid().safeParse(id).success)throw new ApiError("CHANNEL_INPUT_INVALID",400);try{return NextResponse.json({items:await databaseJson<ContactIntelligence[]>(`/db/table/organization_contact_intelligence_records?contact_id=eq.${id}&limit=1`)},{headers:{"cache-control":"no-store"}});}catch(e){return channelApiError(e);}},"CHANNEL_LOAD_FAILED");
export const POST=apiRoute(contactIntelligenceMutation,"CHANNEL_SAVE_FAILED");
export const PATCH=apiRoute(contactIntelligenceMutation,"CHANNEL_SAVE_FAILED");
