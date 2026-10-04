export async function workflowPrivacyRecords(requestAll,workspaceId,enrollmentIds){
 if(!enrollmentIds.length)return{instances:[],steps:[],templates:[]};const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(workspaceId)||enrollmentIds.some(id=>!uuid.test(id)))throw Error('Invalid workflow privacy scope');
 const instances=await requestAll(`/db/table/workflow_instances?workspace_id=eq.${workspaceId}&enrollment_id=in.(${enrollmentIds.join(',')})&order=created_at,id`);
 if(instances.some(row=>!uuid.test(row.id)||row.workspace_id!==workspaceId||!enrollmentIds.includes(row.enrollment_id)))throw Error('Workflow privacy scope mismatch');
 const ids=instances.map(row=>row.id),steps=ids.length?await requestAll(`/db/table/workflow_step_instances?workspace_id=eq.${workspaceId}&workflow_instance_id=in.(${ids.join(',')})&order=created_at,id`):[];
 if(steps.some(row=>row.workspace_id!==workspaceId||!ids.includes(row.workflow_instance_id)))throw Error('Workflow privacy scope mismatch');
 const templateIds=[...new Set(instances.map(row=>row.template_id))],templates=templateIds.length?await requestAll(`/db/table/workflow_templates?workspace_id=eq.${workspaceId}&id=in.(${templateIds.join(',')})&select=id,workspace_id,name_zh,name_en,version`):[];
 if(templates.some(row=>row.workspace_id!==workspaceId||!templateIds.includes(row.id)))throw Error('Workflow privacy scope mismatch');return{instances,steps,templates};
}
