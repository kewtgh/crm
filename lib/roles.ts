export type AppRole = "SUPER_ADMIN" | "ADMIN" | "SALES_DIRECTOR" | "SALES_MANAGER" | "SALES_SPECIALIST" | "SALES_SUPPORT" | "FINANCE_MANAGER" | "FINANCE_SPECIALIST" | "OPERATIONS_MANAGER" | "OPERATIONS_SPECIALIST" | "ACADEMIC_SPECIALIST" | "CUSTOMER_SUCCESS_SPECIALIST";

export const APP_ROLES: readonly AppRole[] = ["SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT", "FINANCE_MANAGER", "FINANCE_SPECIALIST", "OPERATIONS_MANAGER", "OPERATIONS_SPECIALIST", "ACADEMIC_SPECIALIST", "CUSTOMER_SUCCESS_SPECIALIST"];
export const ADMIN_ROLES: readonly AppRole[] = ["SUPER_ADMIN", "ADMIN"];
export const SALES_ROLES: readonly AppRole[] = ["SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"];

export const roleMessageKey: Record<AppRole, string> = {
  SUPER_ADMIN: "role.superAdmin",
  ADMIN: "role.admin",
  SALES_DIRECTOR: "role.salesDirector",
  SALES_MANAGER: "role.salesManager",
  SALES_SPECIALIST: "role.salesSpecialist",
  SALES_SUPPORT: "role.salesSupport",
  FINANCE_MANAGER: "role.finance_manager",
  FINANCE_SPECIALIST: "role.finance_specialist",
  OPERATIONS_MANAGER: "role.operations_manager",
  OPERATIONS_SPECIALIST: "role.operations_specialist",
  ACADEMIC_SPECIALIST: "role.academic_specialist",
  CUSTOMER_SUCCESS_SPECIALIST: "role.customer_success_specialist",

};
