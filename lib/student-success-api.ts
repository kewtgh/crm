import {getDomainReportFilter} from "./domain-report-filter";
import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "./api";
import {DatabaseRequestError} from "./db/gateway";
import {mutationIsTrusted} from "./request-security";
import {successFiltersSchema,successCaseSaveSchema,successGoalSaveSchema,successTaskLinkSchema} from "./student-success-input";
import {getSuccessCase,listSuccessCases,listSuccessGoals,listSuccessHistory,listSuccessTasks,listSuccessTaskOptions,saveSuccessCase,saveSuccessGoal,saveSuccessTaskLink} from "./student-success-repository";
import {successCheckinSaveSchema,successRiskSaveSchema,successInterventionSaveSchema} from "./student-success-operations-input";
import {successOperationResources,listSuccessOperations,saveSuccessCheckin,saveSuccessRisk,saveSuccessIntervention} from "./student-success-operations-repository";
import {successOutcomeSaveSchema,successOutcomeVoidSchema} from "./student-success-outcomes-input";
import {listSuccessOutcomes,listSuccessOutcomePage,getSuccessOutcome,saveSuccessOutcome,voidSuccessOutcome} from "./student-success-outcomes-repository";
type Context={params:Promise<{id:string}>};
function fail(error:unknown):never{if(error instanceof DatabaseRequestError){const code=error.code;throw new ApiError(code,code.endsWith("_CONFLICT")||["SUCCESS_PARENT_IMMUTABLE","SUCCESS_CASE_EXISTS","SUCCESS_TASK_ALREADY_LINKED"].includes(code)?409:code.endsWith("_FORBIDDEN")?403:code.endsWith("_NOT_FOUND")?404:code.startsWith("SUCCESS_")||["CONSTRAINT_VIOLATION","INVALID_INPUT"].includes(code)?400:error.status);}throw error;}
async function get(request:Request,context?:Context){await requireApiCapability("education.view");const params=new URL(request.url).searchParams,id=context?(await context.params).id:params.get("id");try{
 if(id){if(!z.uuid().safeParse(id).success)throw new ApiError("SUCCESS_INPUT_INVALID",400);const page=z.coerce.number().int().min(1).max(100000).safeParse(params.get("page")??1);if(!page.success)throw new ApiError("SUCCESS_INPUT_INVALID",400);const item=await getSuccessCase(id);if(!item)throw new ApiError("SUCCESS_NOT_FOUND",404);
  const resource=params.get("resource");if(resource==="outcomes"){const show=params.get("showVoided")??"false";if(!["false","true"].includes(show))throw new ApiError("SUCCESS_INPUT_INVALID",400);return NextResponse.json({items:await listSuccessOutcomes(id,page.data,show==="true",undefined,getDomainReportFilter(Object.fromEntries(params),"/student-success"))});}if(resource&&Object.hasOwn(successOperationResources,resource))return NextResponse.json({items:await listSuccessOperations(id,resource as keyof typeof successOperationResources,page.data)});
  if(resource==="goals")return NextResponse.json({items:await listSuccessGoals(id,page.data)});if(resource==="history")return NextResponse.json({items:await listSuccessHistory(id,page.data)});if(resource==="tasks"){const intervention=params.get("interventionId");if(intervention&&!z.uuid().safeParse(intervention).success)throw new ApiError("SUCCESS_INPUT_INVALID",400);return NextResponse.json({items:await listSuccessTasks(id,page.data,undefined,intervention??undefined)});}
  if(resource==="taskOptions"){const query=z.string().max(80).safeParse(params.get("q")??"");if(!query.success||!item.can_edit)throw new ApiError("SUCCESS_UPDATE_FORBIDDEN",403);return NextResponse.json({items:await listSuccessTaskOptions(item.student_id,query.data)});}return NextResponse.json({item});
 }
 if(params.get("resource")==="outcomes"){const paging=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20)}).safeParse(Object.fromEntries(params));if(!paging.success)throw new ApiError("SUCCESS_INPUT_INVALID",400);return NextResponse.json(await listSuccessOutcomePage(getDomainReportFilter(Object.fromEntries(params),"/student-success"),paging.data.page,paging.data.pageSize));}
 const filters=successFiltersSchema.safeParse(Object.fromEntries(params));if(!filters.success)throw new ApiError("SUCCESS_INPUT_INVALID",400);return NextResponse.json(await listSuccessCases({...filters.data,reportFilter:getDomainReportFilter(Object.fromEntries(params),"/student-success")}));
 }catch(error){return fail(error);}}
async function save(request:Request,context?:Context){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("education.manage");const body=await request.json().catch(()=>({}));
 if(!body||typeof body!=="object"||Array.isArray(body)||body.operation!==undefined&&!["goal","taskLink","checkin","risk","intervention","outcome","voidOutcome"].includes(body.operation))throw new ApiError("SUCCESS_INPUT_INVALID",400);
 if(body.operation==="outcome"||body.operation==="voidOutcome"){
  const schema=body.operation==="outcome"?successOutcomeSaveSchema:successOutcomeVoidSchema,parsed=schema.safeParse(body.input);if(!parsed.success)throw new ApiError("SUCCESS_INPUT_INVALID",400);
  const parent="data" in parsed.data?parsed.data.data.case_id:parsed.data.caseId;if(context&&(await context.params).id!==parent)throw new ApiError("SUCCESS_INPUT_INVALID",400);if(request.method==="PATCH"&&parsed.data.expectedRevision===null)throw new ApiError("SUCCESS_INPUT_INVALID",400);
  try{if(body.operation==="voidOutcome"&&!await getSuccessOutcome(parent,parsed.data.id))throw new ApiError("SUCCESS_NOT_FOUND",404);const item=body.operation==="outcome"?await saveSuccessOutcome(successOutcomeSaveSchema.parse(parsed.data)):await voidSuccessOutcome(successOutcomeVoidSchema.parse(parsed.data));return NextResponse.json({item});}catch(error){return fail(error);}
 }
 if(["checkin","risk","intervention"].includes(body.operation)){
  const schema=body.operation==="checkin"?successCheckinSaveSchema:body.operation==="risk"?successRiskSaveSchema:successInterventionSaveSchema,parsed=schema.safeParse(body.input);
  if(!parsed.success)throw new ApiError("SUCCESS_INPUT_INVALID",400);if(context&&(await context.params).id!==parsed.data.data.case_id)throw new ApiError("SUCCESS_INPUT_INVALID",400);if(request.method==="PATCH"&&parsed.data.expectedRevision===null)throw new ApiError("SUCCESS_INPUT_INVALID",400);
  try{const item=body.operation==="checkin"?await saveSuccessCheckin(successCheckinSaveSchema.parse(parsed.data)):body.operation==="risk"?await saveSuccessRisk(successRiskSaveSchema.parse(parsed.data)):await saveSuccessIntervention(successInterventionSaveSchema.parse(parsed.data));return NextResponse.json({item});}catch(error){return fail(error);}
 }
 const schema=body.operation==="goal"?successGoalSaveSchema:body.operation==="taskLink"?successTaskLinkSchema:successCaseSaveSchema;
 const parsed=schema.safeParse(body.input??body);if(!parsed.success)throw new ApiError("SUCCESS_INPUT_INVALID",400);
 if(context){const id=(await context.params).id;if(!z.uuid().safeParse(id).success)throw new ApiError("SUCCESS_INPUT_INVALID",400);const parent=body.operation==="goal"?(parsed.data as z.infer<typeof successGoalSaveSchema>).data.case_id:body.operation==="taskLink"?(parsed.data as z.infer<typeof successTaskLinkSchema>).caseId:parsed.data.id;if(parent!==id)throw new ApiError("SUCCESS_INPUT_INVALID",400);}
 if(request.method==="PATCH"&&parsed.data.expectedRevision===null)throw new ApiError("SUCCESS_INPUT_INVALID",400);
 try{const item=body.operation==="goal"?await saveSuccessGoal(successGoalSaveSchema.parse(parsed.data)):body.operation==="taskLink"?await saveSuccessTaskLink(successTaskLinkSchema.parse(parsed.data)):await saveSuccessCase(successCaseSaveSchema.parse(parsed.data));return NextResponse.json({item});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"SUCCESS_LOAD_FAILED");export const POST=apiRoute(save,"SUCCESS_SAVE_FAILED");export const PATCH=apiRoute(save,"SUCCESS_SAVE_FAILED");
