import {z} from "zod";
import {formatFinanceAmount} from "./enrollment-finance";

export function formatChannelCommissionAmount(value:string,locale:string){
 return `${value.startsWith("-")?"−":""}${formatFinanceAmount(value.replace(/^-/,""),locale)}`;
}

const date=z.iso.date();
export const channelAnalyticsFilters=z.object({
 from:date.optional(),to:date.optional(),organization:z.uuid().optional(),owner:z.uuid().optional(),
 product:z.uuid().optional(),cohort:z.uuid().optional(),tier:z.enum(["S","A","B","C","D","UNKNOWN"]).optional(),
 stage:z.enum(["PROSPECT","CONTACTING","ACTIVE","PAUSED","ENDED","KEY_PERSON_ENGAGED","NEEDS_QUALIFIED","SOLUTION_PROPOSED","PARTNERSHIP_AGREED","RECRUITMENT_ACTIVATED","ONGOING_ENABLEMENT"]).optional(),
 page:z.coerce.number().int().min(1).max(100000).optional(),sort:z.enum(["name","primary","active","tier"]).optional()
}).strict().refine(f=>!f.from||!f.to||(f.from<=f.to&&Date.parse(f.to)-Date.parse(f.from)<=3660*86400000),{message:"Invalid period"});
export type ChannelAnalyticsFilters=z.infer<typeof channelAnalyticsFilters>;
export type CommissionExposure={currency:string;net:string;open:string;earned:string;reversals:string;period_net:string};
export type SettlementExposure={currency:string;status:string;count:number;amount:string;approved_in_period:string;paid_in_period:string;paid_count_in_period:number};
export type ChannelPerformanceProjection={organizationId:string;nameZh:string;nameEn:string;commercialTier:string|null;partnershipPotential:number|null;partnershipStage:string|null;
 snapshot:Record<string,number>;period:Record<string,number>;enrollmentStatuses:Record<string,number>;leadStatuses:Record<string,number>;
 commissionByCurrency:CommissionExposure[];settlementByCurrency:SettlementExposure[];quality:Record<string,number>;moneyVisible:boolean};
export type ChannelAnalytics={filters:ChannelAnalyticsFilters;currencies:string[];permissions:{moneyVisible:boolean};
 snapshot:{asOf:string;visibleAccounts:number;withKeyContact:number;withoutKeyContact:number;withDecisionMaker:number;withoutDecisionMaker:number;withActiveOpportunity:number;withoutActiveOpportunity:number;byTier:Record<string,number>;byStage:Record<string,number>;activeAttributedEnrollments:number};
 period:{from:string;to:string;timezone:string};totals:Record<string,number>;snapshotTotals:Record<string,number>;
 commissionByCurrency:CommissionExposure[];settlementByCurrency:SettlementExposure[];items:ChannelPerformanceProjection[];page:number;pageSize:number;total:number};
