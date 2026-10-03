// Operational relation rows are exported before identity erasure. Contract finance remains separate.
export async function contractEnrollmentPrivacyRecords(requestAll,workspaceId,enrollmentIds){
 if(!enrollmentIds.length)return [];
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(workspaceId)||enrollmentIds.some(id=>!uuid.test(id)))throw Error("Invalid contract enrollment privacy scope");
 const rows=await requestAll(`/db/table/contract_enrollment_links?workspace_id=eq.${workspaceId}&enrollment_id=in.(${enrollmentIds.join(',')})&order=created_at,id`);
 if(rows.some(row=>row.workspace_id!==workspaceId||!enrollmentIds.includes(row.enrollment_id)))throw Error("Contract enrollment privacy scope mismatch");return rows;
}
