// Existing authorized privacy worker only; tasks remain in their original export.
export async function applicationPrivacyRecords(requestAll, workspaceId, enrollmentIds) {
  if (!enrollmentIds.length) return {applications: [], history: []};
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(workspaceId) || enrollmentIds.some(id => !uuid.test(id))) throw new Error("Invalid application privacy scope");
  const applications = await requestAll(`/db/table/student_applications?workspace_id=eq.${workspaceId}&enrollment_id=in.(${enrollmentIds.join(",")})&order=created_at,id`);
  if (applications.some(row => !uuid.test(row.id) || row.workspace_id !== workspaceId || !enrollmentIds.includes(row.enrollment_id))) throw new Error("Application privacy scope mismatch");
  const history = applications.length ? await requestAll(`/db/table/student_application_status_history?workspace_id=eq.${workspaceId}&application_id=in.(${applications.map(row => row.id).join(",")})&order=changed_at,id`) : [];
  if (history.some(row => row.workspace_id !== workspaceId || !applications.some(item => item.id === row.application_id))) throw new Error("Application privacy scope mismatch");
  return {applications, history};
}
