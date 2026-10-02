import type { EmailPreview } from "./customer-email-repository";
import type { CustomerEmailTemplate,CustomEmailContent } from "./customer-email-templates";
import type { Locale } from "./i18n/types";

export type EmailBatchPreview = {items:EmailPreview[];hash:string;locale:Locale;template?:CustomerEmailTemplate;customTemplate?:CustomEmailContent};
export type EmailBatchResult = {queued:number;failed:number;results:Array<{id:string;queued:boolean;code?:string;threadId?:string}>};
// Capture once before any write. A lost HTTP response must not create a new batch identity.
export function freezeCustomerEmailBatch(ids:string[],template:CustomerEmailTemplate,locale:Locale,requestKey:string,preview:EmailBatchPreview,customTemplate?:CustomEmailContent){
  return structuredClone(customerEmailBatchPayload("queue",ids,template,locale,requestKey,preview,customTemplate));
}
export function customerEmailBatchPayload(operation:"preview"|"queue",ids:string[],template:CustomerEmailTemplate,locale:Locale,requestKey:string,preview:EmailBatchPreview|null,customTemplate?:CustomEmailContent) {
  if(operation==="queue"&&!preview)throw new Error("EMAIL_PREVIEW_REQUIRED");
  const content=operation==="queue"?preview!.customTemplate:customTemplate;
  return {operation,contactIds:[...ids],template:operation==="queue"?preview!.template??template:template,locale:operation==="queue"?preview!.locale:locale,requestKey,...(content?{customTemplate:content}:{}),...(operation==="queue"?{previewHash:preview!.hash}:{})};
}
