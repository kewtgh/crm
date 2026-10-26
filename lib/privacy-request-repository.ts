import {databaseJson} from "./db/gateway";
import {privacyCommandSchema,privacyPageSchema,privacyReceiptSchema,privacyViewSchema,type PrivacyCommand,type PrivacyView} from "./privacy-request-contract";
export type {PrivacyRequestRecord} from "./privacy-request-contract";
export async function listPrivacyRequests(input:Partial<PrivacyView>={},request=databaseJson){const view=privacyViewSchema.parse(input);return privacyPageSchema.parse(await request("/db/rpc/list_privacy_requests",{method:"POST",body:JSON.stringify({p_status:view.status,p_type:view.type,p_scope:view.scope,p_due:view.due,p_page:view.page,p_page_size:view.pageSize})}));}
export async function executePrivacyCommand(input:PrivacyCommand,request=databaseJson){const {requestKey,...command}=privacyCommandSchema.parse(input);return privacyReceiptSchema.parse(await request("/db/rpc/privacy_request_command",{method:"POST",body:JSON.stringify({p_command:command,p_request_key:requestKey})}));}
export const createPrivacyRequest=(input:Extract<PrivacyCommand,{operation:"create"}>)=>executePrivacyCommand(input);
export const managePrivacyRequest=(input:Extract<PrivacyCommand,{operation:"manage"}>)=>executePrivacyCommand(input);
