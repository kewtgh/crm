const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function contactIntelligencePrivacyRecords(requestAll,workspaceId,contactId){
 if(!uuid.test(workspaceId)||!uuid.test(contactId))throw Error("Invalid contact intelligence privacy scope");
 const [intelligence,relationships]=await Promise.all([
 requestAll(`/db/table/organization_contact_intelligence?workspace_id=eq.${workspaceId}&contact_id=eq.${contactId}&order=created_at,id`),
 requestAll(`/db/table/organization_contact_relationships?workspace_id=eq.${workspaceId}&or=(source_contact_id.eq.${contactId},target_contact_id.eq.${contactId})&order=created_at,id`)]);
 if(intelligence.some(r=>r.workspace_id!==workspaceId||r.contact_id!==contactId)||relationships.some(r=>r.workspace_id!==workspaceId||r.source_contact_id!==contactId&&r.target_contact_id!==contactId))throw Error("Contact intelligence privacy scope mismatch");
 return{intelligence,relationships};
}
