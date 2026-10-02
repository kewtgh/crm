import type { EmailPreview } from "./customer-email-repository";
import type { CustomerEmailTemplate } from "./customer-email-templates";
import type { Locale } from "./i18n/types";

export type EmailBatchPreview = {items:EmailPreview[];hash:string;locale:Locale};
export type EmailBatchResult = {queued:number;failed:number;results:Array<{id:string;queued:boolean;code?:string;threadId?:string}>};
export function customerEmailBatchPayload(operation:"preview"|"queue",ids:string[],template:CustomerEmailTemplate,locale:Locale,requestKey:string,preview:EmailBatchPreview|null) {
  if(operation==="queue"&&!preview)throw new Error("EMAIL_PREVIEW_REQUIRED");
  return {operation,contactIds:[...ids],template,locale:operation==="queue"?preview!.locale:locale,requestKey,...(operation==="queue"?{previewHash:preview!.hash}:{})};
}
