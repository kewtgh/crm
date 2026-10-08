import {localizedImportHeader} from "./import-localized-headers";
import { importFields,importFieldsByResource } from "./import-fields";
export type ImportResource=keyof typeof importFieldsByResource;
export const importExamples:Record<string,string>={
  productCode:"REPLACE_PRODUCT_CODE",cohortCode:"EXAMPLE-FALL-2027",intakeType:"FALL",applicationOpenOn:"2027-01-01",applicationDeadline:"2027-08-01",startOn:"2027-09-01",endOn:"2028-06-01",targetEnrollment:"30",capacity:"40",currency:"CNY",ownerEmail:"replace@example.test",status:"",salesOwnerEmail:"",householdReference:"",opportunityReference:"",enrolledAt:"",completedAt:"",withdrawnAt:"",withdrawalReason:"",
  nameZh:"示例客户（请替换）",nameEn:"Example customer (replace)",email:"replace@example.test",phone:"+886 2 0000 0000",title:"校长 / Principal",
  city:"台北",curriculum:"IB",courseCategories:"语言,科学",affiliationType:"INDEPENDENT",parentOrganizationId:"",website:"https://example.test",foundedYear:"2001",studentCount:"300",facultyCount:"30",campusCount:"1",organizationOverviewMarkdown:"学校背景与教学特色",structureOverviewMarkdown:"教学部、行政部",
  address:"示例地址（请替换）",primaryParentOccupation:"教师",secondaryParentOccupation:"工程师",annualIncomeAmount:"120000.00",incomeCurrency:"CNY",preferredContactMethod:"EMAIL",preferredLanguage:"zh-CN",educationExpectationsMarkdown:"学习目标与期望",familyBackgroundMarkdown:"家庭背景与沟通注意事项",
  personId:"REPLACE_WITH_EXISTING_CONTACT_UUID",householdId:"",studentNumber:"EXAMPLE-001",birthDate:"2015-04-12",currentGrade:"G5",currentClass:"A",academicYear:"2026-2027",interests:"音乐,科学",preferredLearningStyle:"UNSPECIFIED",personalityMarkdown:"学生性格与偏好",learningExpectationsMarkdown:"学习计划",strengthsMarkdown:"擅长的领域",supportNeedsMarkdown:"需要支持的方面",
};
function csv(rows:string[][]){return "\uFEFF"+rows.map(row=>row.map(value=>`"${value.replaceAll('"','""')}"`).join(",")).join("\r\n")+"\r\n";}
export function importFieldRequirement(resource:ImportResource,field:string,zh:boolean){
  if(resource==="COHORTS"&&["productCode","cohortCode"].includes(field)||resource==="ENROLLMENTS"&&["studentNumber","cohortCode","ownerEmail"].includes(field))return zh?"必填；仅使用稳定标识":"Required; stable identity only";
  if(resource==="ENROLLMENTS"&&["enrolledAt","completedAt","withdrawnAt","withdrawalReason"].includes(field))return zh?"相应生命周期状态要求时必填":"Required when the selected lifecycle status requires it";
  if(field==="nameZh"||field==="nameEn")return resource==="STUDENTS"?(zh?"学生姓名来自关联客户":"Student names come from the linked contact"):(zh?"中文名或英文名至少一项":"At least one Chinese or English name");
  if(resource==="CONTACTS"&&(field==="email"||field==="phone"))return zh?"邮箱或电话至少一项":"At least one email or phone";
  if(resource==="STUDENTS"&&["personId","currentGrade","academicYear"].includes(field))return zh?"必填":"Required";
  return zh?"可选":"Optional";
}
export function importFieldFormat(field:string,zh:boolean){
  const notes:Record<string,[string,string]>={
    productCode:["现有产品代码；不按名称匹配或创建产品","Existing product code; never match by name or create a product"],
    cohortCode:["同工作区批次唯一代码","Unique cohort code in this workspace"],studentNumber:["现有学生编号；不存在或不唯一时行失败；不按姓名匹配","Existing student number; missing or ambiguous identity fails; never match by name"],
    ownerEmail:["同工作区有效成员邮箱","Active workspace member email"],salesOwnerEmail:["同工作区有效成员邮箱；可留空","Active workspace member email or blank"],
    householdReference:["现有家庭 UUID；可留空；不按名称匹配","Existing household UUID or blank; no name matching"],opportunityReference:["现有机会 UUID；可留空","Existing opportunity UUID or blank"],
    intakeType:["SPRING / SUMMER / FALL / WINTER / CUSTOM","SPRING / SUMMER / FALL / WINTER / CUSTOM"],
    personId:["现有客户 UUID；从客户档案复制；示例占位符必须替换","Existing contact UUID; copy from customer record; replace example placeholder"],
    householdId:["现有家庭 UUID；可留空","Existing household UUID or blank"],parentOrganizationId:["同工作区的上级机构 UUID；可留空","Parent institution UUID in this workspace or blank"],
    email:["合法邮箱地址","Valid email address"],phone:["含国家/地区区号的电话文本","Phone text including country/area code"],
    courseCategories:["逗号分隔的条目；整个 CSV 单元格使用引号","Comma-separated entries; quote the CSV cell"],interests:["逗号分隔；整个 CSV 单元格使用引号","Comma-separated entries; quote the CSV cell"],
    birthDate:["YYYY-MM-DD，例如 2015-04-12","YYYY-MM-DD, e.g. 2015-04-12"],academicYear:["YYYY-YYYY，例如 2026-2027","YYYY-YYYY, e.g. 2026-2027"],
    incomeCurrency:["三位币种代码，例如 CNY、USD、TWD","Three-letter currency code: CNY, USD, TWD"],annualIncomeAmount:["非负数字，小数点分隔；不含货币符号或千位逗号","Nonnegative decimal; no currency symbol or grouping separators"],
    affiliationType:["INDEPENDENT / EDUCATION_GROUP / GOVERNMENT / UNIVERSITY / RELIGIOUS / OTHER","INDEPENDENT / EDUCATION_GROUP / GOVERNMENT / UNIVERSITY / RELIGIOUS / OTHER"],
    preferredContactMethod:["EMAIL / PHONE / SMS / WECHAT / WHATSAPP / IN_PERSON","EMAIL / PHONE / SMS / WECHAT / WHATSAPP / IN_PERSON"],preferredLearningStyle:["UNSPECIFIED / VISUAL / AUDITORY / READ_WRITE / KINESTHETIC / MIXED","UNSPECIFIED / VISUAL / AUDITORY / READ_WRITE / KINESTHETIC / MIXED"],
    preferredLanguage:["语言代码，例如 zh-CN、en","Language code, e.g. zh-CN, en"],website:["完整 HTTPS 网址","Full HTTPS URL"],foundedYear:["四位年份","Four-digit year"],
  };
  if(notes[field])return notes[field][zh?0:1];
  if(["applicationOpenOn","applicationDeadline","startOn","endOn"].includes(field))return "YYYY-MM-DD";
  if(["enrolledAt","completedAt","withdrawnAt"].includes(field))return zh?"ISO 8601，含时区，例如 2027-09-01T09:00:00+08:00":"ISO 8601 with timezone, e.g. 2027-09-01T09:00:00+08:00";
  if(["targetEnrollment","capacity"].includes(field))return zh?"非负整数；目标不得超过容量":"Nonnegative integer; target must not exceed capacity";
  if(["studentCount","facultyCount","campusCount"].includes(field))return zh?"非负整数":"Nonnegative integer";
  if(field.endsWith("Markdown"))return zh?"Markdown 文本；多行 CSV 单元格使用引号":"Markdown text; quote multiline CSV cells";
  return zh?"文本；UTF-8 编码":"Text; UTF-8 encoding";
}
export function buildImportTemplate(resource:ImportResource,kind:"blank"|"example"|"guide",locale:"zh-CN"|"en",label:(key:string)=>string,localized=false){
  const fields=[...importFields(resource)],zh=locale==="zh-CN";
  if(kind==="guide")return csv([["field",zh?"字段":"label",zh?"必填要求":"requirement",zh?"格式":"format",zh?"示例":"example"],...fields.map(field=>[field,label(`imports.field.${field}`),importFieldRequirement(resource,field,zh),importFieldFormat(field,zh),importExamples[field]??""])]);
  const headers=fields.map(field=>localized?localizedImportHeader(field,locale):field);
  return csv(kind==="example"?[headers,fields.map(field=>importExamples[field]??"")]:[headers]);
}
