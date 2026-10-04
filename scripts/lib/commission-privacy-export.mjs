// The existing authorized privacy worker exports only entries with an explicit personal reference.
// Shared Organization agreements and settlements remain retained commercial records.
export async function commissionPrivacyRecords(request,workspaceId,enrollmentIds){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(workspaceId)||!enrollmentIds.every(id=>uuid.test(id)))throw Error('Invalid commission privacy scope');
 if(!enrollmentIds.length)return [];
 const entries=await request(`/db/table/commission_accruals?workspace_id=eq.${workspaceId}&enrollment_id=in.(${enrollmentIds.join(',')})&order=accrued_at,id`);
 if(entries.some(e=>e.workspace_id!==workspaceId||!enrollmentIds.includes(e.enrollment_id)))throw Error('Commission privacy scope mismatch');
 return entries;
}
