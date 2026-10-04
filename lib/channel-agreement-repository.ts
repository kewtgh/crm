import {databaseJson} from "./db/gateway";
import type {z} from "zod";
import type {AgreementCollection,AgreementVersion,agreementSaveSchema,agreementTransitionSchema} from "./commission-input";
export function getChannelAgreements(organizationId:string,adapter=databaseJson){return adapter<AgreementCollection>("/db/rpc/get_channel_agreements",{method:"POST",body:JSON.stringify({target_organization:organizationId})});}
export function saveChannelAgreement(input:z.infer<typeof agreementSaveSchema>,adapter=databaseJson){return adapter<AgreementVersion>("/db/rpc/save_channel_agreement",{method:"POST",body:JSON.stringify({target_agreement:input.id,target_version:input.versionId,expected_revision:input.expectedRevision,data:input.data,p_request_key:input.requestKey})});}
export function changeChannelAgreementStatus(versionId:string,input:z.infer<typeof agreementTransitionSchema>,adapter=databaseJson){return adapter<AgreementVersion>("/db/rpc/change_channel_agreement_status",{method:"POST",body:JSON.stringify({target_version:versionId,expected_revision:input.expectedRevision,next_status:input.status,reason:input.reason,p_request_key:input.requestKey})});}
