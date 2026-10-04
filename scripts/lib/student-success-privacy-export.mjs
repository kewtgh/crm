export async function studentSuccessPrivacyRecords(requestAll,workspaceId,enrollmentIds){
 const empty={cases:[],history:[],goals:[],links:[],tasks:[],checkins:[],assessments:[],risks:[],riskHistory:[],interventions:[],interventionHistory:[],outcomes:[]};if(!enrollmentIds.length)return empty;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(workspaceId)||enrollmentIds.some(id=>!uuid.test(id)))throw Error('Invalid success privacy scope');
 const cases=await requestAll(`/db/table/student_success_cases?workspace_id=eq.${workspaceId}&enrollment_id=in.(${enrollmentIds.join(',')})&order=created_at,id`);
 if(cases.some(row=>!uuid.test(row.id)||row.workspace_id!==workspaceId||!enrollmentIds.includes(row.enrollment_id)))throw Error('Success privacy scope mismatch');
 const ids=cases.map(row=>row.id);if(!ids.length)return empty;
 const [history,goals,links]=await Promise.all(['student_success_case_status_history','student_success_goals','student_success_task_links'].map(table=>requestAll(`/db/table/${table}?workspace_id=eq.${workspaceId}&case_id=in.(${ids.join(',')})&order=id`)));
 for(const rows of [history,goals,links])if(rows.some(row=>row.workspace_id!==workspaceId||!ids.includes(row.case_id)))throw Error('Success privacy scope mismatch');
 const taskIds=[...new Set(links.map(row=>row.task_id))];if(taskIds.some(id=>!uuid.test(id)))throw Error('Success privacy scope mismatch');
 const tasks=taskIds.length?await requestAll(`/db/table/student_success_privacy_tasks?workspace_id=eq.${workspaceId}&id=in.(${taskIds.join(',')})&order=created_at,id`):[];
 if(tasks.some(row=>row.workspace_id!==workspaceId||!taskIds.includes(row.id)))throw Error('Success privacy scope mismatch');
 const operationTables={outcomes:'student_success_outcomes',checkins:'student_success_checkins',assessments:'student_success_health_assessments',risks:'student_success_risk_signals',riskHistory:'student_success_risk_status_history',interventions:'student_success_interventions',interventionHistory:'student_success_intervention_status_history'};
 const operations=Object.fromEntries(await Promise.all(Object.entries(operationTables).map(async([key,table])=>{const rows=await requestAll(`/db/table/${table}?workspace_id=eq.${workspaceId}&case_id=in.(${ids.join(',')})&order=id`);if(rows.some(row=>row.workspace_id!==workspaceId||!ids.includes(row.case_id)))throw Error('Success privacy scope mismatch');return [key,rows];})));
 return {cases,history,goals,links,tasks,...operations};
}
