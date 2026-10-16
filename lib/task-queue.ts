import type { TaskWorkItem } from "./task-workspace-repository";
import { dateKeyFor, type SupportedTimezone } from "./timezone";

export const taskQueueFilters = ["all", "mine", "today", "overdue", "sla"] as const;
export type TaskQueueFilter = typeof taskQueueFilters[number];
export const TASK_QUEUE_PAGE_SIZE = 12;

export function parseTaskQueueFilter(value:string|null):TaskQueueFilter {
  return taskQueueFilters.includes(value as TaskQueueFilter)?value as TaskQueueFilter:"all";
}

export function taskIsOverdue(value:string|null,now:number) {
  return Boolean(value&&Date.parse(value)<now);
}

/** Use the same user reporting timezone as dashboard_snapshot; never the browser host timezone. */
export function taskIsDueToday(value:string|null,now:number,timezone:SupportedTimezone) {
  return Boolean(value&&Number.isFinite(Date.parse(value))&&dateKeyFor(new Date(value),timezone)===dateKeyFor(new Date(now),timezone));
}

export function filterTaskQueue(items:readonly TaskWorkItem[],filter:TaskQueueFilter,search:string,userId:string,now:number,timezone:SupportedTimezone) {
  const query=search.trim().toLocaleLowerCase();
  return items.filter(item=>{
    const inScope=filter==="all"||filter==="mine"&&item.ownerId===userId
      ||filter==="today"&&item.ownerId===userId&&taskIsDueToday(item.dueAt,now,timezone)
      ||filter==="overdue"&&item.ownerId===userId&&taskIsOverdue(item.dueAt,now)
      ||filter==="sla"&&taskIsOverdue(item.slaDueAt,now);
    return inScope&&(!query||[item.titleZh,item.titleEn,item.related,item.ownerName].some(value=>value.toLocaleLowerCase().includes(query)));
  });
}
