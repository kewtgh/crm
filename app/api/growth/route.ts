import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { createGrowthCampaign,loadGrowthSnapshot,recordAttribution,saveAdmissionJourney } from "@/lib/v220-repository";

const schema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("campaign"),code:z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/).transform(value=>value.toUpperCase()),nameZh:z.string().trim().min(2).max(160),nameEn:z.string().trim().min(2).max(160),channel:z.string().trim().min(2).max(80),status:z.enum(["PLANNED","ACTIVE","PAUSED","COMPLETED"]),budget:z.number().nonnegative().max(1e12),currency:z.string().regex(/^[A-Z]{3}$/),startsOn:z.string().date().nullable().optional(),endsOn:z.string().date().nullable().optional()}),
  z.object({operation:z.literal("attribution"),leadId:z.uuid(),campaignId:z.uuid().nullable().optional(),touchType:z.enum(["FIRST","ASSIST","LAST"]),channel:z.string().trim().min(2).max(80),source:z.string().trim().min(1).max(160),medium:z.string().trim().max(160).default(""),content:z.string().trim().max(500).default("")}),
  z.object({operation:z.literal("journey"),leadId:z.uuid().nullable().optional(),studentId:z.uuid().nullable().optional(),stage:z.enum(["INQUIRY","ASSESSMENT","PLANNING","APPLICATION","OFFER","ENROLLED","CLOSED"]),probability:z.number().int().min(0).max(100),nextAction:z.string().trim().max(1000).default(""),nextActionAt:z.iso.datetime().nullable().optional()}).refine(value=>Boolean(value.leadId)!==Boolean(value.studentId),{path:["leadId"]}),
]);
async function get(){await requireApiCapability("leads.view");return NextResponse.json({data:await loadGrowthSnapshot()});}
async function post(request:Request){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("leads.manage");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)throw new ApiError("INVALID_GROWTH_INPUT",400,"INVALID_GROWTH_INPUT",{field:String(parsed.error.issues[0]?.path[0]??"form")});if(parsed.data.operation==="campaign")await createGrowthCampaign(parsed.data);else if(parsed.data.operation==="attribution")await recordAttribution(parsed.data);else await saveAdmissionJourney(parsed.data);return NextResponse.json({data:await loadGrowthSnapshot()});}
export const GET=apiRoute(get,"GROWTH_LOAD_FAILED");
export const POST=apiRoute(post,"GROWTH_OPERATION_FAILED");
