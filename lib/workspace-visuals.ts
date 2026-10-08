import type {UiIconName} from "../components/ui-icon";
import {navigationDestinations} from "./navigation-destinations";
/** Presentation only. Never used to decide visibility, capability or financial state. */
export const destinationIconNames:Record<string,UiIconName>={
 dashboard:"metric","action-center":"action",tasks:"queue",calendar:"calendar",approvals:"governance",messages:"message",
 organizations:"organization",contacts:"person",students:"student",families:"family",enrollments:"program",applications:"application",support:"support",progression:"outcome",
 leads:"potential",opportunities:"opportunity",products:"product",contracts:"application",finance:"finance",revenue:"finance",commissions:"partnership",growth:"target",
 executive:"metric",channels:"channel",performance:"target",reports:"metric",consumption:"finance",exports:"export",
 imports:"import",quality:"governance",duplicates:"copy","record-cleanup":"archive",workflows:"workflow","education-business":"program",privacy:"governance",assistance:"automation",
 admin:"settings","admin-approvals":"governance","admin-operations":"activity","admin-workspace":"organization","admin-users":"people","admin-recycle":"archive","admin-security":"governance",settings:"settings",
};
export function destinationIcon(id?:string):UiIconName{return destinationIconNames[id??""]??"section";}
export function workspaceLinkIcon(href:string):UiIconName{
 const destination=navigationDestinations.find(d=>d.href===href)??navigationDestinations.filter(d=>href.startsWith(d.href+"/")).sort((a,b)=>b.href.length-a.href.length)[0];
 return destinationIcon(destination?.id);
}
