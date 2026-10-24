import type {TaskWorkspace} from "../../lib/task-workspace-repository";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const qualityWorkspace:TaskWorkspace={canViewTeam:false,capacity:[],items:Array.from({length:25},(_,n)=>({
 id:id(n+1),titleZh:`示例任务 ${n+1}`,titleEn:`Fictional Task ${n+1}`,related:"Fictional Academy",status:"TODO",priority:n%2?"HIGH":"NORMAL",ownerId:id(99),ownerName:"Advisor A",dueAt:new Date().toISOString(),slaDueAt:null,revision:1,
}))};
