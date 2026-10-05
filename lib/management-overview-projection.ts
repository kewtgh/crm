import {managementModules,metricDefinitions,type ManagementModule,type ManagementMetricKey,type MetricValue,type ManagementOverviewProjection} from "./management-metric-contract";
import type {ChannelAnalytics} from "./channel-analytics-input";
import type {SuccessAnalytics} from "./student-success-analytics-repository";
type Counts=Record<string,number>;
type MoneyRow={currency:string}&Record<string,string>;
export type ManagementReadModel={filters?:ManagementOverviewProjection["filters"];filterApplied?:ManagementOverviewProjection["filterApplied"];asOf:string;period:ManagementOverviewProjection["period"];permissions:ManagementOverviewProjection["permissions"];commercial:{snapshot:Counts;period:Counts;money:MoneyRow[]};delivery:{snapshot:Counts;period:Counts;statuses:Counts};finance:{money:MoneyRow[]}|null;channel:ChannelAnalytics;studentSuccess:SuccessAnalytics;admissions:{snapshot:Counts;period?:Counts;statuses:Counts;decisions:Counts};attention:ManagementOverviewProjection["attention"];quality:ManagementOverviewProjection["quality"]};
export function projectManagementOverview(raw:ManagementReadModel):ManagementOverviewProjection{
 const modules=Object.fromEntries(managementModules.map(k=>[k,{available:raw.permissions[k],metrics:[] as MetricValue[],distributions:{}}])) as ManagementOverviewProjection["modules"];
 const add=(key:ManagementMetricKey,value:number|string|null,unit:MetricValue["unit"]="COUNT",currency:string|null=null)=>{
  const [module,mode,source,dateSemantics]=metricDefinitions[key];if(!modules[module].available)return;
  modules[module].metrics.push({key,value,unit,currency,mode,source,dateSemantics,asOf:raw.asOf,period:mode==="PERIOD"?raw.period:null});
 };
 const counts=(module:ManagementModule,values:Counts)=>{for(const [key,value] of Object.entries(values)){if(key in metricDefinitions&&metricDefinitions[key as ManagementMetricKey][0]===module)add(key as ManagementMetricKey,value);}};
 const money=(rows:MoneyRow[])=>rows.forEach(row=>Object.entries(row).forEach(([key,value])=>{if(key!=="currency"&&key in metricDefinitions)add(key as ManagementMetricKey,value,"MONEY",row.currency);}));
 counts("commercial",raw.commercial.snapshot);counts("commercial",raw.commercial.period);money(raw.commercial.money);
 counts("delivery",raw.delivery.snapshot);counts("delivery",raw.delivery.period);modules.delivery.distributions={enrollment:raw.delivery.statuses};
 if(raw.permissions.finance&&raw.finance){money(raw.finance.money);raw.finance.money.forEach(row=>add("netCollected",row.collected,"MONEY",row.currency));}
 add("visibleAccounts",raw.channel.snapshot.visibleAccounts);add("availablePublicLeads",raw.channel.snapshotTotals.availablePublicLeads);add("channelOpenOpportunities",raw.channel.snapshotTotals.openOpportunities);add("primaryContributions",raw.channel.snapshotTotals.primaryContributions);add("assistContributions",raw.channel.snapshotTotals.assistContributions);add("eventsHeld",raw.channel.totals.eventsHeld);
 modules.channel.distributions={tier:raw.channel.snapshot.byTier,stage:raw.channel.snapshot.byStage};
 if(raw.permissions.commissionMoney&&raw.channel.permissions.moneyVisible){raw.channel.commissionByCurrency.forEach(row=>{add("commissionNet",row.net,"MONEY",row.currency);add("commissionOpen",row.open,"MONEY",row.currency);add("commissionPeriod",row.period_net,"MONEY",row.currency);});raw.channel.settlementByCurrency.filter(row=>row.status==="PAID").forEach(row=>add("commissionPaid",row.paid_in_period,"MONEY",row.currency));}
 counts("admissions",raw.admissions.snapshot);counts("admissions",raw.admissions.period??{});modules.admissions.distributions={application:raw.admissions.statuses,decision:raw.admissions.decisions};
 counts("studentSuccess",Object.fromEntries(Object.entries(raw.studentSuccess.snapshot).filter(([,v])=>typeof v==="number")) as Counts);counts("studentSuccess",raw.studentSuccess.period as unknown as Counts);
 add("goalAttainment",raw.studentSuccess.snapshot.goalAttainment.rate,"RATIO");modules.studentSuccess.distributions=raw.studentSuccess.snapshot.distributions;
 return {filters:raw.filters,filterApplied:raw.filterApplied,asOf:raw.asOf,period:raw.period,permissions:raw.permissions,modules,channelContributions:raw.channel.items.map(row=>({organizationId:row.organizationId,nameZh:row.nameZh,nameEn:row.nameEn,primary:row.snapshot.primaryContributions,assist:row.snapshot.assistContributions})),attention:raw.attention,quality:raw.quality};
}
