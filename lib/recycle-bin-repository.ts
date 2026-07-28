import { databaseJson } from "./db/gateway";

export type RecycleEntityKind="ORGANIZATION"|"CONTACT"|"TASK"|"STUDENT"|"HOUSEHOLD";
export type RecycleBinItem={id:string;kind:RecycleEntityKind;labelZh:string;labelEn:string;deletedAt:string;expiresAt:string};

type ArchivedRow={id:string;archived_at:string;name_zh?:string;name_en?:string;title_zh?:string;title_en?:string;student_number?:string;current_grade?:string};
const expiry=(value:string)=>new Date(new Date(value).getTime()+30*24*60*60*1000).toISOString();
const map=(kind:RecycleEntityKind,rows:ArchivedRow[])=>rows.map((row):RecycleBinItem=>({
  id:row.id,
  kind,
  labelZh:row.name_zh??row.title_zh??row.student_number??row.id.slice(0,8),
  labelEn:row.name_en??row.title_en??row.current_grade??row.student_number??row.id.slice(0,8),
  deletedAt:row.archived_at,
  expiresAt:expiry(row.archived_at),
}));

export async function listRecycleBin():Promise<RecycleBinItem[]>{
  const filter="archived_at=not.is.null&order=archived_at.desc&limit=100";
  const [organizations,contacts,tasks,students,households]=await Promise.all([
    databaseJson<ArchivedRow[]>(`/db/table/organizations?select=id,name_zh,name_en,archived_at&${filter}`),
    databaseJson<ArchivedRow[]>(`/db/table/contacts?select=id,name_zh,name_en,archived_at&${filter}`),
    databaseJson<ArchivedRow[]>(`/db/table/crm_tasks?select=id,title_zh,title_en,archived_at&${filter}`),
    databaseJson<ArchivedRow[]>(`/db/table/students?select=id,student_number,current_grade,archived_at&${filter}`),
    databaseJson<ArchivedRow[]>(`/db/table/households?select=id,name_zh,name_en,archived_at&${filter}`),
  ]);
  return [
    ...map("ORGANIZATION",organizations),...map("CONTACT",contacts),...map("TASK",tasks),
    ...map("STUDENT",students),...map("HOUSEHOLD",households),
  ].sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
}
