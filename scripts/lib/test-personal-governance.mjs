import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyPersonalGovernance({admin,execute,create,workspace,otherWorkspace,superId,team}){
 const owner=await create('personal.owner');
 const colleague=await create('personal.colleague');
 const finance=await create('personal.finance',{role:'FINANCE_SPECIALIST',teamId:null});
 const task=async(user,ws=workspace)=>(await admin.query("insert into public.crm_tasks(workspace_id,title_zh,title_en,owner_id,created_by,archived_at) values($1,'示例回收任务','Fictional recycled task',$2,$2,now()) returning id",[ws,user.id])).rows[0].id;
 const own=await task(owner),other=await task(colleague),foreign=await task(owner,otherWorkspace),financeTask=await task(finance);
 const list=user=>execute(user.id,"select public.list_personal_recycle_bin() item",[],"aal1");
 assert.deepEqual((await list(owner)).map(r=>r.id),[own]);
 assert.equal((await list(owner))[0].labelZh,'示例回收任务');
 assert.equal((await list(owner))[0].labelEn,'Fictional recycled task');
 assert.deepEqual((await list(finance)).map(r=>r.id),[financeTask]);
 await assert.rejects(execute(owner.id,"select public.restore_personal_recycle_record('TASK',$1) item",[other],"aal1"),e=>e.message==='RECYCLE_ACCESS_DENIED');
 await assert.rejects(execute(owner.id,"select public.restore_personal_recycle_record('TASK',$1) item",[foreign],"aal1"),e=>e.message==='RECYCLE_ACCESS_DENIED');
 await assert.rejects(execute(owner.id,"select public.restore_crm_recycle_bin('TASK',$1) item",[other]),e=>e.message==='super_admin_required');
 assert.equal(await execute(owner.id,"select public.restore_personal_recycle_record('TASK',$1) item",[own],"aal1"),true);
 assert.equal((await list(owner)).length,0);
 assert.ok((await list(colleague)).some(r=>r.id===other));
 const request=async(user)=>(await admin.query("insert into public.approval_requests(workspace_id,request_type,business_object_type,business_object_id,requester_id,reason) values($1,'CRM_EXPORT','FICTIONAL',$2,$3,'Fictional personal request') returning id",[workspace,randomUUID(),user.id])).rows[0].id;
 const ownApproval=await request(owner),otherApproval=await request(colleague),financeApproval=await request(finance);
 const requests=user=>execute(user.id,"select coalesce(jsonb_agg(id),'[]') item from public.approval_requests");
 assert.deepEqual(await requests(owner),[ownApproval]);
 assert.deepEqual(await requests(finance),[financeApproval]);
 assert.ok((await requests({id:superId})).includes(otherApproval));
 const leader=await create('personal.leader',{role:'SALES_MANAGER'});
 const leaderMember=(await admin.query("select id from public.sales_team_members where auth_user_id=$1",[leader.id])).rows[0].id;
 await admin.query("update public.sales_teams set lead_member_id=$2 where id=$1",[team,leaderMember]);
 await admin.query("update public.approval_requests set required_role='ADMIN' where id=$1",[otherApproval]);
 assert.ok(!(await requests(leader)).includes(otherApproval),'leading a team does not grant access to its admin-only reviews');
 await admin.query("update public.approval_requests set required_role='TEAM_LEAD' where id=$1",[otherApproval]);
 assert.ok((await requests(leader)).includes(otherApproval),'the assigned team lead sees their review task');
 await admin.query("update public.sales_teams set lead_member_id=null where id=$1",[team]);
 console.log('PASS personal recycle list/restore, colleague and workspace denial, non-sales personal approvals and assigned-review boundaries.');
}
