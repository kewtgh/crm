import {zhCN} from './i18n/locales/zh-CN';
import {en} from './i18n/locales/en';
export function v2FieldLabel(key:string,locale:"zh-CN"|"en"):string{
 const messages=locale==="en"?en:zhCN;
 const custom:Record<string,[string,string]>={operation:["操作","Operation"],targetReference:["更新目标引用","Update target reference"],shortName:["简称","Short name"],organizationType:["机构类型","Organization type"],contactType:["联系人类型","Contact type"],contactStatus:["联系进度","Contact status"],communicationLevel:["沟通层级","Communication level"],notesMarkdown:["联系备注","Contact notes"],acquisitionSource:["来源","Acquisition source"],decisionRole:["决策角色","Decision role"],tags:["标签","Tags"],nextFollowUpAt:["下次跟进时间","Next follow-up time"],ownerId:["负责人授权引用","Authorized owner reference"],organizationId:["机构关联引用（仅创建）","Organization reference (CREATE only)"],wechatId:["微信号（仅更新）","WeChat ID (UPDATE only)"],status:["业务记录状态（仅更新）","Record status (UPDATE only)"]};
 if(custom[key])return custom[key][locale==="en"?1:0];
 return messages[key.startsWith("profile.")?`business.field.${key.slice(8)}`:`imports.field.${key}`]??messages["closure.unknownField"];
}
