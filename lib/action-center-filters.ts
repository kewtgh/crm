import type { ActionCenterItem } from "./action-center-repository";

export const actionCategories = ["all", "work", "sales", "service", "governance"] as const;
export const actionPriorities = ["all", "urgent", "high", "normal"] as const;
export type ActionFilters = { category: typeof actionCategories[number]; priority: typeof actionPriorities[number] };

export function readActionFilters(params: Pick<URLSearchParams, "get">): ActionFilters {
  const category = params.get("category"), priority = params.get("priority");
  return {
    category: actionCategories.includes(category as ActionFilters["category"]) ? category as ActionFilters["category"] : "all",
    priority: actionPriorities.includes(priority as ActionFilters["priority"]) ? priority as ActionFilters["priority"] : "all",
  };
}

export function writeActionFilters(params: URLSearchParams, filters: ActionFilters) {
  const result = new URLSearchParams(params);
  for (const key of ["category", "priority"] as const) {
    if (filters[key] === "all") result.delete(key); else result.set(key, filters[key]);
  }
  return result;
}

export function filterActionItems(items: readonly ActionCenterItem[], filters: ActionFilters) {
  return items.filter(item => (filters.category === "all" || item.category === filters.category)
    && (filters.priority === "all" || item.priority === filters.priority));
}
