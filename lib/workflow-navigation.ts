import {hasCapability,type Capability} from './capabilities';
import type {AppRole} from './roles';
export type WorkflowEntry={key:string;href:string;capability:Capability;group:'relationships'|'delivery'|'operations'|'management';audience:'daily'|'management'};
export const workflowEntries:readonly WorkflowEntry[]=[
 {key:'organizations',href:'/schools',capability:'education.view',audience:'daily',group:'relationships'},
 {key:'leads',href:'/leads',capability:'leads.view',audience:'daily',group:'relationships'},
 {key:'students',href:'/households',capability:'education.view',audience:'daily',group:'delivery'},
 {key:'programs',href:'/products',capability:'education.view',audience:'daily',group:'delivery'},
 {key:'support',href:'/student-success',capability:'education.view',audience:'daily',group:'delivery'},
 {key:'tasks',href:'/tasks',capability:'tasks.view',audience:'daily',group:'operations'},
 {key:'imports',href:'/imports',capability:'imports.view',audience:'management',group:'operations'},
 {key:'quality',href:'/data-quality',capability:'dataQuality.manage',audience:'management',group:'operations'},
 {key:'overview',href:'/reports/executive',capability:'education.view',audience:'management',group:'management'},
 {key:'channels',href:'/reports/channels',capability:'education.view',audience:'management',group:'management'},
 {key:'performance',href:'/sales/performance',capability:'education.view',audience:'management',group:'management'},
];
export function visibleWorkflowEntries(role:AppRole){return workflowEntries.filter(item=>hasCapability(role,item.capability));}
/** Categories overlap; this counts category signals, not distinct records or tasks. */
export function actionSignalSummary(items:readonly {count:number;priority:string}[]){return{total:items.reduce((n,item)=>n+item.count,0),urgent:items.filter(item=>item.priority==='urgent').reduce((n,item)=>n+item.count,0)};}
