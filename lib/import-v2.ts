import {z} from "zod";
import {importFieldContract,normalizeContractMoney,type FieldContract} from "./import-field-contract";
import {businessConfig} from "./education-business";
import {normalizeBilingualNames} from "./bilingual-names";

export const v2Resources=["ORGANIZATIONS","HOUSEHOLDS","CONTACTS"] as const;
export type V2Resource=typeof v2Resources[number];
export const v2Controls=["operation","targetReference"] as const;
export const clearToken="__CLEAR__";
export const clearFields=new Set(["parentOrganizationId","website","foundedYear","studentCount","facultyCount","campusCount","annualIncomeAmount","email","phone","nextFollowUpAt","profile.primary_contact_id","profile.agreement_expires_on","profile.commercial_tier","profile.partnership_potential_score","profile.school_type","profile.grade_min","profile.grade_max","profile.tuition_min","profile.tuition_max","profile.tuition_currency","profile.budget_min","profile.budget_max","profile.target_intake"]);
export function v2Fields(resource:V2Resource|"STUDENTS"):FieldContract[]{return importFieldContract.filter(f=>f.resource===resource&&f.support==="SUPPORTED_IMPORT");}
export function v2Headers(resource:V2Resource|"STUDENTS"):string[]{return [...v2Controls,...v2Fields(resource).map(f=>f.key)];}
export type ImportIssue={code:string;field:string;column:string;row:number;sheet?:string};
export class ImportProtocolError extends Error {constructor(public code:string,public field=""){super(code);}}
export function validateV2Headers(resource:V2Resource,headers:readonly string[]){
  const expected=v2Headers(resource);
  for(const h of headers)if(!expected.includes(h))throw new ImportProtocolError("UNKNOWN_COLUMN",h);
  if(new Set(headers).size!==headers.length)throw new ImportProtocolError("TEMPLATE_SCHEMA_INVALID");
  for(const h of expected)if(!headers.includes(h))throw new ImportProtocolError("TEMPLATE_SCHEMA_INVALID",h);
}
export type V2Row={operation:"CREATE"|"UPDATE"|"SKIP";targetReference:string;patch:Record<string,unknown>;profile:Record<string,unknown>;location:{row:number;sheet?:string};errors:ImportIssue[]};
const textLimits:Record<string,number>={nameZh:120,nameEn:160,shortName:80,city:80,curriculum:120,address:1000,website:500,email:320,phone:40,title:120,preferredLanguage:80,acquisitionSource:160,notesMarkdown:20000,primaryParentOccupation:160,secondaryParentOccupation:160,wechatId:100};
const enumValues:Record<string,string[]>={organizationType:["SCHOOL","PARTNER","OTHER"],affiliationType:["INDEPENDENT","EDUCATION_GROUP","GOVERNMENT","UNIVERSITY","RELIGIOUS","OTHER"],contactType:["CONTACT","PARENT","STUDENT","SCHOOL_STAFF","PAYER"],contactStatus:["NEW","ATTEMPTING","CONNECTED","FOLLOW_UP","DORMANT"],preferredContactMethod:["EMAIL","PHONE","SMS","WECHAT","WHATSAPP","IN_PERSON"],decisionRole:["UNKNOWN","DECISION_MAKER","INFLUENCER","USER","GATEKEEPER","OTHER"]};
export function v2EnumValues(resource:V2Resource|"STUDENTS",field?:FieldContract):string[]{
 if(!field)return [];
 if(field.scope==="PROFILE")return businessConfig[resource==="ORGANIZATIONS"?"organizations":"needs"].fields.find(f=>`profile.${f.key}`===field.key)?.options?.filter(Boolean)??[];
 if(field.key==="status")return resource==="STUDENTS"?["ACTIVE","ON_LEAVE","ALUMNI","WITHDRAWN","ARCHIVED"]:resource==="ORGANIZATIONS"?["HEALTHY","ATTENTION","DEVELOPING","RISK","UNVERIFIED"]:resource==="HOUSEHOLDS"?["ACTIVE","INACTIVE","ARCHIVED"]:["ACTIVE","FOLLOW_UP","VERIFIED","PROTECTED","UNVERIFIED"];
 if(field.key==='preferredLearningStyle')return ['UNSPECIFIED','VISUAL','AUDITORY','READ_WRITE','KINESTHETIC','MIXED'];
 return enumValues[field.key]??[];
}
function valueFor(resource:V2Resource|"STUDENTS",field:FieldContract,text:string):unknown{
 const profile=field.scope==="PROFILE"?businessConfig[resource==="ORGANIZATIONS"?"organizations":"needs"].fields.find(f=>`profile.${f.key}`===field.key):undefined;
 if(field.type==="reference"){
  if(!/^ir_[a-f0-9]{64}$/.test(text))throw new ImportProtocolError("INVALID_REFERENCE",field.key);
  return text;
 }
 if(field.type==="decimal"){
  try{return normalizeContractMoney(text);}catch{throw new ImportProtocolError("INVALID_DECIMAL",field.key);}
 }
 if(field.type==="currency") {if(!/^[A-Z]{3}$/.test(text))throw new ImportProtocolError("INVALID_ENUM",field.key);return text;}
 if(field.type==="date"){if(!z.iso.date().safeParse(text).success)throw new ImportProtocolError("INVALID_DATE",field.key);return text;}
 if(field.type==="timestamp"){if(!z.iso.datetime({offset:true}).safeParse(text).success)throw new ImportProtocolError("INVALID_DATE",field.key);return text;}
 if(field.type==="integer"){
  const min=field.key==="communicationLevel"?1:field.key==="foundedYear"?1000:profile?.min??0;
  const max=field.key==="communicationLevel"?4:field.key==="foundedYear"?9999:profile?.max??2147483647;
  if(!/^\d+$/.test(text)||BigInt(text)<BigInt(min)||BigInt(text)>BigInt(max))throw new ImportProtocolError("INVALID_INTEGER",field.key);
  return Number(text); // Only bounded integer fields; money never passes here.
 }
 if(field.type==="enum"){if(!v2EnumValues(resource,field).includes(text))throw new ImportProtocolError("INVALID_ENUM",field.key);return text;}
 if(field.type==="array"){
  const values=text.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  if(new Set(values).size!==values.length)throw new ImportProtocolError("INVALID_ARRAY",field.key);
  if(profile?.options&&values.some(v=>!profile.options!.includes(v)))throw new ImportProtocolError("INVALID_ENUM",field.key);
  const max=field.key==="courseCategories"?40:field.key==="tags"?30:profile?.options?.length??30;
  const width=field.key==="tags"?60:100;
  if(values.length>max||values.some(v=>v.length>width))throw new ImportProtocolError("INVALID_ARRAY",field.key);
  return values;
 }
 const max=profile?.max??textLimits[field.key]??(field.key.endsWith("Markdown")?10000:160);
 if(text.length>max)throw new ImportProtocolError("INVALID_TEXT",field.key);
 if(field.key==="email"&&!z.email().safeParse(text).success)throw new ImportProtocolError("INVALID_EMAIL",field.key);
 if(field.key==="website"&&!z.url().safeParse(text).success)throw new ImportProtocolError("INVALID_URL",field.key);
 return text;
}
// Shared by preflight, repair and execute; DB repeats authorization/domain constraints in one transaction.
export function normalizeV2Row(resource:V2Resource|"STUDENTS",input:Record<string,unknown>,row:number,sheet?:string):V2Row{
 const result:V2Row={operation:"CREATE",targetReference:"",patch:{},profile:{},location:{row,...(sheet?{sheet}:{})},errors:[]};
 const fail=(code:string,field:string)=>result.errors.push({code,field,column:field,row,...(sheet?{sheet}:{})});
 const allowed=v2Headers(resource);
 for(const key of Object.keys(input))if(!allowed.includes(key))fail("UNKNOWN_COLUMN",key);
 const operation=String(input.operation??"").trim()||"CREATE";
 if(!["CREATE","UPDATE","SKIP"].includes(operation))fail("UNSUPPORTED_OPERATION","operation");
 else result.operation=operation as V2Row["operation"];
 result.targetReference=String(input.targetReference??"").trim();
 if(result.operation==="UPDATE"&&!/^ir_[a-f0-9]{64}$/.test(result.targetReference))fail("INVALID_REFERENCE","targetReference");
 if(result.operation==="CREATE"&&result.targetReference)fail("UNSUPPORTED_OPERATION","targetReference");
 if(result.operation==="SKIP")return result;
 for(const field of v2Fields(resource)){
  const raw=input[field.key];
  if(raw===null||raw===undefined||typeof raw==="string"&&!raw.trim())continue;
  if(typeof raw!=="string"){fail("INVALID_CELL",field.key);continue;}
  const text=raw.trim();
  if(result.operation==="CREATE"&&!field.create||result.operation==="UPDATE"&&!field.update){fail("UNSUPPORTED_OPERATION",field.key);continue;}
  const target=field.scope==="PROFILE"?result.profile:result.patch;
  const key=field.scope==="PROFILE"?field.key.slice(8):field.key;
  if(text===clearToken){
   if(result.operation!=="UPDATE"||!clearFields.has(field.key))fail("CLEAR_NOT_ALLOWED",field.key);
   else target[key]=null;
   continue;
  }
  try{target[key]=valueFor(resource,field,text);}catch(error){fail(error instanceof ImportProtocolError?error.code:"INVALID_CELL",field.key);}
 }
 if(result.operation==="CREATE"){
  if(resource==='STUDENTS'){for(const key of ['personId','currentGrade','academicYear'])if(!result.patch[key])fail('REQUIRED',key);}
  else if(!result.patch.nameZh&&!result.patch.nameEn)fail("REQUIRED","nameZh");
  else result.patch=normalizeBilingualNames(result.patch) as Record<string,unknown>;
  if(resource==="ORGANIZATIONS"&&!result.patch.city)fail("REQUIRED","city");
  if(resource==="CONTACTS"&&!result.patch.email&&!result.patch.phone)fail("REQUIRED","email");
 }
 return result;
}

export const v2CreateSchema=z.object({operation:z.literal("createV2"),resource:z.enum(v2Resources),templateVersion:z.literal("2"),headers:z.array(z.string()).max(100),filename:z.string().min(1).max(180),contentHash:z.string().regex(/^[a-f0-9]{64}$/),requestKey:z.string().min(8).max(160),rows:z.array(z.record(z.string(),z.string().max(20000))).min(1).max(10000),rowLocations:z.array(z.number().int().positive()).max(10000),sheet:z.string().max(80).optional()}).strict();
