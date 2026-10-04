import {databaseJson} from "./db/gateway";
import type {ContactIntelligence,ChannelSave,intelligenceDataSchema} from "./channel-commercial-input";
import type {z} from "zod";
export function listContactIntelligence(organizationId:string,adapter=databaseJson){return adapter<ContactIntelligence[]>(`/db/table/organization_contact_intelligence_records?${new URLSearchParams({organization_id:`eq.${organizationId}`,order:"updated_at.desc,id.asc",limit:"100"})}`);}
export function saveContactIntelligence(input:ChannelSave<z.infer<typeof intelligenceDataSchema>>,adapter=databaseJson){return adapter<ContactIntelligence>("/db/rpc/save_organization_contact_intelligence",{method:"POST",body:JSON.stringify({record_id:input.id,expected_revision:input.expectedRevision,data:input.data,p_request_key:input.requestKey})});}
