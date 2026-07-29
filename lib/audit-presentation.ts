import type { Locale } from "./i18n/types";

const auditWords = {
  "zh-CN": {
    INSERT: "创建", CREATE: "创建", CREATED: "创建", UPDATE: "更新", UPDATED: "更新",
    DELETE: "删除", DELETED: "删除", SUBMIT: "提交", SUBMITTED: "提交", APPROVE: "批准",
    APPROVED: "批准", REJECT: "驳回", REJECTED: "驳回", COMPLETE: "完成", COMPLETED: "完成",
    RETRY: "重试", RETRIED: "重试", REQUEST: "申请", REQUESTED: "申请", REVOKE: "撤销",
    REVOKED: "撤销", LOGIN: "登录", LOGOUT: "登出", STAFF: "员工", USER: "账号",
    ENTERPRISE: "企业", DIRECTORY: "目录", CONNECTOR: "连接器", VALIDATION: "验证",
    CLAIMED: "已绑定", STAGED: "已预配", DEPROVISIONED: "已停用", CONTRACT: "合同",
    QUOTE: "报价", PAYMENT: "付款", REFUND: "退款", EXPORT: "导出", APPROVAL: "审批",
    TASK: "任务", DEVICE: "设备", INTEGRATION: "集成", PROFILE: "个人资料",
    MEMBERSHIP: "成员关系", WORKSPACE: "工作区", BUSINESS: "业务", TIMEZONE: "时区",
    TURNSTILE: "Turnstile", POLICY: "策略", CHANGED: "已更改",
  },
  en: {
    INSERT: "Created", CREATE: "Create", CREATED: "Created", UPDATE: "Updated", UPDATED: "Updated",
    DELETE: "Deleted", DELETED: "Deleted", SUBMIT: "Submit", SUBMITTED: "Submitted",
    APPROVE: "Approve", APPROVED: "Approved", REJECT: "Reject", REJECTED: "Rejected",
    COMPLETE: "Complete", COMPLETED: "Completed", RETRY: "Retry", RETRIED: "Retried",
    REQUEST: "Request", REQUESTED: "Requested", REVOKE: "Revoke", REVOKED: "Revoked",
    LOGIN: "Login", LOGOUT: "Logout", STAFF: "staff", USER: "account", ENTERPRISE: "enterprise",
    DIRECTORY: "directory", CONNECTOR: "connector", VALIDATION: "validation", CLAIMED: "claimed",
    STAGED: "staged", DEPROVISIONED: "deprovisioned", CONTRACT: "contract", QUOTE: "quote",
    PAYMENT: "payment", REFUND: "refund", EXPORT: "export", APPROVAL: "approval", TASK: "task",
    DEVICE: "device", INTEGRATION: "integration", PROFILE: "profile", MEMBERSHIP: "membership",
    WORKSPACE: "workspace", BUSINESS: "business", TIMEZONE: "timezone", TURNSTILE: "Turnstile",
    POLICY: "policy", CHANGED: "changed",
  },
} as const satisfies Record<Locale, Record<string, string>>;

const auditEntities = {
  "zh-CN": {
    USERPREFERENCES: "用户偏好设置",
    INTEGRATIONCONNECTIONS: "集成连接",
    GRADEPROGRESSIONRULES: "年级升学规则",
    USERPROFILES: "员工个人资料",
    WORKSPACEMEMBERS: "工作区成员",
    TRUSTEDDEVICES: "可信设备",
    APPROVALREQUESTS: "审批记录",
    CRM_TASKS: "客户任务",
    ORGANIZATIONS: "客户组织",
    CONTACTS: "联系人",
    STUDENTS: "学生",
    HOUSEHOLDS: "家庭",
    CONTRACTS: "合同",
    OPPORTUNITIES: "商机",
    LEADS: "线索",
    PRODUCTS: "产品与服务",
    MFARECOVERYCODES: "二次验证恢复码",
    WORKSPACE: "工作区",
  },
  en: {
    USERPREFERENCES: "User preferences",
    INTEGRATIONCONNECTIONS: "Integration connections",
    GRADEPROGRESSIONRULES: "Grade progression rules",
    USERPROFILES: "Staff profiles",
    WORKSPACEMEMBERS: "Workspace members",
    TRUSTEDDEVICES: "Trusted devices",
    APPROVALREQUESTS: "Approval records",
    CRM_TASKS: "CRM tasks",
    ORGANIZATIONS: "Customer organizations",
    CONTACTS: "Contacts",
    STUDENTS: "Students",
    HOUSEHOLDS: "Households",
    CONTRACTS: "Contracts",
    OPPORTUNITIES: "Opportunities",
    LEADS: "Leads",
    PRODUCTS: "Products and services",
    MFARECOVERYCODES: "MFA recovery codes",
    WORKSPACE: "Workspace",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export function auditLabel(value: string, locale: Locale) {
  const entityKey = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const entity = (auditEntities[locale] as Record<string, string>)[entityKey];
  if (entity) return entity;
  const words = auditWords[locale] as Record<string, string>;
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\s-]+/)
    .map((word) => words[word] ?? word.toLocaleLowerCase().replace(/^./, (letter) => letter.toLocaleUpperCase()))
    .join(locale === "zh-CN" ? "" : " ");
}
