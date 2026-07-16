export type AppRole = "SUPER_ADMIN" | "ADMIN" | "SALES_DIRECTOR" | "SALES_MANAGER" | "SALES_SPECIALIST" | "SALES_SUPPORT";

export const APP_ROLES: readonly AppRole[] = ["SUPER_ADMIN", "ADMIN", "SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"];
export const ADMIN_ROLES: readonly AppRole[] = ["SUPER_ADMIN", "ADMIN"];
export const SALES_ROLES: readonly AppRole[] = ["SALES_DIRECTOR", "SALES_MANAGER", "SALES_SPECIALIST", "SALES_SUPPORT"];

export const roleMessageKey: Record<AppRole, string> = {
  SUPER_ADMIN: "role.superAdmin",
  ADMIN: "role.admin",
  SALES_DIRECTOR: "role.salesDirector",
  SALES_MANAGER: "role.salesManager",
  SALES_SPECIALIST: "role.salesSpecialist",
  SALES_SUPPORT: "role.salesSupport",
};
