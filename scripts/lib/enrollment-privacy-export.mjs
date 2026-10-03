// Called only by the existing authorized privacy-export worker. No source profile copies.
export async function enrollmentPrivacyRecords(requestAll, workspaceId, studentIds) {
  if (!studentIds.length) return {enrollments: [], history: [], attributions: []};
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(workspaceId) || studentIds.some(id => !uuid.test(id))) throw new Error("Invalid enrollment privacy scope");
  const enrollments = await requestAll(`/db/table/student_enrollments?workspace_id=eq.${workspaceId}&student_id=in.(${studentIds.join(",")})&order=created_at,id`);
  if (!enrollments.length) return {enrollments, history: [], attributions: []};
  const ids = enrollments.map(row => row.id);
  if (ids.some(id => !uuid.test(id)) || enrollments.some(row => row.workspace_id !== workspaceId || !studentIds.includes(row.student_id))) throw new Error("Enrollment privacy scope mismatch");
  const [history, attributions] = await Promise.all([
    requestAll(`/db/table/student_enrollment_status_history?workspace_id=eq.${workspaceId}&enrollment_id=in.(${ids.join(",")})&order=changed_at,id`),
    requestAll(`/db/table/enrollment_attributions?workspace_id=eq.${workspaceId}&enrollment_id=in.(${ids.join(",")})&order=created_at,id`),
  ]);
  if ([...history, ...attributions].some(row => row.workspace_id !== workspaceId || !ids.includes(row.enrollment_id))) throw new Error("Enrollment privacy scope mismatch");
  return {enrollments, history, attributions};
}
