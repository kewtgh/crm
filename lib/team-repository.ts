import type { AppUser } from "./user";
import { DatabaseRequestError } from "./db/gateway";
import { withPoolClient } from "./db/pools";

export type TeamMembership={teamId:string;code:string;nameZh:string;nameEn:string;role:"MEMBER"|"LEAD";status:"PENDING"|"ACTIVE"|"REJECTED"};
export type TeamMemberSummary={userId:string;memberId:string;nameZh:string;nameEn:string;role:string;membershipRole:"MEMBER"|"LEAD";status:"PENDING"|"ACTIVE"};
export type TeamRecord={id:string;code:string;nameZh:string;nameEn:string;descriptionMarkdown:string;active:boolean;leadMemberId:string|null;leadUserId:string|null;leadUserIds:string[];leadName:string;leadNames:string[];memberCount:number;members:TeamMemberSummary[]};
export type TeamLeadCandidate={userId:string;memberId:string;name:string;role:string;teamIds:string[]};
export type TeamMembershipOverview={teams:Array<{id:string;code:string;nameZh:string;nameEn:string}>;memberships:TeamMembership[]};

function workspaceId(){
  const value=process.env.CRM_WORKSPACE_ID;
  if(!value||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new DatabaseRequestError(503,"WORKSPACE_NOT_CONFIGURED","CRM workspace is not configured");
  return value;
}

type TeamRow={id:string;code:string;name_zh:string;name_en:string;description_markdown:string;active:boolean;lead_member_id:string|null;leads:Array<{userId:string;memberId:string;nameZh:string;nameEn:string}>|null;members:TeamMemberSummary[]|null;member_count:string|number};
function mapTeam(row:TeamRow):TeamRecord{
  const leads=row.leads??[];
  return{id:row.id,code:row.code,nameZh:row.name_zh,nameEn:row.name_en,descriptionMarkdown:row.description_markdown,active:row.active,leadMemberId:row.lead_member_id,leadUserId:leads[0]?.userId??null,leadUserIds:leads.map(item=>item.userId),leadName:leads[0]?`${leads[0].nameZh} / ${leads[0].nameEn}`:"",leadNames:leads.map(item=>`${item.nameZh} / ${item.nameEn}`),memberCount:Number(row.member_count),members:row.members??[]};
}

export async function listTeams():Promise<TeamRecord[]>{
  const result=await withPoolClient("system",client=>client.query<TeamRow>(`
    select team.id,team.code::text,team.name_zh,team.name_en,team.description_markdown,team.active,team.lead_member_id,
      coalesce(leads.items,'[]'::jsonb) leads,coalesce(member_rows.items,'[]'::jsonb) members,coalesce(member_rows.member_count,0) member_count
    from public.sales_teams team
    left join lateral (
      select jsonb_agg(jsonb_build_object('userId',member.auth_user_id,'memberId',member.id,'nameZh',member.name_zh,'nameEn',member.name_en) order by member.name_en) items
      from public.sales_team_memberships membership join public.sales_team_members member on member.id=membership.member_id
      where membership.team_id=team.id and membership.workspace_id=team.workspace_id and membership.status='ACTIVE' and membership.membership_role='LEAD' and member.active
    ) leads on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'userId',member.auth_user_id,'memberId',member.id,'nameZh',member.name_zh,'nameEn',member.name_en,
        'role',member.role,'membershipRole',membership.membership_role,'status',membership.status
      ) order by case membership.status when 'PENDING' then 0 else 1 end,member.name_en) items,
      count(*) filter(where membership.status='ACTIVE') member_count
      from public.sales_team_memberships membership join public.sales_team_members member on member.id=membership.member_id
      where membership.team_id=team.id and membership.workspace_id=team.workspace_id and membership.status in ('ACTIVE','PENDING') and member.active
    ) member_rows on true
    where team.workspace_id=$1 order by team.active desc,team.name_en
  `,[workspaceId()]));
  return result.rows.map(mapTeam);
}

export async function listTeamLeadCandidates():Promise<TeamLeadCandidate[]>{
  const result=await withPoolClient("system",client=>client.query<{user_id:string;member_id:string;name_zh:string;name_en:string;role:string;team_ids:string[]|null}>(`
    select member.auth_user_id user_id,member.id member_id,member.name_zh,member.name_en,member.role,
      array_remove(array_agg(membership.team_id order by membership.team_id) filter(where membership.status='ACTIVE'),null) team_ids
    from public.sales_team_members member left join public.sales_team_memberships membership on membership.member_id=member.id and membership.workspace_id=member.workspace_id
    where member.workspace_id=$1 and member.active and member.auth_user_id is not null
    group by member.id order by member.name_en
  `,[workspaceId()]));
  return result.rows.map(row=>({userId:row.user_id,memberId:row.member_id,name:`${row.name_zh} / ${row.name_en}`,role:row.role,teamIds:row.team_ids??[]}));
}

export async function saveTeam(input:{id?:string;code:string;nameZh:string;nameEn:string;descriptionMarkdown:string;leadUserIds?:string[];active?:boolean},actor:AppUser){
  if(actor.role!=="SUPER_ADMIN"&&actor.role!=="ADMIN")throw new DatabaseRequestError(403,"TEAM_MANAGEMENT_FORBIDDEN","Administrator required");
  const ws=workspaceId();const selectedLeadUsers=[...new Set(input.leadUserIds??[])];
  const savedTeamId=await withPoolClient("system",async client=>{
    await client.query("begin");
    try{
      const teamId=input.id??crypto.randomUUID();
      await client.query(`insert into public.sales_teams(id,workspace_id,code,name_zh,name_en,description_markdown,active,created_by)
        values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do update set code=excluded.code,name_zh=excluded.name_zh,name_en=excluded.name_en,description_markdown=excluded.description_markdown,active=excluded.active,updated_at=now() where sales_teams.workspace_id=excluded.workspace_id`,[teamId,ws,input.code.trim().toUpperCase(),input.nameZh.trim(),input.nameEn.trim(),input.descriptionMarkdown,input.active??true,actor.id]);
      const leadResult=selectedLeadUsers.length?await client.query<{id:string;auth_user_id:string}>(`select id,auth_user_id from public.sales_team_members where workspace_id=$1 and auth_user_id=any($2::uuid[]) and active for update`,[ws,selectedLeadUsers]):{rows:[]};
      if(leadResult.rows.length!==selectedLeadUsers.length)throw new DatabaseRequestError(400,"TEAM_LEAD_NOT_ELIGIBLE","Select active staff members");
      const leadMemberIds=leadResult.rows.map(item=>item.id);
      await client.query(`update public.sales_team_memberships set membership_role='MEMBER',updated_at=now() where workspace_id=$1 and team_id=$2 and membership_role='LEAD' and not(member_id=any($3::uuid[]))`,[ws,teamId,leadMemberIds]);
      for(const lead of leadResult.rows)await client.query(`insert into public.sales_team_memberships(workspace_id,team_id,member_id,membership_role,status,requested_by,reviewed_by,reviewed_at) values($1,$2,$3,'LEAD','ACTIVE',$4,$4,now()) on conflict(workspace_id,team_id,member_id) do update set membership_role='LEAD',status='ACTIVE',reviewed_by=$4,reviewed_at=now(),updated_at=now()`,[ws,teamId,lead.id,actor.id]);
      await client.query(`update public.sales_teams set lead_member_id=$2,updated_at=now() where id=$1 and workspace_id=$3`,[teamId,leadMemberIds[0]??null,ws]);
      await client.query(`insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data) values($1,$2,'sales_team',$3,$4,$5)`,[ws,actor.id,teamId,input.id?"UPDATE":"CREATE",{code:input.code,nameZh:input.nameZh,nameEn:input.nameEn,leadUserIds:selectedLeadUsers}]);
      await client.query("commit");return teamId;
    }catch(error){await client.query("rollback").catch(()=>undefined);if(typeof error==="object"&&error&&"code" in error&&String(error.code)==="23505")throw new DatabaseRequestError(409,"TEAM_TAKEN","Team code or name is already in use");throw error;}
  });
  const saved=(await listTeams()).find(item=>item.id===savedTeamId);if(!saved)throw new DatabaseRequestError(500,"TEAM_SAVE_NOT_VISIBLE","Saved team could not be reloaded");return saved;
}

export async function listUserTeamMemberships(userId:string):Promise<TeamMembershipOverview>{
  const ws=workspaceId();
  return withPoolClient("system",async client=>{
    const [teams,memberships]=await Promise.all([
      client.query<{id:string;code:string;name_zh:string;name_en:string}>(`select id,code::text,name_zh,name_en from public.sales_teams where workspace_id=$1 and active order by name_en`,[ws]),
      client.query<{team_id:string;code:string;name_zh:string;name_en:string;membership_role:"MEMBER"|"LEAD";status:"PENDING"|"ACTIVE"|"REJECTED"}>(`select team.id team_id,team.code::text,team.name_zh,team.name_en,membership.membership_role,membership.status from public.sales_team_members member join public.sales_team_memberships membership on membership.member_id=member.id and membership.workspace_id=member.workspace_id join public.sales_teams team on team.id=membership.team_id where member.workspace_id=$1 and member.auth_user_id=$2 order by team.name_en`,[ws,userId]),
    ]);
    return{teams:teams.rows.map(item=>({id:item.id,code:item.code,nameZh:item.name_zh,nameEn:item.name_en})),memberships:memberships.rows.map(item=>({teamId:item.team_id,code:item.code,nameZh:item.name_zh,nameEn:item.name_en,role:item.membership_role,status:item.status}))};
  });
}

export async function requestTeamMembership(userId:string,teamId:string){
  const ws=workspaceId();
  return withPoolClient("system",async client=>{
    const member=await client.query<{id:string}>(`select id from public.sales_team_members where workspace_id=$1 and auth_user_id=$2 and active`,[ws,userId]);
    if(!member.rows[0])throw new DatabaseRequestError(403,"TEAM_REQUEST_NOT_ELIGIBLE","Only active staff can request team membership");
    const team=await client.query(`select id from public.sales_teams where workspace_id=$1 and id=$2 and active`,[ws,teamId]);if(!team.rows[0])throw new DatabaseRequestError(404,"TEAM_NOT_FOUND","Team not found");
    const existing=await client.query<{status:string}>(`select status from public.sales_team_memberships where workspace_id=$1 and team_id=$2 and member_id=$3`,[ws,teamId,member.rows[0].id]);
    if(existing.rows[0]?.status==="ACTIVE"||existing.rows[0]?.status==="PENDING")throw new DatabaseRequestError(409,"TEAM_REQUEST_EXISTS","Membership or request already exists");
    await client.query(`insert into public.sales_team_memberships(workspace_id,team_id,member_id,membership_role,status,requested_by) values($1,$2,$3,'MEMBER','PENDING',$4) on conflict(workspace_id,team_id,member_id) do update set membership_role='MEMBER',status='PENDING',requested_by=$4,requested_at=now(),reviewed_by=null,reviewed_at=null,updated_at=now()`,[ws,teamId,member.rows[0].id,userId]);
    return listUserTeamMemberships(userId);
  });
}

export async function setUserTeamMemberships(userId:string,teamIds:string[],actor:AppUser){
  if(actor.role!=="SUPER_ADMIN"&&actor.role!=="ADMIN")throw new DatabaseRequestError(403,"TEAM_MANAGEMENT_FORBIDDEN","Administrator required");
  const ws=workspaceId();const selected=[...new Set(teamIds)];
  await withPoolClient("system",async client=>{await client.query("begin");try{
    const memberResult=await client.query<{id:string}>(`select id from public.sales_team_members where workspace_id=$1 and auth_user_id=$2 and active for update`,[ws,userId]);const member=memberResult.rows[0];if(!member)throw new DatabaseRequestError(400,"TEAM_MEMBER_NOT_ELIGIBLE","Active staff member required");
    const valid=selected.length?await client.query<{id:string}>(`select id from public.sales_teams where workspace_id=$1 and id=any($2::uuid[]) and active`,[ws,selected]):{rows:[]};if(valid.rows.length!==selected.length)throw new DatabaseRequestError(400,"TEAM_NOT_FOUND","Select active teams");
    await client.query(`update public.sales_team_memberships set status='REJECTED',reviewed_by=$3,reviewed_at=now(),updated_at=now() where workspace_id=$1 and member_id=$2 and status in ('ACTIVE','PENDING') and not(team_id=any($4::uuid[]))`,[ws,member.id,actor.id,selected]);
    for(const teamId of selected)await client.query(`insert into public.sales_team_memberships(workspace_id,team_id,member_id,membership_role,status,requested_by,reviewed_by,reviewed_at) values($1,$2,$3,'MEMBER','ACTIVE',$4,$4,now()) on conflict(workspace_id,team_id,member_id) do update set status='ACTIVE',reviewed_by=$4,reviewed_at=now(),updated_at=now()`,[ws,teamId,member.id,actor.id]);
    const primary=valid.rows[0]?.id??null;await client.query(`update public.sales_team_members set team_id=$3,team=coalesce((select name_zh from public.sales_teams where id=$3),'') where workspace_id=$1 and id=$2`,[ws,member.id,primary]);
    await client.query(`update public.sales_teams team set lead_member_id=(select membership.member_id from public.sales_team_memberships membership where membership.team_id=team.id and membership.workspace_id=team.workspace_id and membership.status='ACTIVE' and membership.membership_role='LEAD' order by membership.updated_at limit 1),updated_at=now() where team.workspace_id=$1 and team.lead_member_id=$2`,[ws,member.id]);
    await client.query(`insert into public.audit_events(workspace_id,actor_id,entity_type,entity_id,action,after_data) values($1,$2,'sales_team_member',$3,'TEAM_ASSIGNMENTS_UPDATED',$4)`,[ws,actor.id,member.id,{teamIds:selected}]);
    await client.query("commit");
  }catch(error){await client.query("rollback").catch(()=>undefined);throw error;}});
  return listUserTeamMemberships(userId);
}
