export async function milestonePrivacyRecords(requestAll,workspaceId,enrollmentIds){
 if(!enrollmentIds.length)return{milestones:[],history:[]};const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(workspaceId)||enrollmentIds.some(id=>!uuid.test(id)))throw new Error("Invalid milestone privacy scope");
 const milestones=await requestAll(`/db/table/admission_milestones?workspace_id=eq.${workspaceId}&enrollment_id=in.(${enrollmentIds.join(",")})&order=created_at,id`);
 if(milestones.some(row=>!uuid.test(row.id)||row.workspace_id!==workspaceId||!enrollmentIds.includes(row.enrollment_id)))throw new Error("Milestone privacy scope mismatch");
 const ids=milestones.map(row=>row.id),history=ids.length?await requestAll(`/db/table/admission_milestone_status_history?workspace_id=eq.${workspaceId}&milestone_id=in.(${ids.join(",")})&order=changed_at,id`):[];
 if(history.some(row=>row.workspace_id!==workspaceId||!ids.includes(row.milestone_id)))throw new Error("Milestone privacy scope mismatch");return{milestones,history};
}
