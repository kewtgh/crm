import type { AppUser } from "./user";
import { DatabaseRequestError } from "./db/gateway";
import { withPoolClient } from "./db/pools";

export type TeamRecord = {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  descriptionMarkdown: string;
  active: boolean;
  leadMemberId: string | null;
  leadUserId: string | null;
  leadName: string;
  memberCount: number;
};
export type TeamLeadCandidate={userId:string;memberId:string;name:string;role:string;teamId:string|null};

function workspaceId() {
  const value = process.env.CRM_WORKSPACE_ID;
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new DatabaseRequestError(503, "WORKSPACE_NOT_CONFIGURED", "CRM workspace is not configured");
  }
  return value;
}

type TeamRow = {
  id:string;code:string;name_zh:string;name_en:string;description_markdown:string;active:boolean;
  lead_member_id:string|null;lead_user_id:string|null;lead_name_zh:string|null;lead_name_en:string|null;member_count:string|number;
};

function mapTeam(row:TeamRow):TeamRecord {
  return {
    id:row.id,code:row.code,nameZh:row.name_zh,nameEn:row.name_en,
    descriptionMarkdown:row.description_markdown,active:row.active,
    leadMemberId:row.lead_member_id,leadUserId:row.lead_user_id,
    leadName:row.lead_name_zh||row.lead_name_en?`${row.lead_name_zh ?? ""} / ${row.lead_name_en ?? ""}`:"",
    memberCount:Number(row.member_count),
  };
}

export async function listTeams():Promise<TeamRecord[]> {
  const result=await withPoolClient("system",client=>client.query<TeamRow>(`
    select t.id,t.code::text,t.name_zh,t.name_en,t.description_markdown,t.active,t.lead_member_id,
      lead.auth_user_id lead_user_id,lead.name_zh lead_name_zh,lead.name_en lead_name_en,
      count(member.id) filter(where member.active) member_count
    from public.sales_teams t
    left join public.sales_team_members lead on lead.id=t.lead_member_id
    left join public.sales_team_members member on member.team_id=t.id
    where t.workspace_id=$1
    group by t.id,lead.auth_user_id,lead.name_zh,lead.name_en
    order by t.active desc,t.name_en
  `,[workspaceId()]));
  return result.rows.map(mapTeam);
}

export async function listTeamLeadCandidates():Promise<TeamLeadCandidate[]> {
  const result=await withPoolClient("system",client=>client.query<{user_id:string;member_id:string;name_zh:string;name_en:string;role:string;team_id:string|null}>(`
    select auth_user_id user_id,id member_id,name_zh,name_en,role,team_id
    from public.sales_team_members where workspace_id=$1 and active and auth_user_id is not null
      and role in ('SALES_DIRECTOR','SALES_MANAGER') order by name_en
  `,[workspaceId()]));
  return result.rows.map(row=>({userId:row.user_id,memberId:row.member_id,name:`${row.name_zh} / ${row.name_en}`,role:row.role,teamId:row.team_id}));
}

export async function saveTeam(input:{id?:string;code:string;nameZh:string;nameEn:string;descriptionMarkdown:string;leadUserId?:string|null;active?:boolean},actor:AppUser) {
  if (actor.role!=="SUPER_ADMIN"&&actor.role!=="ADMIN") {
    throw new DatabaseRequestError(403,"TEAM_MANAGEMENT_FORBIDDEN","Administrator required");
  }
  const ws=workspaceId();
  const savedTeamId=await withPoolClient("system",async client=>{
    await client.query("begin");
    try {
      const teamId=input.id??crypto.randomUUID();
      await client.query(`insert into public.sales_teams(id,workspace_id,code,name_zh,name_en,description_markdown,active,created_by)
        values($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict(id) do update set code=excluded.code,name_zh=excluded.name_zh,name_en=excluded.name_en,
          description_markdown=excluded.description_markdown,active=excluded.active,updated_at=now()
        where sales_teams.workspace_id=excluded.workspace_id`,
        [teamId,ws,input.code.trim().toUpperCase(),input.nameZh.trim(),input.nameEn.trim(),input.descriptionMarkdown,input.active??true,actor.id]);
      let leadMemberId:string|null=null;
      if(input.leadUserId){
        const lead=await client.query<{id:string}>(`select id from public.sales_team_members
          where workspace_id=$1 and auth_user_id=$2 and active for update`,[ws,input.leadUserId]);
        if(!lead.rows[0])throw new DatabaseRequestError(400,"TEAM_LEAD_NOT_ELIGIBLE","Select an active sales member");
        leadMemberId=lead.rows[0].id;
        await client.query(`update public.sales_teams set lead_member_id=null,updated_at=now()
          where workspace_id=$1 and lead_member_id=$2 and id<>$3`,[ws,leadMemberId,teamId]);
        await client.query(`update public.sales_team_members set manager_member_id=null
          where workspace_id=$1 and manager_member_id=$2 and team_id is distinct from $3`,[ws,leadMemberId,teamId]);
        await client.query(`update public.sales_team_members set team_id=$2,team=$3,manager_member_id=null
          where id=$1`,[leadMemberId,teamId,input.nameZh.trim()]);
      }
      await client.query(`update public.sales_teams set lead_member_id=$2,updated_at=now() where id=$1 and workspace_id=$3`,[teamId,leadMemberId,ws]);
      await client.query(`update public.sales_team_members set team=$3,
        manager_member_id=case when $2::uuid is not null and id<>$2 then $2 else null end
        where team_id=$1 and active`,[teamId,leadMemberId,input.nameZh.trim()]);
      await client.query(`insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data)
        values($1,$2,'sales_team',$3,$4,$5)`,[ws,actor.id,teamId,input.id?"UPDATE":"CREATE",{code:input.code,nameZh:input.nameZh,nameEn:input.nameEn,leadUserId:input.leadUserId??null}]);
      await client.query("commit");
      return teamId;
    } catch(error) {
      await client.query("rollback").catch(()=>undefined);
      if(typeof error==="object"&&error&&"code" in error&&String(error.code)==="23505")throw new DatabaseRequestError(409,"TEAM_TAKEN","Team code or name is already in use");
      throw error;
    }
  });
  const saved=(await listTeams()).find(item=>item.id===savedTeamId);
  if(!saved)throw new DatabaseRequestError(500,"TEAM_SAVE_NOT_VISIBLE","Saved team could not be reloaded");
  return saved;
}
