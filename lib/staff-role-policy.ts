import {APP_ROLES,type AppRole} from "./roles";
export function canChangeStaffRole(actor:AppRole,target:AppRole){return actor==="SUPER_ADMIN"||(actor==="ADMIN"&&target!=="ADMIN"&&target!=="SUPER_ADMIN");}
export function assignableStaffRoles(actor:AppRole):AppRole[]{return actor==="SUPER_ADMIN"?[...APP_ROLES]:actor==="ADMIN"?APP_ROLES.filter(role=>role!=="ADMIN"&&role!=="SUPER_ADMIN"):[];}
