import {localizedImportHeader} from "./import-localized-headers";
import {v2FieldLabel} from './import-v2-labels';
export {v2FieldLabel} from './import-v2-labels';
import writeXlsxFile,{type SheetData} from "write-excel-file/node";
import {unzipSync,zipSync,strFromU8,strToU8} from "fflate";
import {v2Fields,v2Headers,v2EnumValues,clearFields,type V2Resource} from "./import-v2";
import {importExamples} from "./import-template";
import {zhCN} from "./i18n/locales/zh-CN";
import {en} from "./i18n/locales/en";
const xml=(value:string)=>value.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
export function v2EnumLabel(code:string,locale:"zh-CN"|"en"):string{
 const messages=locale==="en"?en:zhCN;
 const keys=[`business.option.${code}`,`contact.type.${code.toLowerCase()}`,`contact.status.${code.toLowerCase()}`,`contact.decisionRole.${code.toLowerCase()}`,`education.contactMethod.${code.toLowerCase()}`,`education.affiliation.${code.toLowerCase()}`,`status.${code.toLowerCase()}`];
 for(const key of keys)if(messages[key])return messages[key];
 const key=Object.keys(messages).find(k=>k.endsWith(`.${code.toLowerCase()}`));
 return key?messages[key]:code;
}
export function v2Example(resource:V2Resource):Record<string,string>{
 const row=Object.fromEntries(v2Headers(resource).map(key=>[key,""]));
 Object.assign(row,{operation:"CREATE",nameZh:"示例客户（请替换）",nameEn:"Example customer (replace)"});
 if(resource==="ORGANIZATIONS")Object.assign(row,{city:"台北",organizationType:"SCHOOL",website:"https://example.test","profile.organization_type":"SCHOOL","profile.roles":"SCHOOL_ENTRY","profile.partnership_stage":"PROSPECT"});
 if(resource==="HOUSEHOLDS")Object.assign(row,{annualIncomeAmount:"100000000.01",incomeCurrency:"CNY","profile.services":"STUDY_TOUR","profile.budget_min":"20000.01","profile.budget_max":"30000.02","profile.budget_currency":"CNY","profile.decision_stage":"DISCOVERY"});
 if(resource==="CONTACTS")Object.assign(row,{email:"replace@example.test",phone:"+886 2 0000 0000",contactType:"CONTACT",contactStatus:"NEW",communicationLevel:"1",preferredContactMethod:"EMAIL",decisionRole:"UNKNOWN",tags:"示例,Example"});
 return row;
}
export function v2Guide(resource:V2Resource):string[][]{
 const rows=[["Field Key","中文名称","English Label","Required on CREATE","Allowed on UPDATE","Type","Allowed Values / Format","Sensitive","Blank Behavior","Reference / Clear Semantics","Example"]];
 for(const key of v2Headers(resource)){
  const field=v2Fields(resource).find(f=>f.key===key);
  rows.push([key,v2FieldLabel(key,"zh-CN"),v2FieldLabel(key,"en"),field?.required??(key==="operation"?"CREATE default":"UPDATE only"),field?.update?"YES":key==="targetReference"||key==="operation"?"YES":"NO",field?.type??"protocol",field?v2EnumValues(resource,field).join(" | ")||field.validation:"CREATE / UPDATE / SKIP; no MERGE",field?.sensitive?"Sensitive; see Required rule":"NO","UPDATE blank = NO_CHANGE; CREATE blank = domain NULL/default",(field?.scope==='PROFILE'?"UPDATE requires existing profile. ":"")+(field?.type==="reference"||key==="targetReference"?"Select authorized reference in Imports; paste ir_ token; never name/UUID. ":"")+(clearFields.has(key)?"UPDATE __CLEAR__ allowed; domain null/empty representation":"__CLEAR__ forbidden"),v2Example(resource)[key]||importExamples[key]||""]);
 }
 return rows;
}
export function buildV2Csv(resource:V2Resource,kind:"blank"|"example"|"guide",locale?:"zh-CN"|"en"):string{
 const rows=kind==="guide"?v2Guide(resource):[v2Headers(resource).map(key=>locale?localizedImportHeader(key,locale):key),...(kind==="example"?[v2Headers(resource).map(key=>v2Example(resource)[key])]:[])];
 return "\uFEFF"+rows.map(row=>row.map(value=>`"${value.replaceAll('"','""')}"`).join(",")).join("\r\n")+"\r\n";
}
function column(index:number){let s="";for(let n=index+1;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
export async function buildV2Xlsx(resource:V2Resource,kind:"blank"|"example",locale?:"zh-CN"|"en"):Promise<Buffer>{
 const headers=v2Headers(resource),guide=v2Guide(resource);
 const enums=[["Field","Code","中文名称","English Label"],...v2Fields(resource).flatMap(field=>v2EnumValues(resource,field).map(code=>[field.key,code,v2EnumLabel(code,"zh-CN"),v2EnumLabel(code,"en")]))];
 const data=(rows:string[][]):SheetData=>rows.map((r,i)=>r.map(value=>({value,type:String,...(i===0?{fontWeight:"bold" as const,backgroundColor:"#DCEEF8"}:{}),wrap:true})));
 const buf=await writeXlsxFile([{sheet:"Data",data:data([headers.map(key=>locale?localizedImportHeader(key,locale):key),...(kind==="example"?[headers.map(key=>v2Example(resource)[key])]:[])]),stickyRowsCount:1,columns:headers.map(()=>({width:26}))},{sheet:"Guide",data:data(guide),columns:guide[0].map(()=>({width:30})),stickyRowsCount:1},{sheet:"Enums",data:data(enums),columns:[{width:30},{width:28},{width:30},{width:30}]},{sheet:"Metadata",data:data([["resource",resource],["template_version","2"]])}]).toBuffer();
 const entries=unzipSync(buf);
 let sheet=strFromU8(entries["xl/worksheets/sheet1.xml"]);
 const validations=headers.flatMap((key,index)=>{
  const codes=key==="operation"?["CREATE","UPDATE","SKIP"]:v2EnumValues(resource,v2Fields(resource).find(f=>f.key===key)!);
  // Very long enum lists use Enums as a guide; server still validates every value.
  if(!codes.length||codes.join(",").length>250)return[];
  return [`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Invalid code" error="Use canonical code" sqref="${column(index)}2:${column(index)}10001"><formula1>&quot;${xml(codes.join(","))}&quot;</formula1></dataValidation>`];
 });
 sheet=sheet.replace("</worksheet>",`<dataValidations count="${validations.length}">${validations.join("")}</dataValidations></worksheet>`);
 entries["xl/worksheets/sheet1.xml"]=strToU8(sheet);
 entries["xl/workbook.xml"]=strToU8(strFromU8(entries["xl/workbook.xml"]).replace(/(<sheet\b[^>]*name="Metadata"[^>]*)(\/>)/,"$1 state=\"hidden\"$2"));
 return Buffer.from(zipSync(entries));
}
