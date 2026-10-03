export const importFieldsByResource = {
  COHORTS:["productCode","cohortCode","nameZh","nameEn","intakeType","academicYear","applicationOpenOn","applicationDeadline","startOn","endOn","targetEnrollment","capacity","currency","ownerEmail","status"],
  ENROLLMENTS:["studentNumber","cohortCode","status","ownerEmail","salesOwnerEmail","householdReference","opportunityReference","enrolledAt","completedAt","withdrawnAt","withdrawalReason"],
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

export function importMappingReady(resource:string,mapping:Record<string,string>) {
  if(resource==="COHORTS")return Boolean(mapping.productCode&&mapping.cohortCode&&(mapping.nameZh||mapping.nameEn));
  if(resource==="ENROLLMENTS")return Boolean(mapping.studentNumber&&mapping.cohortCode&&mapping.ownerEmail);
  return Boolean(mapping.nameZh||mapping.nameEn);
}
