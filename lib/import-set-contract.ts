import {z} from 'zod';
import {normalizeV2Row,v2Fields,v2Headers,type ImportIssue} from './import-v2';

export const setTemplateVersion='SET_V1';
export const entityResources=['ORGANIZATIONS','HOUSEHOLDS','CONTACTS','STUDENTS'] as const;
export const relationResources=['ORGANIZATION_CONTACT_ASSOCIATIONS','HOUSEHOLD_MEMBERS','STUDENT_GUARDIANS','ORGANIZATION_CONTACT_INTELLIGENCE','ORGANIZATION_CONTACT_RELATIONSHIPS'] as const;
export const setResources=[...entityResources,...relationResources] as const;
export type SetResource=typeof setResources[number];
export type EntityResource=typeof entityResources[number];
export type RelationResource=typeof relationResources[number];
export type ReferenceKind='ORGANIZATION'|'HOUSEHOLD'|'CONTACT'|'STUDENT'|'STAFF';
export type RelationField={key:string;column:string;type:'reference'|'enum'|'boolean'|'integer'|'text';kind?:ReferenceKind;values?:readonly string[];required?:boolean;default?:string|boolean|null;max?:number;sensitive?:boolean};
export const relationFields:Record<RelationResource,readonly RelationField[]>={
 ORGANIZATION_CONTACT_ASSOCIATIONS:[{key:'organizationReference',column:'organization_id',type:'reference',kind:'ORGANIZATION',required:true},{key:'contactReference',column:'contact_id',type:'reference',kind:'CONTACT',required:true}],
 HOUSEHOLD_MEMBERS:[{key:'householdReference',column:'household_id',type:'reference',kind:'HOUSEHOLD',required:true},{key:'contactReference',column:'contact_id',type:'reference',kind:'CONTACT',required:true},{key:'memberRole',column:'member_role',type:'enum',values:['PARENT','GUARDIAN','STUDENT','PAYER','OTHER'],required:true},{key:'primaryContact',column:'primary_contact',type:'boolean',default:false}],
 STUDENT_GUARDIANS:[{key:'studentReference',column:'student_id',type:'reference',kind:'STUDENT',required:true},{key:'guardianContactReference',column:'guardian_contact_id',type:'reference',kind:'CONTACT',required:true},{key:'relationship',column:'relationship_type',type:'enum',values:['MOTHER','FATHER','GUARDIAN','RELATIVE','OTHER'],required:true},{key:'primaryGuardian',column:'primary_guardian',type:'boolean',default:false},{key:'emergencyContact',column:'emergency_contact',type:'boolean',default:false},{key:'legalAuthority',column:'legal_authority',type:'boolean',required:true,sensitive:true}],
 ORGANIZATION_CONTACT_INTELLIGENCE:[{key:'organizationReference',column:'organization_id',type:'reference',kind:'ORGANIZATION',required:true},{key:'contactReference',column:'contact_id',type:'reference',kind:'CONTACT',required:true},{key:'keyContactStatus',column:'key_contact_status',type:'enum',values:['UNKNOWN','KEY','NON_KEY'],default:'UNKNOWN'},{key:'decisionPowerScore',column:'decision_power_score',type:'integer',max:100},{key:'contributionScore',column:'contribution_score',type:'integer',max:100},{key:'workingStyleMarkdown',column:'working_style_markdown',type:'text',max:10000,sensitive:true},{key:'cooperationNotes',column:'cooperation_notes',type:'text',max:10000,sensitive:true},{key:'potentialNotes',column:'potential_notes',type:'text',max:10000,sensitive:true}],
 ORGANIZATION_CONTACT_RELATIONSHIPS:[{key:'organizationReference',column:'organization_id',type:'reference',kind:'ORGANIZATION',required:true},{key:'sourceContactReference',column:'source_contact_id',type:'reference',kind:'CONTACT',required:true},{key:'targetContactReference',column:'target_contact_id',type:'reference',kind:'CONTACT',required:true},{key:'relationshipType',column:'relationship_type',type:'enum',values:['REPORTS_TO','INFLUENCES','ASSISTANT_TO','PEER','WORKS_WITH','OTHER'],required:true},{key:'note',column:'note',type:'text',max:2000,sensitive:true},{key:'status',column:'status',type:'enum',values:['ACTIVE','INACTIVE'],default:'ACTIVE'}],
};
export const entityKind:Record<EntityResource,ReferenceKind>={ORGANIZATIONS:'ORGANIZATION',HOUSEHOLDS:'HOUSEHOLD',CONTACTS:'CONTACT',STUDENTS:'STUDENT'};
export function isEntity(resource:SetResource):resource is EntityResource{return (entityResources as readonly string[]).includes(resource);}
export function setHeaders(resource:SetResource):string[]{return isEntity(resource)?['operation','targetReference','alias',...v2Headers(resource).slice(2)]:['operation',...relationFields[resource].map(f=>f.key)];}
export function validateSetHeaders(resource:SetResource,headers:readonly string[]){const allowed=setHeaders(resource);if(headers.some(h=>!allowed.includes(h)))throw Error('UNKNOWN_COLUMN');if(new Set(headers).size!==headers.length||allowed.some(h=>!headers.includes(h)))throw Error('TEMPLATE_SCHEMA_INVALID');}
export function parseAlias(value:string,kind?:ReferenceKind){const m=/^@(organization|household|contact|student):([a-z0-9][a-z0-9_-]{0,59})$/.exec(value);if(!m||kind&&m[1]!==kind.toLowerCase())throw Error('INVALID_REFERENCE');return {kind:m[1].toUpperCase() as ReferenceKind,name:m[2],key:value};}
export function validateSetReference(value:string,kind:ReferenceKind){if(value.startsWith('@'))parseAlias(value,kind);else if(!/^ir_[a-f0-9]{64}$/.test(value))throw Error('INVALID_REFERENCE');return value;}
export type SetRow={operation:'CREATE'|'UPDATE'|'SKIP';alias:string;targetReference:string;patch:Record<string,unknown>;profile:Record<string,unknown>;references:Array<{path:string;kind:ReferenceKind;value:string}>;location:{row:number;sheet?:string};errors:ImportIssue[]};
const referenceKind=(key:string):ReferenceKind=>key==='householdId'?'HOUSEHOLD':key==='personId'||key==='profile.primary_contact_id'?'CONTACT':key==='ownerId'?'STAFF':'ORGANIZATION';
export function normalizeSetRow(resource:SetResource,input:Record<string,string>,row:number,sheet?:string):SetRow{
 const result:SetRow={operation:'CREATE',alias:'',targetReference:'',patch:{},profile:{},references:[],location:{row,...(sheet?{sheet}:{})},errors:[]};
 const fail=(code:string,field:string)=>result.errors.push({code,field,column:field,row,...(sheet?{sheet}:{})});
 for(const key of Object.keys(input))if(!setHeaders(resource).includes(key))fail('UNKNOWN_COLUMN',key);
 const operation=input.operation?.trim()||'CREATE';if(!['CREATE','UPDATE','SKIP'].includes(operation))fail('UNSUPPORTED_OPERATION','operation');else result.operation=operation as SetRow['operation'];
 if(isEntity(resource)){
  const compatible={...input};delete compatible.alias;
  result.alias=input.alias?.trim()||'';
  try{if(result.alias)parseAlias(result.alias,entityKind[resource]);}catch{fail('INVALID_ALIAS','alias');}
  for(const field of [{key:'targetReference',kind:entityKind[resource]},...v2Fields(resource).filter(f=>f.type==='reference').map(f=>({key:f.key,kind:referenceKind(f.key)}))]){
   const value=input[field.key]?.trim();if(!value||value==='__CLEAR__')continue;
   try{validateSetReference(value,field.kind);result.references.push({path:field.key,kind:field.kind,value});compatible[field.key]='ir_'+'0'.repeat(64);}catch{fail('INVALID_REFERENCE',field.key);}
  }
  const normalized=normalizeV2Row(resource,compatible,row,sheet);Object.assign(result,{patch:normalized.patch,profile:normalized.profile,targetReference:input.targetReference?.trim()||''});result.errors.push(...normalized.errors);
  for(const ref of result.references){if(ref.path==='targetReference')continue;const target=ref.path.startsWith('profile.')?result.profile:result.patch;target[ref.path.replace(/^profile\./,'')]=ref.value;}
  if(result.operation==='SKIP'&&result.alias&&!result.targetReference)fail('INVALID_REFERENCE','targetReference');
 }else{
  for(const field of relationFields[resource]){
   const value=input[field.key]?.trim();
   if(!value){if(field.type==='reference'||result.operation==='CREATE'&&field.required)fail('REQUIRED',field.key);continue;}
   if(value==='__CLEAR__'){fail('CLEAR_NOT_ALLOWED',field.key);continue;}
   try{
    if(field.type==='reference'){validateSetReference(value,field.kind!);result.references.push({path:field.column,kind:field.kind!,value});result.patch[field.column]=value;}
    else if(field.type==='boolean'){if(value!=='true'&&value!=='false')throw Error('INVALID_BOOLEAN');result.patch[field.column]=value==='true';}
    else if(field.type==='enum'){if(!field.values!.includes(value))throw Error('INVALID_ENUM');result.patch[field.column]=value;}
    else if(field.type==='integer'){if(!/^\d+$/.test(value)||BigInt(value)<BigInt(10)||BigInt(value)>BigInt(field.max!))throw Error('INVALID_INTEGER');result.patch[field.column]=Number(value);}
    else{if(value.length>field.max!)throw Error('INVALID_TEXT');result.patch[field.column]=value;}
   }catch(e){fail(e instanceof Error?e.message:'INVALID_CELL',field.key);}
  }
 }
 return result;
}
export type GraphRow={id:string;resource:SetResource;row:SetRow};
export function dependencyGraph(rows:readonly GraphRow[]){
 const definitions=new Map<string,string>();const dependencies=new Map<string,Set<string>>();
 for(const {id,row} of rows){if(row.alias){if(definitions.has(row.alias))throw Error('ALIAS_CONFLICT');definitions.set(row.alias,id);}dependencies.set(id,new Set());}
 for(const {id,row} of rows)for(const ref of row.references)if(ref.value.startsWith('@')){const provider=definitions.get(ref.value);if(!provider)throw Error('INVALID_REFERENCE');dependencies.get(id)!.add(provider);}
 const order:string[]=[],pending=new Set(rows.map(r=>r.id));
 while(pending.size){const ready=[...pending].filter(id=>[...dependencies.get(id)!].every(dep=>!pending.has(dep)));if(!ready.length)throw Error('DEPENDENCY_CYCLE');for(const id of ready){pending.delete(id);order.push(id);}}
 return {order,edges:[...dependencies].flatMap(([row,deps])=>[...deps].map(parent=>({row,parent})))};
}
export const setFileSchema=z.object({resource:z.enum(setResources),templateVersion:z.literal('SET_V1'),filename:z.string().min(1).max(180),contentHash:z.string().regex(/^[a-f0-9]{64}$/),headers:z.array(z.string()).max(100),rows:z.array(z.record(z.string(),z.string().max(20000))).min(1).max(1000),rowLocations:z.array(z.number().int().positive()).max(1000),sheet:z.string().max(80).optional()}).strict();
export const setActionSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('createSet'),name:z.string().trim().min(1).max(80),requestKey:z.string().min(8).max(120)}).strict(),
 z.object({operation:z.literal('addSetFile'),setId:z.uuid(),expectedRevision:z.number().int().positive(),requestKey:z.string().min(8).max(120),file:setFileSchema}).strict(),
 z.object({operation:z.enum(['preflightSet','executeSet','rollbackSet']),setId:z.uuid(),expectedRevision:z.number().int().positive(),limit:z.number().int().min(1).max(100).default(50)}).strict(),
 z.object({operation:z.literal('repairSetRow'),setId:z.uuid(),rowId:z.uuid(),expectedRevision:z.number().int().positive(),rowRevision:z.number().int().positive(),replacement:z.record(z.string(),z.string().max(20000))}).strict(),
]);
