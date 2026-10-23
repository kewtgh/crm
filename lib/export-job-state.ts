import type {GeneratedJob} from "./generated-jobs-repository";

export const exportStatuses=["QUEUED","PROCESSING","READY","FAILED","EXPIRED"] as const;
export function exportStatusValid(value:string){return value==="all"||exportStatuses.some(status=>status===value);}
export function effectiveExportStatus(item:Pick<GeneratedJob,"status"|"expiresAt">,now=Date.now()):GeneratedJob["status"]{
 return item.status==="READY"&&item.expiresAt!==null&&Date.parse(item.expiresAt)<=now?"EXPIRED":item.status;
}
export function canDownloadExport(item:Pick<GeneratedJob,"status"|"expiresAt">,now=Date.now()){
 return item.status==="READY"&&item.expiresAt!==null&&Number.isFinite(Date.parse(item.expiresAt))&&Date.parse(item.expiresAt)>now;
}
