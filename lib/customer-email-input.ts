import { z } from "zod";
const templateText=(max:number)=>z.string().trim().max(max).refine(text=>!/[\u0000]/.test(text)&&!Array.from(text.matchAll(/\{\{([^}]+)\}\}/g)).some(match=>!["name","owner"].includes(match[1].trim())),"INVALID_TEMPLATE_VARIABLE");
const subjectText=z.string().refine(text=>!/[\r\n]/.test(text)).pipe(templateText(180)).refine(text=>text===""||text.length>=2);
export const customEmailSchema=z.object({
  subjectZh:subjectText,subjectEn:subjectText,
  bodyZh:templateText(10000),bodyEn:templateText(10000),purpose:z.enum(["SERVICE","MARKETING"]),
}).strict().refine(input=>(!!input.subjectZh&&!!input.bodyZh)||(!!input.subjectEn&&!!input.bodyEn),"TEMPLATE_LANGUAGE_REQUIRED").refine(input=>!!input.subjectZh===!!input.bodyZh&&!!input.subjectEn===!!input.bodyEn,"TEMPLATE_LANGUAGE_PAIR_REQUIRED");
export const savedEmailSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive().nullable(),name:z.string().trim().min(1).max(80),content:customEmailSchema,visibility:z.enum(["PERSONAL","WORKSPACE"]).default("PERSONAL")}).strict();
export const archiveEmailSchema=z.object({operation:z.literal("archive"),id:z.uuid(),expectedRevision:z.number().int().positive()}).strict();
