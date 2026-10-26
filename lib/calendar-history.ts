import {z} from "zod";
import {dateTimePartsFor,zonedLocalDateTimeToUtc,type SupportedTimezone} from "./timezone";
export const completedPeriods=["1y","6m","3m","1m","1w"] as const;
export type CompletedPeriod=typeof completedPeriods[number];
export const completedPeriodSchema=z.enum(completedPeriods);
export function completedSince(period:CompletedPeriod,timezone:SupportedTimezone,now=new Date()){
 const parts=dateTimePartsFor(now,timezone),year=Number(parts.year),month=Number(parts.month)-1,day=Number(parts.day);
 const date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(year,month,1);
 if(period==="1w")date.setUTCDate(day-7);
 else{const months=period==="1y"?12:period==="6m"?6:period==="3m"?3:1;date.setUTCMonth(month-months);const last=new Date(0);last.setUTCHours(0,0,0,0);last.setUTCFullYear(date.getUTCFullYear(),date.getUTCMonth()+1,0);date.setUTCDate(Math.min(day,last.getUTCDate()));}
 const key=date.toISOString().slice(0,10);return zonedLocalDateTimeToUtc(key+"T00:00",timezone).toISOString();
}
