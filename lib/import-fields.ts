export const importFieldsByResource = {
  CONTACTS:["nameZh","nameEn","email","phone","title"],
  ORGANIZATIONS:["nameZh","nameEn","city","curriculum","courseCategories","affiliationType","parentOrganizationId","website","foundedYear","studentCount","facultyCount","campusCount","organizationOverviewMarkdown","structureOverviewMarkdown"],
  HOUSEHOLDS:["nameZh","nameEn","address","primaryParentOccupation","secondaryParentOccupation","annualIncomeAmount","incomeCurrency","preferredContactMethod","preferredLanguage","educationExpectationsMarkdown","familyBackgroundMarkdown"],
  STUDENTS:["nameZh","nameEn","personId","householdId","studentNumber","birthDate","currentGrade","currentClass","academicYear","interests","preferredLearningStyle","personalityMarkdown","learningExpectationsMarkdown","strengthsMarkdown","supportNeedsMarkdown"],
} as const;

export function importFields(resource: string): readonly string[] {
  return Object.hasOwn(importFieldsByResource, resource)
    ? importFieldsByResource[resource as keyof typeof importFieldsByResource]
    : [];
}
