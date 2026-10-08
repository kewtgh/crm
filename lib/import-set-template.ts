import {localizedImportHeader} from "./import-localized-headers";
import writeXlsxFile,{type SheetData} from 'write-excel-file/node';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {setHeaders,isEntity,relationFields,entityKind,type SetResource} from './import-set-contract';
import {v2Guide,v2Example,v2EnumLabel} from './import-v2-template';
import {v2Fields,v2EnumValues} from './import-v2';
import {relationLabels} from './import-set-labels';
export function setExample(resource:SetResource):Record<string,string>{
 const row=Object.fromEntries(setHeaders(resource).map(k=>[k,'']));row.operation='CREATE';
 if(isEntity(resource)){Object.assign(row,resource==='STUDENTS'?{personId:'@contact:contact-1',currentGrade:'Grade 8',academicYear:'2026-2027'}:v2Example(resource),{alias:'@'+entityKind[resource].toLowerCase()+':'+entityKind[resource].toLowerCase()+'-1'});return row;}
 for(const f of relationFields[resource]){if(f.type==='reference')row[f.key]='@'+f.kind!.toLowerCase()+':'+f.kind!.toLowerCase()+'-1';else if(f.default!==undefined&&f.default!==null)row[f.key]=String(f.default);else if(f.values)row[f.key]=f.values[0];}
 if(resource==='STUDENT_GUARDIANS')row.legalAuthority='false';
 return row;
}
export function setGuide(resource:SetResource):string[][]{
 const header=['Field Key','中文名称','English Label','Required on CREATE','Allowed on UPDATE','Type','Allowed Values / Format','Sensitive','Blank Behavior','Reference / Clear Semantics','Example'];
 if(isEntity(resource)){
  const guide=resource==='STUDENTS'?v2Fields(resource).map(f=>[f.key,f.key,f.key,f.required,String(f.update),f.type,f.validation,f.sensitive?'Sensitive':'NO','UPDATE blank = NO_CHANGE','Domain contract',setExample(resource)[f.key]||'']):v2Guide(resource).slice(1);
  const alias=['alias','Set 内别名','Set-local alias','Optional','YES','protocol','@'+entityKind[resource].toLowerCase()+':lower-case-key','Optional','Blank = no alias','Only this Import Set; never a business ID',setExample(resource).alias];
  const controls=guide.filter(r=>['operation','targetReference'].includes(r[0]));
  if(resource==='STUDENTS')controls.push(['operation','操作','Operation','CREATE default','YES','protocol','CREATE / UPDATE / SKIP','NO','CREATE default','No MERGE','CREATE'],['targetReference','目标引用','Target reference','UPDATE only','YES','reference','selected token / typed alias','NO','Blank invalid on UPDATE','Same Set only','']);
  return [header,...controls,alias,...guide.filter(r=>!['operation','targetReference'].includes(r[0])).map(r=>{const copy=[...r];if(copy[5]==='reference')copy[9]='Selected ir_ token (24h) or typed @alias in this Set only; no name matching. '+copy[9];return copy;})];
 }
 return [header,['operation','操作','Operation','CREATE default','YES','protocol','CREATE / UPDATE / SKIP','NO','CREATE default','No MERGE or DELETE','CREATE'],...relationFields[resource].map(f=>[f.key,...(relationLabels[f.key]??[f.key,f.key]),f.required?'Required (references required on UPDATE too)':'Optional','YES',f.type,f.values?.join(' | ')??(f.type==='boolean'?'true / false':f.type==='reference'?'selected token / typed alias':'Canonical domain validation'),f.sensitive?'Sensitive; optional unless required':'NO','UPDATE blank = NO_CHANGE; CREATE = declared defaults',f.type==='reference'?'Same Set typed alias or selected ir_ token (24h); never names':'__CLEAR__ not allowed',setExample(resource)[f.key]])];
}
function codes(resource:SetResource,key:string){if(key==='operation')return ['CREATE','UPDATE','SKIP'];return isEntity(resource)?v2EnumValues(resource,v2Fields(resource).find(f=>f.key===key)):relationFields[resource].find(f=>f.key===key)?.values??(relationFields[resource].find(f=>f.key===key)?.type==='boolean'?['true','false']:[]);}
export async function buildSetTemplate(resource:SetResource,kind:'blank'|'example'|'guide',format:'csv'|'xlsx',locale?:'zh-CN'|'en'){
 const headers=setHeaders(resource),rows=[headers.map(key=>locale?localizedImportHeader(key,locale):key),...(kind==='example'?[headers.map(k=>setExample(resource)[k])]:[])];
 if(format==='csv'||kind==='guide')return '\uFEFF'+(kind==='guide'?setGuide(resource):rows).map(row=>row.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
 const data=(values:string[][]):SheetData=>values.map((row,i)=>row.map(value=>({value,type:String,wrap:true,...(i===0?{fontWeight:'bold' as const,backgroundColor:'#DCEEF8'}:{})})));
 const enums=[['Field','Code','中文名称','English Label'],...headers.flatMap(k=>codes(resource,k).map(c=>[k,c,v2EnumLabel(c,'zh-CN'),v2EnumLabel(c,'en')]))];
 const buffer=await writeXlsxFile([{sheet:'Data',data:data(rows),stickyRowsCount:1,columns:headers.map(()=>({width:26}))},{sheet:'Guide',data:data(setGuide(resource)),columns:Array.from({length:11},()=>({width:30}))},{sheet:'Enums',data:data(enums)},{sheet:'Metadata',data:data([['resource',resource],['template_version','SET_V1']])}]).toBuffer();
 const entries=unzipSync(buffer);entries['xl/workbook.xml']=strToU8(strFromU8(entries['xl/workbook.xml']).replace(/(<sheet\b[^>]*name="Metadata"[^>]*)(\/>)/,'$1 state="hidden"$2'));
 return Buffer.from(zipSync(entries));
}
