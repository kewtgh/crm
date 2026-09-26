import type { NotificationRecord } from "./notifications-repository";

export function notificationHref(item: Pick<NotificationRecord, "sourceType" | "sourceId">): string {
  if (item.sourceType === "TASK") return item.sourceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.sourceId) ? `/tasks/${item.sourceId}` : "/tasks";
  if (item.sourceType === "CONTRACT") return "/contracts";
  if (item.sourceType === "APPOINTMENT") return "/calendar";
  if (item.sourceType === "EXPORT") return "/reports/exports";
  return "/notifications";
}
