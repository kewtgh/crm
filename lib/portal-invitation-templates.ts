import { z } from "zod";
import type { EmailTemplateVisibility } from "./customer-email-templates";
const variables=["name","family","owner","portal_url","expires"];
const text=(max:number)=>z.string().trim().max(max).refine(value=>!value.includes("\u0000")&&!/\/portal\/invite\/[A-Za-z0-9_-]{20,}/.test(value)&&!Array.from(value.matchAll(/\{\{([^}]+)\}\}/g)).some(match=>!variables.includes(match[1].trim())),"INVALID_TEMPLATE_VARIABLE");
const subject=text(180).refine(value=>!/[\r\n]/.test(value)&&(value===""||value.length>=2));
export const portalTemplateContentSchema=z.object({subjectZh:subject,subjectEn:subject,bodyZh:text(10000),bodyEn:text(10000),purpose:z.literal("SERVICE"),validityDays:z.number().int().min(1).max(30)}).strict()
  .refine(value=>(!!value.subjectZh&&!!value.bodyZh)||(!!value.subjectEn&&!!value.bodyEn),"TEMPLATE_LANGUAGE_REQUIRED")
  .refine(value=>!!value.subjectZh===!!value.bodyZh&&!!value.subjectEn===!!value.bodyEn,"TEMPLATE_LANGUAGE_PAIR_REQUIRED")
  .refine(value=>[value.bodyZh,value.bodyEn].every(body=>!body||/\{\{\s*portal_url\s*\}\}/.test(body)),"PORTAL_TEMPLATE_LINK_REQUIRED");
export type PortalTemplateContent=z.infer<typeof portalTemplateContentSchema>;
export type SavedPortalTemplate=PortalTemplateContent&{id:string;name:string;revision:number;visibility:EmailTemplateVisibility};
export const savedPortalTemplateSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive().nullable(),name:z.string().trim().min(1).max(80),visibility:z.enum(["PERSONAL","WORKSPACE"]),content:portalTemplateContentSchema}).strict();
export const PORTAL_INVITATION_PRESETS:Record<"WELCOME"|"UPDATE",PortalTemplateContent>={
  WELCOME:{purpose:"SERVICE",validityDays:7,subjectZh:"家庭自助门户邀请",subjectEn:"Your family portal invitation",bodyZh:"{{name}}，您好！\n\n邀请您访问{{family}}的家庭自助门户，核对家庭和孩子的信息。如需更正，可通过门户提交申请，由工作人员复核。\n\n访问链接：{{portal_url}}\n有效至：{{expires}}\n请勿转发此链接；如非本人，请联系{{owner}}。\n\n{{owner}}",bodyEn:"Hello {{name}},\n\nYou are invited to the family portal for {{family}} to review your family and children's information. Submit corrections for staff review.\n\nSecure link: {{portal_url}}\nExpires: {{expires}}\nDo not forward this link. If this is not for you, contact {{owner}}.\n\n{{owner}}"},
  UPDATE:{purpose:"SERVICE",validityDays:3,subjectZh:"请核对家庭与孩子资料",subjectEn:"Please review your family information",bodyZh:"{{name}}，您好！\n\n请核对{{family}}的家庭与孩子资料，如有变化，请在门户中提交更正申请。\n\n安全链接：{{portal_url}}\n有效至：{{expires}}\n此链接仅供您使用，请勿转发。\n\n对接人：{{owner}}",bodyEn:"Hello {{name}},\n\nPlease review the family and child records for {{family}}, and submit any corrections through the portal.\n\nSecure link: {{portal_url}}\nExpires: {{expires}}\nThis link is for you only. Do not forward it.\n\nYour contact: {{owner}}"},
};
export function renderPortalInvitation(content:PortalTemplateContent,locale:"zh-CN"|"en",values:Record<typeof variables[number],string>){
  const replace=(value:string)=>value.replace(/\{\{\s*(name|family|owner|portal_url|expires)\s*\}\}/g,(_,key:string)=>values[key]);
  const zh=locale==="zh-CN";
  return{subject:replace(zh?content.subjectZh||content.subjectEn:content.subjectEn||content.subjectZh).replace(/[\r\n]+/g," "),body:replace(zh?content.bodyZh||content.bodyEn:content.bodyEn||content.bodyZh)};
}
