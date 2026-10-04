// Customer Contact removal does not erase staff assignment or Organization history.
// Household Lead context is exported through explicit existing membership identities.
export async function leadPoolPrivacyRecords(request,workspaceId,householdIds){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!uuid.test(workspaceId)||!householdIds.every(id=>uuid.test(id)))throw Error('Invalid Lead privacy scope');
 if(!householdIds.length)return{leads:[],assignments:[]};
 const leads=await request(`/db/table/leads?workspace_id=eq.${workspaceId}&subject_type=eq.HOUSEHOLD&household_id=in.(${householdIds.join(',')})&order=created_at`);
 if(leads.some(l=>l.workspace_id!==workspaceId||l.subject_type!=='HOUSEHOLD'||!householdIds.includes(l.household_id)))throw Error('Lead privacy scope mismatch');
 const ids=leads.map(l=>l.id);if(!ids.every(id=>uuid.test(id)))throw Error('Invalid Lead privacy identity');
 const assignments=ids.length?await request(`/db/table/lead_assignment_history?workspace_id=eq.${workspaceId}&lead_id=in.(${ids.join(',')})&order=changed_at`):[];
 if(assignments.some(h=>h.workspace_id!==workspaceId||!ids.includes(h.lead_id)))throw Error('Lead assignment privacy scope mismatch');
 return{leads,assignments};
}
