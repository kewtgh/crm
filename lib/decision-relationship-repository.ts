import {databaseJson} from "./db/gateway";
import type {ContactRelationship,ChannelSave,relationshipDataSchema} from "./channel-commercial-input";
import type {z} from "zod";
export function listDecisionRelationships(organizationId:string,adapter=databaseJson){return adapter<ContactRelationship[]>(`/db/table/organization_contact_relationship_records?${new URLSearchParams({organization_id:`eq.${organizationId}`,order:"status.asc,created_at.asc,id.asc",limit:"100"})}`);}
export function saveDecisionRelationship(input:ChannelSave<z.infer<typeof relationshipDataSchema>>,adapter=databaseJson){return adapter<ContactRelationship>("/db/rpc/save_organization_contact_relationship",{method:"POST",body:JSON.stringify({record_id:input.id,expected_revision:input.expectedRevision,data:input.data,p_request_key:input.requestKey})});}
