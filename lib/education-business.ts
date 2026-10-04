import {commercialFields,commercialProfileSchema} from "./channel-commercial-input";
import { z } from "zod";

export const businessResources = ["organizations", "needs", "pathways", "events", "referrals", "participations", "applications"] as const;
export type BusinessResource = typeof businessResources[number];
export type BusinessContext = { type: "ORGANIZATION" | "HOUSEHOLD" | "STUDENT"; id: string };
export type BusinessRecord = { id: string; revision: number; updated_at: string } & Record<string, unknown>;
export type BusinessField = {
  key: string; kind: "text" | "date" | "number" | "enum" | "multi" | "relation";
  required?: boolean; options?: string[]; relation?: "ORGANIZATION" | "HOUSEHOLD" | "STUDENT" | "CONTACT" | "EVENT" | "PRODUCT" | "COHORT" | "CAMPAIGN" | "APPLICATION";
  max?: number; min?: number; integer?: boolean; initial?: string;
};
const text = (key: string, required = false, max = 160): BusinessField => ({key,kind:"text",required,max});
const date = (key: string, required = false): BusinessField => ({key,kind:"date",required});
const number = (key: string, max = 1_000_000_000, integer = false): BusinessField => ({key,kind:"number",max,integer,min:0});
const choices = (key: string, options: string[], initial = options[0]): BusinessField => ({key,kind:"enum",options,initial,required:!options.includes("")});
const multi = (key: string, options: string[]): BusinessField => ({key,kind:"multi",options});
const relation = (key: string, type: BusinessField["relation"], required = false): BusinessField => ({key,kind:"relation",relation:type,required});
export const programTypes = ["FOUNDATION", "BRIDGE", "STUDY_TOUR"];
export const targetRegions = ["UK", "US", "AU", "CA", "NZ", "EU", "ASIA", "OTHER"];
export const organizationRoles = ["SCHOOL_ENTRY", "REFERRAL_PARTNER", "TOUR_PARTNER", "UNIVERSITY_DESTINATION"];
export const businessConfig: Record<BusinessResource, {table:string; fields:BusinessField[]; subject?:BusinessContext["type"]}> = {
  organizations: {table:"organization_business_profiles",subject:"ORGANIZATION",fields:[
    choices("organization_type",["SCHOOL","PARTNER","OTHER","FAMILY"]),multi("roles",organizationRoles),
    choices("partnership_stage",["PROSPECT","CONTACTING","ACTIVE","PAUSED","ENDED","KEY_PERSON_ENGAGED","NEEDS_QUALIFIED","SOLUTION_PROPOSED","PARTNERSHIP_AGREED","RECRUITMENT_ACTIVATED","ONGOING_ENABLEMENT"]),relation("primary_contact_id","CONTACT"),
    multi("focus_regions",targetRegions),date("agreement_expires_on"),text("next_action",false,1000),
    choices("commercial_tier",["","S","A","B","C","D"],""),{...number("partnership_potential_score",100,true),min:10},text("competitor_analysis_markdown",false,20000),text("bd_plan_markdown",false,20000),choices("school_type",["","PUBLIC","PRIVATE","INTERNATIONAL","OTHER"],""),number("grade_min",12,true),number("grade_max",12,true),number("tuition_min"),number("tuition_max"),choices("tuition_currency",["","CNY","USD","GBP","AUD","CAD","EUR","NZD","HKD","SGD","TWD"],""),
  ]},
  needs: {table:"family_education_needs",subject:"HOUSEHOLD",fields:[
    multi("services",programTypes),multi("target_regions",targetRegions),number("budget_min"),number("budget_max"),
    choices("budget_currency",["CNY","USD","GBP","AUD","CAD","EUR","NZD","HKD","SGD","TWD"]),date("target_intake"),
    choices("decision_stage",["DISCOVERY","COMPARING","READY","ON_HOLD","CLOSED"]),text("next_action",false,1000),
  ]},
  pathways: {table:"student_pathways",subject:"STUDENT",fields:[
    relation("student_id","STUDENT",true),choices("program_type",["FOUNDATION","BRIDGE"]),relation("target_organization_id","ORGANIZATION"),
    choices("target_region",["",...targetRegions]),text("target_major"),date("intake_date"),date("application_deadline"),
    choices("language_test",["NONE","IELTS","TOEFL","DUOLINGO","OTHER"]),number("language_score",999),
    choices("stage",["EXPLORING","ASSESSING","PREPARING","APPLIED","OFFERED","ENROLLED","CLOSED"]),text("next_action",false,1000),
  ]},
  events: {table:"education_outreach_events",subject:"ORGANIZATION",fields:[
    relation("campaign_id","CAMPAIGN"),relation("product_id","PRODUCT"),relation("cohort_id","COHORT"),
    text("name",true,200),relation("organization_id","ORGANIZATION",true),relation("partner_organization_id","ORGANIZATION"),
    choices("kind",["SEMINAR","CAMPUS_VISIT","STUDY_TOUR"]),date("starts_on",true),date("ends_on",true),text("location"),
    number("capacity",100000,true),number("attendee_count",100000,true),choices("status",["DRAFT","CONFIRMED","COMPLETED","CANCELLED"]),text("next_action",false,1000),
  ]},
  participations: {table:"education_event_participations",subject:"HOUSEHOLD",fields:[
    relation("household_id","HOUSEHOLD",true),relation("event_id","EVENT",true),{...number("party_size",1000,true),min:1,required:true},
    choices("status",["INTERESTED","REGISTERED","ATTENDED","CANCELLED"]),text("next_action",false,1000),
  ]},
  applications: {table:"student_application_tasks",subject:"STUDENT",fields:[
    relation("student_id","STUDENT",true),relation("application_id","APPLICATION"),text("title",true,200),date("due_on"),choices("status",["TODO","IN_PROGRESS","DONE","WAIVED"]),text("next_action",false,1000),
  ]},
  referrals: {table:"education_family_referrals",fields:[
    relation("source_organization_id","ORGANIZATION",true),relation("household_id","HOUSEHOLD",true),relation("event_id","EVENT"),
    relation("introduced_by_contact_id","CONTACT"),date("referred_on",true),choices("status",["NEW","CONTACTED","QUALIFIED","CLOSED","DECLINED"]),text("next_action",false,1000),
  ]},
};

export function businessFieldsSchema(resource: BusinessResource) {
  const shape: Record<string,z.ZodType> = {};
  for(const field of businessConfig[resource].fields){
    if(field.kind==="enum")shape[field.key]=z.enum(field.options as [string,...string[]]);
    else if(field.kind==="multi")shape[field.key]=z.array(z.enum(field.options as [string,...string[]])).max(field.options!.length).refine(values=>new Set(values).size===values.length);
    else if(field.kind==="number"){
      let schema=z.number().finite().min(field.min??0).max(field.max!);if(field.integer)schema=schema.int();
      if(field.key==="budget_min"||field.key==="budget_max")schema=schema.multipleOf(0.01);
      shape[field.key]=field.required?schema:schema.nullable();
    }else if(field.kind==="date")shape[field.key]=field.required?z.iso.date():z.iso.date().nullable();
    else if(field.kind==="relation")shape[field.key]=field.required?z.uuid():field.key==="application_id"?z.uuid().nullable().optional():["campaign_id","product_id","cohort_id"].includes(field.key)?z.uuid().nullable().default(null):z.uuid().nullable();
    else shape[field.key]=z.string().trim().min(field.required?1:0).max(field.max!);
  }
  if(resource==="organizations"){for(const key of commercialFields)shape[key]=commercialProfileSchema.shape[key].optional();}
  if(resource==="organizations"||resource==="needs")shape.id=z.uuid();
  return z.object(shape).strict().superRefine((value,ctx)=>{
    const issue=(key:string)=>ctx.addIssue({code:"custom",path:[key],message:"BUSINESS_FIELD_INVALID"});
    if(resource==="organizations"){const complete=Object.fromEntries(commercialFields.map(k=>[k,value[k]??(k.endsWith("markdown")?"":null)]));const parsed=commercialProfileSchema.safeParse(complete);if(!parsed.success)for(const error of parsed.error.issues)issue(String(error.path[0]));}
    if(resource==="applications"&&["DONE","WAIVED"].includes(String(value.status))&&!String(value.next_action).trim())issue("next_action");
    if(resource==="needs"&&value.budget_min!==null&&value.budget_max!==null&&Number(value.budget_min)>Number(value.budget_max))issue("budget_max");
    if(resource==="events"){
      if(value.cohort_id&&!value.product_id)issue("cohort_id");
      if(String(value.ends_on)<String(value.starts_on))issue("ends_on");
      if(value.capacity!==null&&value.attendee_count!==null&&Number(value.attendee_count)>Number(value.capacity))issue("attendee_count");
      if(value.partner_organization_id===value.organization_id)issue("partner_organization_id");
    }
    if(resource==="pathways"){
      if(value.application_deadline&&value.intake_date&&String(value.application_deadline)>String(value.intake_date))issue("application_deadline");
      const score=value.language_score;
      if(score!==null&&(value.language_test==="NONE"||Number(score)>({IELTS:9,TOEFL:120,DUOLINGO:160} as Record<string,number>)[String(value.language_test)]))issue("language_score");
    }
  });
}
export const businessSaveSchema = z.object({resource:z.enum(businessResources),id:z.uuid(),expectedRevision:z.number().int().positive().nullable(),data:z.record(z.string(),z.unknown())}).strict().superRefine((input,ctx)=>{
  const parsed=businessFieldsSchema(input.resource).safeParse(input.data);
  if(!parsed.success)for(const issue of parsed.error.issues)ctx.addIssue({code:"custom",path:["data",...issue.path],message:issue.message});
  if((input.resource==="organizations"||input.resource==="needs")&&input.data.id!==input.id)ctx.addIssue({code:"custom",path:["id"],message:"SUBJECT_ID_MISMATCH"});
}).transform(input=>({...input,data:businessFieldsSchema(input.resource).parse(input.data)}));
export function businessContextFilters(resource:BusinessResource,context?:BusinessContext):Record<string,string>{
  if(!context)return {};
  if(resource==="organizations"&&context.type==="ORGANIZATION"||resource==="needs"&&context.type==="HOUSEHOLD")return{id:`eq.${context.id}`};
  if(resource==="participations"&&context.type==="HOUSEHOLD")return{household_id:`eq.${context.id}`};
  if(resource==="applications"&&context.type==="STUDENT")return{student_id:`eq.${context.id}`};
  if(resource==="pathways"&&context.type==="STUDENT")return{student_id:`eq.${context.id}`};
  if(resource==="events"&&context.type==="ORGANIZATION")return{or:`(organization_id.eq.${context.id},partner_organization_id.eq.${context.id})`};
  if(resource==="referrals"&&context.type==="ORGANIZATION")return{source_organization_id:`eq.${context.id}`};
  if(resource==="referrals"&&context.type==="HOUSEHOLD")return{household_id:`eq.${context.id}`};
  // Unsupported combinations must never silently widen a contextual read.
  throw new Error("BUSINESS_CONTEXT_INVALID");
}
export function businessResourcesFor(context?:BusinessContext):BusinessResource[]{
  if(!context)return [...businessResources];
  return context.type==="ORGANIZATION"?["organizations","events","referrals"]:context.type==="HOUSEHOLD"?["needs","referrals","participations"]:["pathways","applications"];
}
export function businessWarnings(resource:BusinessResource,row:Record<string,unknown>,today:string):string[]{
  const result:string[]=[];
  if(resource==="applications"&&!["DONE","WAIVED"].includes(String(row.status))&&row.due_on&&String(row.due_on)<today)result.push("taskOverdue");
  if(resource==="organizations"&&!(row.roles as string[]|undefined)?.length)result.push("rolesMissing");
  if(resource==="needs"){
    if(!(row.services as string[]|undefined)?.length)result.push("servicesMissing");
    if(row.budget_min==null&&row.budget_max==null)result.push("budgetMissing");
    if(!row.target_intake)result.push("intakeMissing");
  }
  if(resource==="pathways"){
    if(!row.intake_date)result.push("intakeMissing");
    if(row.application_deadline&&String(row.application_deadline)<today&&["EXPLORING","ASSESSING","PREPARING"].includes(String(row.stage)))result.push("deadlinePassed");
    if(!row.target_organization_id&&!row.target_region)result.push("destinationMissing");
  }
  if(resource==="organizations"&&row.agreement_expires_on&&String(row.agreement_expires_on)<today&&row.partnership_stage==="ACTIVE")result.push("agreementExpired");
  if(resource==="events"&&row.ends_on&&String(row.ends_on)<today&&row.status==="CONFIRMED")result.push("eventNeedsReview");
  const terminal=[row.stage,row.status,row.partnership_stage,row.decision_stage].some(value=>["CLOSED","DECLINED","CANCELLED","COMPLETED","ENDED","ENROLLED","DONE","WAIVED"].includes(String(value)));
  if(!terminal&&!row.next_action)result.push("nextActionMissing");
  return result;
}
