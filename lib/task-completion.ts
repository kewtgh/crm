import {z} from "zod";

const target=z.object({id:z.uuid(),expectedRevision:z.number().int().min(1).max(2147483647)}).strict();
const requestKey=z.string().min(8).max(160).refine(value=>value===value.trim());
export const taskCompletionSchema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("complete"),tasks:z.array(target).length(1),requestKey}).strict(),
  z.object({operation:z.literal("bulkComplete"),tasks:z.array(target).min(1).max(50),reason:z.string().trim().min(3).max(500),requestKey}).strict(),
]).refine(value=>new Set(value.tasks.map(item=>item.id.toLowerCase())).size===value.tasks.length);
export type TaskCompletion=z.infer<typeof taskCompletionSchema>;
export type TaskCompletionDraft=TaskCompletion extends infer T?T extends TaskCompletion?Omit<T,"requestKey">:never:never;
export type TaskCompletionResult={ids:string[];affected:number};

export function confirmedTaskCompletion(value:unknown,command:TaskCompletion):TaskCompletionResult|null {
  const result=z.object({ids:z.array(z.uuid()),affected:z.number().int()}).safeParse(value);
  if(!result.success)return null;
  const expected=new Set(command.tasks.map(task=>task.id.toLowerCase()));
  return result.data.affected===expected.size&&result.data.ids.length===expected.size
    &&new Set(result.data.ids.map(id=>id.toLowerCase())).size===expected.size
    &&result.data.ids.every(id=>expected.has(id.toLowerCase()))?result.data:null;
}
