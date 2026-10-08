import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {runManagementIntegration} from './test-management-intelligence-postgres.mjs';
await runManagementIntegration(async({client,context,ws,otherWs,stranger,admin})=>{
 const get=async(sql,args=[])=>(await client.query(sql,args)).rows[0];
 await client.query('reset role');
 const root=randomUUID(),employee=randomUUID(),peerAdmin=randomUUID();
 for(const [user,role,label] of [[root,'SUPER_ADMIN','root'],[employee,'SALES_SPECIALIST','employee'],[peerAdmin,'ADMIN','administrator']]){
  await client.query('insert into app_auth.accounts(id,email,username) values($1,$2,$3)',[user,`${label}@role-policy.example.test`,`role-policy-${label}`]);
  await client.query('insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,$3)',[ws,user,role]);
 }
 // Current-schema role changes to SALES require a real active team. Keep the
 // original authority/race assertions and provision that prerequisite explicitly.
 const team=(await get("insert into public.sales_teams(workspace_id,code,name_zh,name_en,active) values($1,'ROLE-TEST','示例团队','Fictional role team',true) returning id",[ws])).id;
 for(const [id,role] of [[root,'SUPER_ADMIN'],[employee,'SALES_SPECIALIST'],[peerAdmin,'ADMIN'],[admin,'ADMIN']]){
  await client.query("insert into public.sales_team_members(workspace_id,auth_user_id,name_zh,name_en,role,team) values($1,$2,'示例员工','Fictional employee',$3,'Fictional role team') on conflict do nothing",[ws,id,role]);
  await client.query("insert into public.sales_team_memberships(workspace_id,team_id,member_id,status,requested_by,reviewed_by) select $1,$2,id,'ACTIVE',$3,$3 from public.sales_team_members where workspace_id=$1 and auth_user_id=$4 on conflict do nothing",[ws,team,root,id]);
 }
 const session=(await get("insert into app_auth.sessions(user_id,token_hash,csrf_hash,password_version,idle_expires_at,absolute_expires_at) values($1,$2,$3,1,now()+interval '1 hour',now()+interval '2 hours') returning id",[employee,randomBytes(32).toString('hex'),randomBytes(32).toString('hex')])).id;
 const change=async(target,role,expected,key=randomUUID(),db=client)=>(await db.query('select public.change_staff_role($1,$2,$3,$4) item',[target,role,expected,key])).rows[0].item;
 await context(employee);await assert.rejects(change(employee,'SALES_MANAGER','SALES_SPECIALIST'),/ROLE_ASSIGNMENT_FORBIDDEN/);
 await context(admin);await client.query("select set_config('app.aal','aal1',false)");await assert.rejects(change(employee,'SALES_MANAGER','SALES_SPECIALIST'),/MFA_REQUIRED/);
 await context(admin);
 for(const role of ['ADMIN','SUPER_ADMIN'])await assert.rejects(change(employee,role,'SALES_SPECIALIST'),/ROLE_ASSIGNMENT_FORBIDDEN/);
 await assert.rejects(change(peerAdmin,'SALES_SPECIALIST','ADMIN'),/ROLE_ASSIGNMENT_FORBIDDEN/);
 await assert.rejects(change(root,'SALES_SPECIALIST','SUPER_ADMIN'),/ROLE_ASSIGNMENT_FORBIDDEN/);
 const key=randomUUID(),result=await change(employee,'SALES_MANAGER','SALES_SPECIALIST',key);
 assert.equal(result.role,'SALES_MANAGER');assert.deepEqual(await change(employee,'SALES_MANAGER','SALES_SPECIALIST',key),result);
 await assert.rejects(change(employee,'SALES_SUPPORT','SALES_SPECIALIST',key),/PAYLOAD_REUSE/);
 await assert.rejects(change(employee,'SALES_SUPPORT','SALES_SPECIALIST'),/STALE_TARGET/);
 await client.query('reset role');assert.equal((await get('select revoked_reason from app_auth.sessions where id=$1',[session])).revoked_reason,'STAFF_ROLE_CHANGED');
 assert.equal((await get("select count(*) n from public.audit_events where entity_id=$1 and action='ROLE_CHANGE'",[employee])).n,'1');
 await context(root);await change(employee,'ADMIN','SALES_MANAGER');await change(peerAdmin,'SALES_SUPPORT','ADMIN');await change(employee,'SUPER_ADMIN','ADMIN');await change(employee,'SALES_MANAGER','SUPER_ADMIN');
 await assert.rejects(change(root,'ADMIN','SUPER_ADMIN'),/LAST_SUPER_ADMIN_PROTECTED/);
 await assert.rejects(change(stranger,'SALES_MANAGER','SALES_SPECIALIST'),/STAFF_USER_NOT_FOUND/);
 await context(stranger,otherWs);await assert.rejects(change(employee,'SALES_SUPPORT','SALES_MANAGER'),/STAFF_USER_NOT_FOUND|ROLE_ASSIGNMENT_FORBIDDEN/);
 await context(root);await change(admin,'SALES_SUPPORT','ADMIN');await context(admin);await assert.rejects(change(employee,'SALES_SUPPORT','SALES_MANAGER'),/ROLE_ASSIGNMENT_FORBIDDEN/);
 await context(root);await change(admin,'ADMIN','SALES_SUPPORT');
 const rival=new pg.Client(client.connectionParameters);await rival.connect();
 try{await context(root,ws,rival);const race=await Promise.allSettled([change(employee,'SALES_DIRECTOR','SALES_MANAGER'),change(employee,'SALES_SUPPORT','SALES_MANAGER',randomUUID(),rival)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);}finally{await rival.end();}
 await client.query('reset role');const before=(await get('select role from public.workspace_memberships where workspace_id=$1 and user_id=$2',[ws,employee])).role;
 await client.query("create function public.fictional_role_audit_failure() returns trigger language plpgsql as $$begin if new.action='ROLE_CHANGE' then raise exception 'FICTIONAL_AUDIT_FAILURE';end if;return new;end$$");
 await client.query('create trigger fictional_role_audit_failure before insert on public.audit_events for each row execute function public.fictional_role_audit_failure()');
 await context(root);const failedKey=randomUUID();await assert.rejects(change(employee,'SALES_SPECIALIST',before,failedKey),/FICTIONAL_AUDIT_FAILURE/);
 await client.query('reset role');assert.equal((await get('select role from public.workspace_memberships where workspace_id=$1 and user_id=$2',[ws,employee])).role,before);
 assert.equal((await get('select count(*) n from public.mutation_receipts where request_key=$1',[failedKey])).n,'0');
 await client.query('drop trigger fictional_role_audit_failure on public.audit_events');await client.query('drop function public.fictional_role_audit_failure()');
 await context(admin);await assert.rejects(client.query("update public.workspace_memberships set role='SUPER_ADMIN' where user_id=$1",[employee]),/permission denied|row-level security/);
 await context();console.log('PASS staff role matrix, AAL2, privileged-target and grant boundary, cross-workspace, revocation, stale role, concurrent decisions, exact receipts, session revocation, audit rollback and last Super Admin protection');
});
