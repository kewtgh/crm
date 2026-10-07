import type { StudentDetail, HouseholdDetail } from "../../lib/v200-repository";
import type { CustomerOperationsSnapshot } from "../../lib/customer-operations-repository";
import type { Organization360 } from "../../lib/phase2-repository";
export const recordId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const recordStamp = "2026-10-07T04:00:00Z";
export const studentRecord: StudentDetail = {
  id: recordId(3), personId: recordId(4), nameZh: "学生甲：示例跨学科学习与发展档案", nameEn: "Student A — Example Interdisciplinary Learning and Student Development",
  householdId: recordId(5), householdZh: "示例家庭甲", householdEn: "Example Household A", studentNumber: "TEST-STUDENT-A", grade: "G8", academicYear: "2026-2027", status: "ACTIVE", updatedAt: recordStamp,
  birthDate: "2013-04-12", currentClass: "示例班级 A", personalityMarkdown: "喜欢分享想法。", learningExpectationsMarkdown: "提升学术表达能力。", strengthsMarkdown: "科学探索与协作。", supportNeedsMarkdown: "合成示例：时间管理支持。", interests: ["科学"], preferredLearningStyle: "VISUAL",
  familyMembers: [{ contactId: recordId(6), relationship: "PARENT", nameZh: "家长甲", nameEn: "Parent A" }],
  academicRecords: [{ id: recordId(31), curriculum: "IB", grade: "G8", academicYear: "2026-2027", validFrom: "2026-09-01", validTo: "2027-08-31", status: "CURRENT", schoolZh: "示例国际学校", schoolEn: "Example International School" }],
  guardians: [{ id: recordId(32), contactId: recordId(6), relationship: "OTHER", primary: true, emergency: true, legalAuthority: false, nameZh: "家长甲", nameEn: "Parent A" }],
};
export const householdRecord: HouseholdDetail = {
  id: recordId(5), nameZh: "示例家庭甲", nameEn: "Example Household A", status: "ACTIVE", address: "合成地址 A", memberCount: 3, updatedAt: recordStamp,
  primaryParentOccupation: "示例职业 A", secondaryParentOccupation: "示例职业 B", annualIncomeAmount: null, incomeCurrency: "CNY", preferredContactMethod: "EMAIL", preferredLanguage: "ZH_CN", educationExpectationsMarkdown: "参与科学与语言活动。", familyBackgroundMarkdown: "独立虚构家庭资料。",
  members: [
    { id: recordId(35), contactId: recordId(6), role: "PARENT", primary: true, nameZh: "家长甲", nameEn: "Parent A" },
    { id: recordId(36), contactId: recordId(7), role: "PARENT", primary: false, nameZh: "家长乙", nameEn: "Parent B" },
    { id: recordId(37), contactId: recordId(4), role: "STUDENT", primary: false, nameZh: studentRecord.nameZh, nameEn: studentRecord.nameEn },
  ],
};
export const accountRecord: Organization360 = {
  id: recordId(1), nameZh: "示例国际教育与学生发展学院", nameEn: "Example International Academy for Global Education and Student Development", status: "HEALTHY", city: "示例城市", curriculum: "IB", completeness: 88,
  timeline: { items: [{ type: "ACTIVITY", entityId: recordId(81), occurredAt: recordStamp, titleZh: "记录示例跟进", titleEn: "Example follow-up", summary: "MEETING", metadata: {} }], total: 1, page: 1, pageSize: 10 },
};
export const accountOperations: CustomerOperationsSnapshot = {
  subject: "ORGANIZATION", id: accountRecord.id, nameZh: accountRecord.nameZh, nameEn: accountRecord.nameEn, shortName: "示例学院", ownerName: "顾问甲 / Advisor A",
  profile: { city: "示例城市", curriculum: "IB", website: "https://example.test", organization_overview_markdown: "独立虚构机构资料。" }, level: 2,
  plan: { id: recordId(80), title: "确认示例合作计划", start_date: "2026-10-01", due_date: "2026-10-21", target_level: 3, target_count: 3, updated_at: recordStamp },
  entries: [{ id: recordId(81), kind: "MEETING", occurred_at: recordStamp, summary: "讨论合成课程需求。", next_step: "确认示例活动时间", owner_id: recordId(99) }], entryTotal: 1, completed: 1,
  contacts: [{ id: recordId(2), name_zh: "顾问乙", name_en: "Advisor B", owner_name: "Advisor A", communication_level: 2 }],
  contracts: [{ id: recordId(20), contract_number: "TEST-CONTRACT-A", status: "DRAFT", owner_name: "Advisor A" }],
  opportunities: [{ id: recordId(45), title_zh: "示例课程合作", title_en: "Example Program Cooperation", stage: "EVALUATION" }],
  students: [{ id: recordId(3), name_zh: studentRecord.nameZh, name_en: studentRecord.nameEn }, { id: recordId(13), name_zh: "学生乙", name_en: "Student B" }],
  products: [{ id: recordId(10), name_zh: "示例学习项目", name_en: "Example Learning Program" }], limited: false, canManage: true,
};
