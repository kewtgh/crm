export const RELATIONSHIP_STEPS = ["CONTACT", "MEAL", "FAMILY_CHAT", "ADVOCACY"] as const;
export type CustomerSubject = "ORGANIZATION" | "CONTACT" | "HOUSEHOLD";
export type FollowUpPlan = {id:string;title:string;target_level:number;target_count:number;start_date:string;due_date:string;updated_at:string};
export type FollowUpEntry = {id:string;kind:string;summary:string;next_step:string;occurred_at:string;owner_id:string};
export function followUpProgress(plan:FollowUpPlan|null, entries:FollowUpEntry[], level:number, today:string, exactCompleted?:number) {
  const completed=exactCompleted??(plan?entries.filter(entry=>{const day=new Date(entry.occurred_at).toISOString().slice(0,10);return ["CALL","EMAIL","MEETING","VISIT","MEAL"].includes(entry.kind)&&day>=plan.start_date&&day<=plan.due_date;}).length:0);
  return {completed, contactProgress:plan?Math.min(100,Math.round(completed/plan.target_count*100)):0,
    levelProgress:plan?Math.min(100,Math.round(level/plan.target_level*100)):0,
    overdue:!!plan&&plan.due_date<today&&(completed<plan.target_count||level<plan.target_level),
    nextLevel:Math.min(4,level+1), suggestionKey:`customerOps.suggestion.${Math.min(4,Math.max(1,level))}`};
}
