import {listQualityIssues,type QualityIssue} from "./phase2-repository";
import {loadQualityRules,loadQualityTrend,type QualityRuleConfig} from "./v220-repository";
import {databaseJson} from "./db/gateway";
import type {QualityCommand} from "./quality-contract";

export type QualityWorkspace={items:QualityIssue[];total:number;page:number;pageSize:number;trend:Awaited<ReturnType<typeof loadQualityTrend>>;rules:QualityRuleConfig[];unavailable:Array<"trend"|"rules">};
export async function loadQualityWorkspace(options:Parameters<typeof listQualityIssues>[0]={},adapter={issues:listQualityIssues,trend:loadQualityTrend,rules:loadQualityRules}):Promise<QualityWorkspace>{
 const [issues,trend,rules]=await Promise.allSettled([adapter.issues(options),adapter.trend(),adapter.rules()]);
 if(issues.status==="rejected")throw issues.reason;
 return {...issues.value,trend:trend.status==="fulfilled"?trend.value:[],rules:rules.status==="fulfilled"?rules.value:[],unavailable:[...(trend.status==="rejected"?["trend" as const]:[]),...(rules.status==="rejected"?["rules" as const]:[])]};
}
export function executeQualityCommand(input:QualityCommand,request=databaseJson){const {requestKey,...command}=input;return request("/db/rpc/execute_quality_command",{method:"POST",body:JSON.stringify({command,p_request_key:requestKey})});}
