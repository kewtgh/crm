import type {RecycleBinItem,RecyclePage} from "../../lib/recycle-contract";
export const recoveryId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const recoveryRows:RecycleBinItem[]=Array.from({length:23},(_,n)=>({
 id:recoveryId(n+1),kind:n===21?"CONTRACT":n===22?"BUNDLE":"TASK",
 labelZh:`示例恢复记录 ${n+1}`,labelEn:`Fictional recovery record ${n+1}`,
 deletedAt:n%2?"2026-08-02T03:00:00.123456Z":"2026-10-20T03:00:00.123456Z",purgeEligibleAt:n>=21?null:n%2?"2026-09-01T03:00:00.123456Z":"2026-11-19T03:00:00.123456Z",
}));
export const recoveryInitial:RecyclePage={scope:"personal",items:recoveryRows.slice(0,20),total:recoveryRows.length,page:1,pageSize:20};
