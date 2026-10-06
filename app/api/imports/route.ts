import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiCapability } from "@/lib/api";
import { importOperation,listImportBatches,listImportMappingProfiles,listImportRows,saveImportMappingProfile,mapImportBatch } from "@/lib/phase2-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { IMPORT_MAX_ROWS } from "@/lib/import-execution";
import {importFieldsByResource} from "@/lib/import-fields";
import { normalizeBilingualNames } from "@/lib/bilingual-names";
import {v2CreateSchema} from '@/lib/import-v2';
import {createV2Import,v2ActionSchema,v2ImportAction,safeImportError} from '@/lib/import-v2-repository';

const importField=z.enum(["productCode","cohortCode","intakeType","applicationOpenOn","applicationDeadline","startOn","endOn","targetEnrollment","capacity","currency","ownerEmail","status","salesOwnerEmail","householdReference","opportunityReference","enrolledAt","completedAt","withdrawnAt","withdrawalReason","nameZh","nameEn","email","phone","city","title","curriculum","courseCategories","affiliationType","parentOrganizationId","website","foundedYear","studentCount","facultyCount","campusCount","organizationOverviewMarkdown","structureOverviewMarkdown","address","primaryParentOccupation","secondaryParentOccupation","annualIncomeAmount","incomeCurrency","preferredContactMethod","preferredLanguage","educationExpectationsMarkdown","familyBackgroundMarkdown","personId","householdId","studentNumber","birthDate","currentGrade","currentClass","academicYear","interests","preferredLearningStyle","personalityMarkdown","learningExpectationsMarkdown","strengthsMarkdown","supportNeedsMarkdown"]);
const sourceHeader=z.string().trim().min(1).max(160);
const mappingSchema=z.partialRecord(importField,sourceHeader);
const importRow=z.object({
productCode:z.string().trim().max(160).default(""),
cohortCode:z.string().trim().max(160).default(""),
intakeType:z.string().trim().max(160).default(""),
applicationOpenOn:z.string().trim().max(160).default(""),
applicationDeadline:z.string().trim().max(160).default(""),
startOn:z.string().trim().max(160).default(""),
endOn:z.string().trim().max(160).default(""),
targetEnrollment:z.string().trim().max(160).default(""),
capacity:z.string().trim().max(160).default(""),
currency:z.string().trim().max(160).default(""),
ownerEmail:z.string().trim().max(160).default(""),
status:z.string().trim().max(160).default(""),
salesOwnerEmail:z.string().trim().max(160).default(""),
householdReference:z.string().trim().max(160).default(""),
opportunityReference:z.string().trim().max(160).default(""),
enrolledAt:z.string().trim().max(160).default(""),
completedAt:z.string().trim().max(160).default(""),
withdrawnAt:z.string().trim().max(160).default(""),
withdrawalReason:z.string().trim().max(1000).default(""),

  nameZh:z.string().trim().max(120).default(""),
  nameEn:z.string().trim().max(160).default(""),
  email:z.string().trim().max(320).default(""),
  phone:z.string().trim().max(40).default(""),
  city:z.string().trim().max(80).default(""),
  title:z.string().trim().max(120).default(""),
  curriculum:z.string().trim().max(120).default(""),courseCategories:z.string().trim().max(2000).default(""),affiliationType:z.string().trim().max(40).default(""),parentOrganizationId:z.string().trim().max(60).default(""),website:z.string().trim().max(500).default(""),foundedYear:z.string().trim().max(4).default(""),studentCount:z.string().trim().max(12).default(""),facultyCount:z.string().trim().max(12).default(""),campusCount:z.string().trim().max(12).default(""),organizationOverviewMarkdown:z.string().max(10000).default(""),structureOverviewMarkdown:z.string().max(10000).default(""),
  address:z.string().max(1000).default(""),primaryParentOccupation:z.string().trim().max(160).default(""),secondaryParentOccupation:z.string().trim().max(160).default(""),annualIncomeAmount:z.string().trim().max(30).default(""),incomeCurrency:z.string().trim().max(3).default(""),preferredContactMethod:z.string().trim().max(30).default(""),preferredLanguage:z.string().trim().max(80).default(""),educationExpectationsMarkdown:z.string().max(10000).default(""),familyBackgroundMarkdown:z.string().max(10000).default(""),
  personId:z.string().trim().max(60).default(""),householdId:z.string().trim().max(60).default(""),studentNumber:z.string().trim().max(60).default(""),birthDate:z.string().trim().max(10).default(""),currentGrade:z.string().trim().max(40).default(""),currentClass:z.string().trim().max(80).default(""),academicYear:z.string().trim().max(20).default(""),interests:z.string().trim().max(2000).default(""),preferredLearningStyle:z.string().trim().max(30).default(""),personalityMarkdown:z.string().max(10000).default(""),learningExpectationsMarkdown:z.string().max(10000).default(""),strengthsMarkdown:z.string().max(10000).default(""),supportNeedsMarkdown:z.string().max(10000).default(""),
}).strict().transform(row=>normalizeBilingualNames(row) as typeof row);
const importResource=z.enum(["ORGANIZATIONS","CONTACTS","HOUSEHOLDS","STUDENTS","COHORTS","ENROLLMENTS"]);
const create=z.object({operation:z.literal("create"),resource:importResource,filename:z.string().trim().min(1).max(180),content_hash:z.string().regex(/^[a-f0-9]{64}$/i),request_key:z.string().min(8).max(160),mapping:mappingSchema,rows:z.array(importRow).min(1).max(IMPORT_MAX_ROWS)});
const decide=z.object({operation:z.literal("decide"),target_row:z.uuid(),chosen_action:z.enum(["CREATE","UPDATE","MERGE","SKIP"])});
const repair=z.object({operation:z.literal("repair"),target_row:z.uuid(),replacement:importRow});
const process=z.object({operation:z.literal("process"),target_batch:z.uuid(),batch_size:z.number().int().min(1).max(100).default(100)});
const rollback=z.object({operation:z.literal("rollback"),target_batch:z.uuid(),requestKey:z.string().trim().min(8).max(160)});
const saveMapping=z.object({operation:z.literal("saveMapping"),resource:importResource,name:z.string().trim().min(1).max(80),mapping:mappingSchema});
const schema=z.discriminatedUnion("operation",[create,decide,repair,process,rollback,saveMapping]);
async function get(request:Request){await requireApiCapability("imports.view");const url=new URL(request.url);if(url.searchParams.get("mappingProfiles")==="true"){const resource=url.searchParams.get("resource");if(resource&&!Object.hasOwn(importFieldsByResource,resource))return NextResponse.json({code:"INVALID_IMPORT_RESOURCE"},{status:400});return NextResponse.json(await listImportMappingProfiles(resource??undefined));}const batch=url.searchParams.get("batch");const parsedPage=Number(url.searchParams.get(batch?"rowPage":"page")??1);const parsedPageSize=Number(url.searchParams.get(batch?"rowPageSize":"pageSize")??(batch?50:10));if(!Number.isInteger(parsedPage)||parsedPage<1||![10,20,50].includes(parsedPageSize))return NextResponse.json({code:"INVALID_PAGINATION"},{status:400});try{return NextResponse.json(batch?await listImportRows(batch,parsedPage,parsedPageSize):await listImportBatches(parsedPage,parsedPageSize));}catch{return NextResponse.json({code:"IMPORT_LOAD_FAILED"},{status:500});}}
async function post(request:Request){
 if(!mutationIsTrusted(request))return NextResponse.json({code:'UNTRUSTED_ORIGIN'},{status:403});
 await requireApiCapability('imports.execute');const raw=await request.json().catch(()=>({}));
 if(raw.operation==='createV2'||String(raw.operation).endsWith('V2')){
  const parsed=raw.operation==='createV2'?v2CreateSchema.safeParse(raw):v2ActionSchema.safeParse(raw);
  if(!parsed.success)return NextResponse.json({code:'INVALID_IMPORT_INPUT',field:String(parsed.error.issues[0]?.path[0]??'form')},{status:400});
  try{
   const result=await (parsed.data.operation==='createV2'?createV2Import(parsed.data):v2ImportAction(parsed.data)) as Record<string,unknown>;
   const item=parsed.data.operation==='saveMappingV2'?{id:result.id,resource:result.resource,name:result.name,mapping:result.mapping,templateVersion:result.template_version,revision:result.revision,updatedAt:result.updated_at}:['createV2','processV2','rollbackV2'].includes(parsed.data.operation)?mapImportBatch(result):result;
   return NextResponse.json({item});
  }
  catch(error){return NextResponse.json({code:safeImportError(error),field:typeof error==='object'&&error&&'field' in error?error.field:undefined},{status:409});}
 }
 const parsed=schema.safeParse(raw);if(!parsed.success)return NextResponse.json({code:'INVALID_IMPORT_INPUT',field:String(parsed.error.issues[0]?.path[0]??'form')},{status:400});
 try{return NextResponse.json({item:parsed.data.operation==='saveMapping'?await saveImportMappingProfile(parsed.data):await importOperation(parsed.data as unknown as Record<string,unknown>)});}
 catch{return NextResponse.json({code:'IMPORT_OPERATION_FAILED'},{status:409});}
}
export const GET=apiRoute(get,"IMPORT_LOAD_FAILED");
export const POST=apiRoute(post,"IMPORT_OPERATION_FAILED");
