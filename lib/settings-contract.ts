import {z} from "zod";
import {ApiClientError} from "./api-client";
import {normalizeDateInput} from "./date-input";
import {dateTimePartsFor,SUPPORTED_TIMEZONES,type SupportedTimezone} from "./timezone";

export const notificationChannelsSchema=z.object({email:z.boolean(),inApp:z.boolean()});
export const notificationPreferencesSchema=z.object({tasks:notificationChannelsSchema,relationship:notificationChannelsSchema,sales:notificationChannelsSchema,security:notificationChannelsSchema.refine(value=>value.email||value.inApp,{message:"SECURITY_NOTIFICATION_REQUIRED"})});
export const quietTimeSchema=z.string().transform((value,context)=>{
 const normalized=normalizeDateInput(value,"time");
 if(!normalized||!/^\d{2}:\d{2}(?::\d{2})?$/.test(normalized)){context.addIssue({code:"custom",message:"INVALID_QUIET_HOURS"});return z.NEVER;}
 return normalized.length===5?`${normalized}:00`:normalized;
});
export const quietHoursSchema=z.object({quietHoursStart:quietTimeSchema.nullable(),quietHoursEnd:quietTimeSchema.nullable()}).refine(value=>(value.quietHoursStart===null)===(value.quietHoursEnd===null)&&(!value.quietHoursStart||value.quietHoursStart!==value.quietHoursEnd),{message:"INVALID_QUIET_HOURS",path:["quietHours"]});
export const notificationSettingsSchema=quietHoursSchema.safeExtend({section:z.literal("notifications"),notifications:notificationPreferencesSchema});
export const settingsReadSchema=z.object({settings:z.object({username:z.string(),displayNameZh:z.string(),displayNameEn:z.string(),honorific:z.string(),bio:z.string(),avatarPath:z.string().nullable(),locale:z.enum(["zh-CN","en"]),timezone:z.enum(SUPPORTED_TIMEZONES),dateFormat:z.enum(["yyyy-MM-dd","dd/MM/yyyy","MM/dd/yyyy"]),quietHoursStart:quietTimeSchema.nullable(),quietHoursEnd:quietTimeSchema.nullable(),notifications:notificationPreferencesSchema}),email:z.email()});
const timestamp=z.iso.datetime({offset:true});
export const trustedDevicesSchema=z.object({devices:z.array(z.object({id:z.uuid(),label:z.string(),createdAt:timestamp,lastUsedAt:timestamp,expiresAt:timestamp,current:z.boolean()}))});
export type TrustedDeviceView=z.infer<typeof trustedDevicesSchema>["devices"][number];
export const sessionRevocationSchema=z.object({ok:z.boolean(),sessionsRevoked:z.boolean(),trustedDevicesRevoked:z.boolean()}).refine(value=>value.ok===(value.sessionsRevoked&&value.trustedDevicesRevoked));
export const accountSaveSchema=z.object({ok:z.literal(true),preferencesSaved:z.literal(true),emailVerification:z.enum(["NOT_REQUESTED","SENT","UNCONFIRMED"])});
export const mfaReadSchema=z.object({factors:z.array(z.object({id:z.uuid(),status:z.enum(["verified","unverified"])})),recoveryCodesRemaining:z.number().int().nonnegative().nullable()});

export function requireConfirmedPreferences(available:boolean){if(!available)throw new ApiClientError("USER_PREFERENCES_UNAVAILABLE",400);}

export function preferencePreview(timezone:SupportedTimezone,dateFormat:string,instant=new Date()){
 const parts=dateTimePartsFor(instant,timezone);
 const date=dateFormat==="dd/MM/yyyy"?`${parts.day}/${parts.month}/${parts.year}`:dateFormat==="MM/dd/yyyy"?`${parts.month}/${parts.day}/${parts.year}`:`${parts.year}-${parts.month}-${parts.day}`;
 return `${date} ${parts.hour}:${parts.minute}`;
}
