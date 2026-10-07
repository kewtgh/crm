import type { StudentDetail } from "./v200-repository";
import { safeRelativeReturnTo } from "./return-to";

export const studentWorkspaceTabs = [
  { key: "profile", label: "workspace.studentOverview" },
  { key: "family", label: "workspace.familyContacts" },
  { key: "journey", label: "workspace.enrollmentsApplications" },
  { key: "support", label: "workspace.supportStage" },
  { key: "activity", label: "ux.record.activity" },
  { key: "academic", label: "ux.record.academic" },
];
export const accountWorkspaceTabs = [
  { key: "overview", label: "ux.record.overview" },
  { key: "people", label: "ux.record.people" },
  { key: "opportunities", label: "nav.opportunities" },
  { key: "business", label: "ux.record.contractsProducts" },
  { key: "commercial", label: "ux.record.channelsOutreach" },
  { key: "activity", label: "ux.record.activity" },
];
/** Full-input updates start from the authorized record. Absent controls preserve values. */
export function studentUpdateInput(detail: StudentDetail, form: FormData, householdId: string) {
  const text = (key: string, existing: string) => form.has(key) ? String(form.get(key) ?? "") : existing;
  return {
    operation: "updateStudent", id: detail.id, expectedUpdatedAt: detail.updatedAt,
    studentNumber: text("studentNumber", detail.studentNumber), birthDate: text("birthDate", detail.birthDate) || null,
    grade: text("grade", detail.grade), currentClass: text("currentClass", detail.currentClass),
    academicYear: text("academicYear", detail.academicYear), householdId: householdId || null,
    status: text("status", detail.status), personalityMarkdown: text("personalityMarkdown", detail.personalityMarkdown),
    learningExpectationsMarkdown: text("learningExpectationsMarkdown", detail.learningExpectationsMarkdown),
    strengthsMarkdown: text("strengthsMarkdown", detail.strengthsMarkdown), supportNeedsMarkdown: text("supportNeedsMarkdown", detail.supportNeedsMarkdown),
    interests: form.has("interests") ? String(form.get("interests") ?? "").split(/[,，]/).map(value => value.trim()).filter(Boolean) : detail.interests,
    preferredLearningStyle: text("preferredLearningStyle", detail.preferredLearningStyle),
  };
}
export function recordFocusHref(path: string, id: string, query = "") {
  const params = new URLSearchParams(query); params.set("focus", id);
  return `${path}?${params}`;
}
/** Return context accepts only the two student/family directory routes, never external URLs. */
export function safeRecordReturn(value: string | null) {
  const safe = safeRelativeReturnTo(value, "");
  if (!safe) return null;
  const url = new URL(safe, "https://example.test");
  return ["/students", "/households"].includes(url.pathname) ? `${url.pathname}${url.search}` : null;
}
